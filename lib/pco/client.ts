import "server-only";
import { PCO_CACHE_POLICY, type PcoResourceKind } from "./cachePolicy";
import { assertPcoId, type PcoId } from "./ids";
import { MAX_PACED_WAIT_SECONDS, pcoPacer, readRetryAfter } from "./pacer";
import type {
    PcoErrorObject,
    PcoErrorResponse,
    PcoListResponse,
    PcoResourceIdentifier,
} from "./resources";

const PCO_ORIGIN = "https://api.planningcenteronline.com";
const SERVICES_PATH = "/services/v2";

/** A page load retries a 429 once, and only when PCO asks it to wait at most this long. */
const MAX_RETRY_AFTER_SECONDS = 5;

/** A paced request retries a 429 up to this many times. */
const MAX_PACED_RETRIES = 3;

/** pcoFetchAll's default page limit: 5,000 rows at per_page=100. */
const DEFAULT_MAX_PAGES = 50;

/**
 * Each attempt (a 429 retry included) is abandoned after this long, so a
 * stalled PCO response can never pin a render or a TTL-cache entry.
 */
const PCO_TIMEOUT_MS = 15_000;

/** Build the PCO Basic Auth headers from env credentials. Throws if missing. */
export function pcoAuthHeaders(): Record<string, string> {
    const id = process.env.PLANNING_CENTER_ID;
    const token = process.env.PLANNING_CENTER_TOKEN;
    if (!id || !token) {
        throw new Error("Planning Center credentials not configured");
    }
    const credentials = Buffer.from(`${id}:${token}`).toString("base64");
    return {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
    };
}

/** PCO answered with a non-2xx status. `path` is the request's path and query. */
export class PcoError extends Error {
    readonly status: number;
    readonly path: string;

    constructor(status: number, path: string) {
        super(`Planning Center API responded with status: ${status} (${path})`);
        this.name = "PcoError";
        this.status = status;
        this.path = path;
    }
}

/**
 * PCO refused a request as invalid (422), typically a write whose attributes
 * failed validation. `details` are PCO's `errors[].detail` strings, possibly
 * none.
 */
export class PcoValidationError extends PcoError {
    readonly details: readonly string[];

    constructor(path: string, details: readonly string[]) {
        super(422, path);
        this.name = "PcoValidationError";
        this.details = details;
        if (details.length > 0) {
            // JSON-quoted, so a detail cannot forge log lines.
            this.message += `: ${JSON.stringify(details)}`;
        }
    }
}

/** A request URL failed the guard, so it was never fetched. */
export class PcoUrlError extends Error {
    constructor(url: string) {
        super(
            `Refusing to call a URL outside the PCO Services API: ${JSON.stringify(url.slice(0, 200))}`
        );
        this.name = "PcoUrlError";
    }
}

/**
 * Parse and normalize `raw` (resolving dot segments, including encoded ones,
 * and the host's case), then require the PCO origin and a path under
 * /services/v2/. The token is sent to whatever URL passes, so the check runs
 * before every request: the first one and every `links.next`.
 */
function guardUrl(raw: string, base?: URL): URL {
    let url: URL;
    try {
        url = new URL(raw, base);
    } catch {
        throw new PcoUrlError(raw);
    }
    const allowed =
        url.origin === PCO_ORIGIN &&
        url.pathname.startsWith(`${SERVICES_PATH}/`) &&
        // Our paths never need percent-encoding, so refuse it outright rather
        // than guess how the server decodes %2F and friends.
        !url.pathname.includes("%") &&
        url.username === "" &&
        url.password === "";
    if (!allowed) {
        throw new PcoUrlError(raw);
    }
    return url;
}

/** A path relative to /services/v2, e.g. "/service_types/1/plans?per_page=100". */
function servicesUrl(path: string): URL {
    return guardUrl(`${PCO_ORIGIN}${SERVICES_PATH}${path}`);
}

/**
 * How long to wait before retrying a 429 after `retries` retries, or null to
 * give up. A page load retries once, and only after a Retry-After of whole
 * seconds, at most MAX_RETRY_AFTER_SECONDS. A paced request retries up to
 * MAX_PACED_RETRIES times after its Retry-After of any length, or a whole
 * window (`periodMs`) without one, unless that is over MAX_PACED_WAIT_SECONDS.
 * The pacer holds every other paced request as long (Pacer.observe).
 */
function retryDelayMs(
    response: Response,
    retries: number,
    paced: boolean,
    periodMs: number
): number | null {
    const seconds = readRetryAfter(response.headers);
    if (!paced) {
        return retries === 0 && seconds !== undefined && seconds <= MAX_RETRY_AFTER_SECONDS
            ? seconds * 1000
            : null;
    }
    const delayMs = seconds === undefined ? periodMs : seconds * 1000;
    return retries < MAX_PACED_RETRIES && delayMs <= MAX_PACED_WAIT_SECONDS * 1000
        ? delayMs
        : null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Release the connection behind a response whose body will not be read,
 * without waiting for it. In a Next server render, fetch responses are
 * memoized and their body is teed; cancelling one branch of a tee does not
 * settle until the other (unread in React's request cache) is cancelled too,
 * so awaiting this could hang the render forever.
 */
function discardBody(response: Response): void {
    // Optional chaining: bare test doubles ({ ok, status }) have no body. The
    // catch keeps a failed cancel from becoming an unhandled rejection.
    void response.body?.cancel().catch(() => {});
}

/**
 * The `errors[].detail` strings of a 422's body. Read defensively: a body that
 * is not JSON, or not shaped like PCO's errors, gives none.
 */
async function validationDetails(response: Response): Promise<string[]> {
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return [];
    }
    const errors = (body as Partial<PcoErrorResponse> | null)?.errors;
    if (!Array.isArray(errors)) {
        return [];
    }
    return errors.flatMap((error: Partial<PcoErrorObject> | null) =>
        typeof error?.detail === "string" && error.detail !== "" ? [error.detail] : []
    );
}

/**
 * The error for a non-2xx response. A 422's body says what PCO found invalid,
 * so it is read; any other body is released unread.
 */
async function responseError(response: Response, path: string): Promise<PcoError> {
    if (response.status === 422) {
        return new PcoValidationError(path, await validationDetails(response));
    }
    discardBody(response);
    return new PcoError(response.status, path);
}

/** True for what fetch (or a body read) rejects with when its signal fires. */
function isAbortError(error: unknown): boolean {
    const name = (error as { name?: unknown } | null)?.name;
    return name === "TimeoutError" || name === "AbortError";
}

/** Turns a 2xx response into what the request resolves to. */
type ReadBody = (response: Response) => Promise<unknown>;

/** A GET's body, which is always JSON. */
const readJson: ReadBody = (response) => response.json();

/** A write's body: JSON, or null when there is none (204 No Content). */
const readOptionalJson: ReadBody = async (response) => {
    const text = await response.text();
    return text.trim() === "" ? null : JSON.parse(text);
};

/** Options that every PCO request function takes. */
export interface PcoRequestOptions {
    /**
     * Wait for the shared pacer (pacer.ts) before each request this call
     * sends, every page pcoFetchAll follows and a 429 retry included, and
     * ride out a 429: up to 3 retries, each after PCO's Retry-After unless
     * that is over 60 s. Sync jobs pass `paced: true`; page loads leave it
     * off, so they never wait on the pacer and retry a 429 only once, after
     * at most 5 s.
     */
    paced?: boolean;
}

/**
 * One guarded request, retrying a 429 as retryDelayMs allows. `init` carries
 * what differs between calls (method, body, cache option); the auth headers,
 * the redirect refusal and the timeout are added here, so no caller can leave
 * them out. Resolves to `read` of the 2xx response.
 */
async function request(
    url: URL,
    init: RequestInit,
    read: ReadBody,
    { paced = false }: PcoRequestOptions = {}
): Promise<unknown> {
    const guarded: RequestInit = {
        ...init,
        headers: pcoAuthHeaders(),
        // Following a redirect would re-send the token to an unguarded URL
        // (even same-origin, e.g. /people/v2), so a 3xx makes fetch reject.
        redirect: "error",
    };
    const path = url.pathname + url.search;
    const pacer = pcoPacer();
    // A fresh timeout for each attempt; it also bounds reading the body.
    const send = () =>
        fetch(url.href, { ...guarded, signal: AbortSignal.timeout(PCO_TIMEOUT_MS) });
    const attempt = async (): Promise<Response> => {
        // A paced attempt waits for its turn, so its timeout starts only once
        // it is sent.
        const response = await (paced ? pacer.acquire().then(send) : send());
        // Every response, paced or not, tells the pacer PCO's current limit
        // and how much of this window is used; a 429 holds paced requests.
        pacer.observe(response);
        return response;
    };

    try {
        let response = await attempt();
        for (let retries = 0; response.status === 429; retries++) {
            const delay = retryDelayMs(response, retries, paced, pacer.limits().periodMs);
            if (delay === null) {
                break;
            }
            discardBody(response);
            await sleep(delay);
            response = await attempt();
        }
        if (!response.ok) {
            throw await responseError(response, path);
        }
        return await read(response);
    } catch (error) {
        if (isAbortError(error)) {
            // The path only: the request init holds the Authorization header.
            throw new Error(
                `Planning Center did not respond within ${PCO_TIMEOUT_MS / 1000} s (${path})`,
                { cause: error }
            );
        }
        throw error;
    }
}

/**
 * GET one PCO Services API resource. `path` is relative to /services/v2 and
 * starts with "/". Throws PcoUrlError before fetching if the normalized URL
 * leaves the Services API, and PcoError on a non-2xx response.
 */
export async function pcoFetch<T>(
    path: string,
    kind: PcoResourceKind,
    options?: PcoRequestOptions
): Promise<T> {
    return (await request(servicesUrl(path), PCO_CACHE_POLICY[kind], readJson, options)) as T;
}

/** What pcoFetchAll collects across every page of a list endpoint. */
export interface PcoPages<T, I> {
    /** Every page's `data`, appended in order (no deduping). */
    data: T[];
    /** Every page's `included`, deduped by type and id (first copy wins). */
    included: I[];
    /** `meta.total_count` of the first page, or the number of rows without it. */
    totalCount: number;
}

/** Options for pcoFetchAll. */
export interface PcoFetchAllOptions extends PcoRequestOptions {
    /** The most pages to fetch before throwing; defaults to 50. */
    maxPages?: number;
}

/**
 * GET every page of a PCO list endpoint by following `links.next`, which is
 * guarded like the first URL. Throws rather than silently truncating when a
 * page beyond `maxPages` exists.
 */
export async function pcoFetchAll<T, I extends PcoResourceIdentifier = PcoResourceIdentifier>(
    path: string,
    kind: PcoResourceKind,
    { maxPages = DEFAULT_MAX_PAGES, paced = false }: PcoFetchAllOptions = {}
): Promise<PcoPages<T, I>> {
    const init = PCO_CACHE_POLICY[kind];
    const data: T[] = [];
    const included: I[] = [];
    const seen = new Set<string>();
    let totalCount: number | undefined;
    let url: URL | null = servicesUrl(path);

    for (let pageNumber = 1; url; pageNumber++) {
        if (pageNumber > maxPages) {
            throw new Error(
                `Planning Center returned more than ${maxPages} pages for ${path}`
            );
        }
        const page = (await request(url, init, readJson, { paced })) as PcoListResponse<T, I>;
        data.push(...page.data);
        for (const resource of page.included ?? []) {
            const key = `${resource.type}:${resource.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                included.push(resource);
            }
        }
        totalCount ??= page.meta?.total_count;
        const next = page.links?.next;
        url = next ? guardUrl(next, url) : null;
    }

    return { data, included, totalCount: totalCount ?? data.length };
}

/** The methods pcoMutate sends. */
export type PcoMutationMethod = "POST" | "PATCH" | "DELETE";

/**
 * Write to the PCO Services API: `path` as for pcoFetch, `body` (built with
 * jsonApi) sent as JSON. Guarded, timed out and retried on a 429 exactly like
 * a GET (PCO answers 429 before processing a request, so a retried POST
 * cannot apply twice), and never cached. Resolves to the JSON
 * response, or null when there is none (204 No Content). Throws PcoUrlError
 * before sending, PcoValidationError on a 422 and PcoError on any other
 * non-2xx response.
 *
 * Only modules inside lib/pco write to Planning Center, so the barrel does not
 * export this.
 */
export async function pcoMutate<T = unknown>(
    method: PcoMutationMethod,
    path: string,
    body?: PcoWriteBody,
    options?: PcoRequestOptions
): Promise<T | null> {
    const init: RequestInit = {
        method,
        cache: "no-store",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    return (await request(servicesUrl(path), init, readOptionalJson, options)) as T | null;
}

/** A resource identifier in a write body. Its ID has passed assertPcoId. */
export interface PcoWriteIdentifier {
    type: string;
    id: PcoId;
}

/** A relationship in a write body: to-one (toOne) or to-many (toMany). */
export interface PcoWriteRelationship {
    data: PcoWriteIdentifier | PcoWriteIdentifier[];
}

/** The JSON:API document a write sends; build it with jsonApi. */
export interface PcoWriteBody {
    data: {
        type: string;
        attributes: Record<string, unknown>;
        relationships?: Record<string, PcoWriteRelationship>;
    };
}

/**
 * Build a write's JSON:API body: `{ data: { type, attributes } }`, with
 * `relationships` when given. Build each relationship with toOne or toMany.
 */
export function jsonApi(
    type: string,
    attributes: Record<string, unknown>,
    relationships?: Record<string, PcoWriteRelationship>
): PcoWriteBody {
    return { data: { type, attributes, ...(relationships ? { relationships } : {}) } };
}

/**
 * A to-one relationship for jsonApi, `{ data: { type, id } }`. Throws
 * InvalidPcoIdError unless `id` is a PCO ID.
 */
export function toOne(type: string, id: string): PcoWriteRelationship {
    return { data: { type, id: assertPcoId(id) } };
}

/**
 * A to-many relationship for jsonApi, `{ data: [{ type, id }, …] }`. An empty
 * list is allowed: assign_tags with none clears a song's tags. Throws
 * InvalidPcoIdError unless every ID is a PCO ID.
 */
export function toMany(type: string, ids: readonly string[]): PcoWriteRelationship {
    return { data: ids.map((id) => ({ type, id: assertPcoId(id) })) };
}
