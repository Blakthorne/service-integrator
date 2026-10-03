/**
 * Raw Planning Center Services API shapes (JSON:API), as the API sends them.
 * lib/pco/mappers.ts turns these into the domain types in lib/domain.ts; app
 * code should use those instead. Types only, so nothing here reaches a bundle.
 */

/** A JSON:API resource identifier, e.g. the target of a relationship. */
export interface PcoResourceIdentifier<TType extends string = string> {
    type: TType;
    id: string;
}

/** A to-one relationship. `data` is null when nothing is linked. */
export interface PcoToOneRelationship<TType extends string> {
    data: PcoResourceIdentifier<TType> | null;
}

/** Pagination links of a list response. `next` is absent on the last page. */
export interface PcoLinks {
    self?: string;
    next?: string | null;
}

/** One page of a list endpoint. `I` is the type of the included resources. */
export interface PcoListResponse<T, I = PcoResourceIdentifier> {
    data: T[];
    included?: I[];
    links?: PcoLinks;
    meta: {
        total_count: number;
        count: number;
    };
}

/** The response of a single-resource endpoint. */
export interface PcoSingleResponse<T> {
    data: T;
}

export interface PcoServiceTypeAttributes {
    name: string;
    frequency: string;
    sequence: number;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
}

/** `GET /services/v2/service_types[/{id}]` */
export interface PcoServiceTypeResource {
    type: "ServiceType";
    id: string;
    attributes: PcoServiceTypeAttributes;
}

export interface PcoPlanAttributes {
    can_view_order: boolean;
    created_at: string;
    /** E.g. "October 4, 2026". */
    dates: string;
    files_expire_at: string;
    items_count: number;
    last_time_at: string;
    multi_day: boolean;
    needed_positions_count: number;
    other_time_count: number;
    permissions: string;
    plan_notes_count: number;
    plan_people_count: number;
    /** The plan's page in the web app (verified in the PCO spike). */
    planning_center_url: string;
    prefers_order_view: boolean;
    public: boolean;
    rehearsable: boolean;
    rehearsal_time_count: number;
    reminders_disabled: boolean;
    series_title: string | null;
    service_time_count: number;
    short_dates: string;
    /** Org-local time labelled as UTC, e.g. "2026-10-04T08:00:00Z". */
    sort_date: string;
    title: string | null;
    total_length: number;
    updated_at: string;
}

/** `GET /services/v2/service_types/{st}/plans[/{id}]` */
export interface PcoPlanResource {
    type: "Plan";
    id: string;
    attributes: PcoPlanAttributes;
    relationships?: {
        service_type?: PcoToOneRelationship<"ServiceType">;
    };
    links: {
        /** The API URL of this plan, not its web page. */
        self: string;
        html_url?: string | null;
    };
}

export interface PcoItemAttributes {
    created_at: string;
    custom_arrangement_sequence: string | null;
    custom_arrangement_sequence_full: string | null;
    custom_arrangement_sequence_short: string | null;
    description: string | null;
    html_details: string | null;
    item_type: string;
    key_name: string | null;
    length: number;
    sequence: number;
    service_position: string;
    title: string;
    updated_at: string;
}

/** `GET /services/v2/service_types/{st}/plans/{plan}/items` */
export interface PcoItemResource {
    type: "Item";
    id: string;
    attributes: PcoItemAttributes;
    relationships?: {
        song?: PcoToOneRelationship<"Song">;
    };
}

export interface PcoSongAttributes {
    admin: string | null;
    author: string | null;
    ccli_number: number | null;
    copyright: string | null;
    created_at: string;
    hidden: boolean;
    last_scheduled_at: string | null;
    last_scheduled_short_dates: string | null;
    notes: string | null;
    themes: string | null;
    title: string;
    updated_at: string;
}

/** `GET /services/v2/songs`, or included with plan items (`include=song`). */
export interface PcoSongResource {
    type: "Song";
    id: string;
    attributes: PcoSongAttributes;
    links: {
        /** The API URL of this song, not its web page. */
        self: string;
    };
}
