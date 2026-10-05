/**
 * Test helpers for the PCO data layer: builders for raw PCO JSON and a fetch
 * stub. Only *.test.ts files import this module.
 */
import { vi } from "vitest";
import { PACER_GLOBAL, createPacer, type Pacer } from "./pacer";
import type {
    PcoItemResource,
    PcoPlanResource,
    PcoServiceTypeResource,
    PcoSongResource,
} from "./resources";

export const PCO_BASE = "https://api.planningcenteronline.com/services/v2";

/** The Authorization header that the stubbed credentials produce. */
export const PCO_AUTH = `Basic ${Buffer.from("id:tok").toString("base64")}`;

export function stubPcoCredentials(): void {
    vi.stubEnv("PLANNING_CENTER_ID", "id");
    vi.stubEnv("PLANNING_CENTER_TOKEN", "tok");
}

/** A fresh JSON response; a body can only be read once, so never reuse one. */
export function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
    });
}

/** One page of a list endpoint, linking to `next` when given. */
export function listPage(
    data: unknown[],
    {
        next,
        included,
        total,
    }: { next?: string; included?: unknown[]; total?: number } = {}
) {
    return {
        data,
        included: included ?? [],
        links: next ? { self: "ignored", next } : { self: "ignored" },
        meta: { total_count: total ?? data.length, count: data.length },
    };
}

/** A route function: builds the Response from the request's init. */
type RouteHandler = (init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Stub global fetch with a table of routes. A key is a full URL, which
 * answers GET only, or "METHOD url" (`POST ${PCO_BASE}/songs`). A value is
 * the JSON body to return (as a fresh 200 response each call) or a function
 * that builds the Response from the request init. A request missing from the
 * table fails the test.
 */
export function stubFetchRoutes(routes: Record<string, unknown>) {
    const has = (key: string) => Object.prototype.hasOwnProperty.call(routes, key);
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        // Matched as sent: fetch upper-cases DELETE and POST but not PATCH,
        // and a server rejects "patch".
        const method = init?.method ?? "GET";
        const key = [`${method} ${url}`, ...(method === "GET" ? [url] : [])].find(has);
        if (key === undefined) {
            throw new Error(`Unexpected fetch: ${method} ${url}`);
        }
        const route = routes[key];
        return typeof route === "function" ? (route as RouteHandler)(init) : json(route);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** The URLs a fetch mock was called with, in order. */
export function calledUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return fetchMock.mock.calls.map(([url]) => String(url));
}

/**
 * Put `pacer` in the shared pacer's place until vi.unstubAllGlobals(), so a
 * test neither depends on nor changes the one the rest of its file shares
 * (every PCO response feeds it; paced requests wait on it). The default is a
 * fresh pacer on Date.now, which vi.useFakeTimers() drives.
 */
export function stubPcoPacer(pacer: Pacer = createPacer({ now: () => Date.now() })): Pacer {
    vi.stubGlobal(PACER_GLOBAL, pacer);
    return pacer;
}

/** One call a fetch mock received. */
export interface CalledRequest {
    method: string;
    url: string;
    /** The body parsed from JSON, or undefined when the request had none. */
    body: unknown;
}

/** The requests a fetch mock was called with, in order. */
export function calledRequests(fetchMock: ReturnType<typeof vi.fn>): CalledRequest[] {
    return fetchMock.mock.calls.map(([url, init]) => {
        const { method = "GET", body } = (init ?? {}) as RequestInit;
        return {
            method,
            url: String(url),
            body: body == null ? undefined : JSON.parse(String(body)),
        };
    });
}

export function serviceTypeResource(
    attributes: Partial<PcoServiceTypeResource["attributes"]> = {},
    id = "1405391"
): PcoServiceTypeResource {
    return {
        type: "ServiceType",
        id,
        attributes: {
            name: "Sunday Morning",
            frequency: "Weekly",
            sequence: 1,
            archived_at: null,
            created_at: "2020-01-01T00:00:00Z",
            updated_at: "2020-01-02T00:00:00Z",
            ...attributes,
        },
    };
}

export function planResource(
    overrides: Partial<PcoPlanResource> = {},
    attributes: Partial<PcoPlanResource["attributes"]> = {}
): PcoPlanResource {
    const id = overrides.id ?? "81234567";
    return {
        type: "Plan",
        id,
        attributes: {
            can_view_order: true,
            created_at: "2026-09-01T12:00:00Z",
            dates: "October 4, 2026",
            files_expire_at: "2026-10-20T00:00:00Z",
            items_count: 17,
            last_time_at: "2026-10-04T09:30:00Z",
            multi_day: false,
            needed_positions_count: 0,
            other_time_count: 0,
            permissions: "Administrator",
            plan_notes_count: 0,
            plan_people_count: 12,
            planning_center_url: `https://services.planningcenteronline.com/plans/${id}`,
            prefers_order_view: true,
            public: false,
            rehearsable: true,
            rehearsal_time_count: 1,
            reminders_disabled: false,
            series_title: null,
            service_time_count: 1,
            short_dates: "Oct 4",
            sort_date: "2026-10-04T08:00:00Z",
            title: "Communion Sunday",
            total_length: 4200,
            updated_at: "2026-10-02T15:00:00Z",
            ...attributes,
        },
        links: {
            self: `${PCO_BASE}/service_types/1405391/plans/${id}`,
            html_url: null,
        },
        ...overrides,
    };
}

export function itemResource(
    id: string,
    attributes: Partial<PcoItemResource["attributes"]> = {},
    relationships?: PcoItemResource["relationships"]
): PcoItemResource {
    return {
        type: "Item",
        id,
        attributes: {
            created_at: "2026-09-01T12:00:00Z",
            custom_arrangement_sequence: null,
            custom_arrangement_sequence_full: null,
            custom_arrangement_sequence_short: null,
            description: null,
            html_details: null,
            item_type: "song",
            key_name: "G",
            length: 240,
            sequence: 1,
            service_position: "during",
            title: "Amazing Grace",
            updated_at: "2026-09-02T12:00:00Z",
            ...attributes,
        },
        ...(relationships ? { relationships } : {}),
    };
}

export function songResource(
    id: string,
    attributes: Partial<PcoSongResource["attributes"]> = {}
): PcoSongResource {
    return {
        type: "Song",
        id,
        attributes: {
            admin: "Admin Co",
            author: "John Newton",
            ccli_number: 22025,
            copyright: "Public Domain",
            created_at: "2019-01-01T00:00:00Z",
            hidden: false,
            last_scheduled_at: "2026-09-27T08:00:00Z",
            last_scheduled_short_dates: "Sep 27",
            notes: "Verse 3 optional",
            themes: "Grace",
            title: "Amazing Grace",
            updated_at: "2026-09-27T08:00:00Z",
            ...attributes,
        },
        links: {
            self: `${PCO_BASE}/songs/${id}`,
        },
    };
}
