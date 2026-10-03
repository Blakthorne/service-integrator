import "server-only";
import { PCO_CACHE_POLICY, type PcoResourceKind } from "./cachePolicy";
import type { PcoListResponse, PcoResourceIdentifier } from "./resources";

const PCO_ORIGIN = "https://api.planningcenteronline.com";
const SERVICES_PATH = "/services/v2";

/** A 429 is retried once, but only when PCO asks us to wait at most this long. */
const MAX_RETRY_AFTER_SECONDS = 5;

/** pcoFetchAll's default page limit: 5,000 rows at per_page=100. */
const DEFAULT_MAX_PAGES = 50;

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
 * How long to wait before retrying a 429, or null for no retry: only a
 * Retry-After of whole seconds, at most MAX_RETRY_AFTER_SECONDS, qualifies.
 */
function retryDelayMs(response: Response): number | null {
    // Optional chaining: bare test doubles ({ ok, status }) have no headers.
    const header = response.headers?.get("Retry-After")?.trim();
    if (!header || !/^\d+$/.test(header)) {
        return null;
    }
    const seconds = Number(header);
    return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1000 : null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One guarded request, retrying a short 429 once. Resolves to the JSON body. */
async function request(url: URL, kind: PcoResourceKind): Promise<unknown> {
    const init: RequestInit = {
        headers: pcoAuthHeaders(),
        ...PCO_CACHE_POLICY[kind],
        // Following a redirect would re-send the token to an unguarded URL
        // (even same-origin, e.g. /people/v2), so a 3xx makes fetch reject.
        redirect: "error",
    };
    let response = await fetch(url.href, init);
    if (!response.ok) {
        // Headers are read only here: success mocks are bare { ok, json }.
        const delay = response.status === 429 ? retryDelayMs(response) : null;
        if (delay !== null) {
            await sleep(delay);
            response = await fetch(url.href, init);
        }
        if (!response.ok) {
            throw new PcoError(response.status, url.pathname + url.search);
        }
    }
    return response.json();
}

/**
 * GET one PCO Services API resource. `path` is relative to /services/v2 and
 * starts with "/". Throws PcoUrlError before fetching if the normalized URL
 * leaves the Services API, and PcoError on a non-2xx response.
 */
export async function pcoFetch<T>(path: string, kind: PcoResourceKind): Promise<T> {
    return (await request(servicesUrl(path), kind)) as T;
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

/**
 * GET every page of a PCO list endpoint by following `links.next`, which is
 * guarded like the first URL. Throws rather than silently truncating when a
 * page beyond `maxPages` exists.
 */
export async function pcoFetchAll<T, I extends PcoResourceIdentifier = PcoResourceIdentifier>(
    path: string,
    kind: PcoResourceKind,
    { maxPages = DEFAULT_MAX_PAGES }: { maxPages?: number } = {}
): Promise<PcoPages<T, I>> {
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
        const page = (await request(url, kind)) as PcoListResponse<T, I>;
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
