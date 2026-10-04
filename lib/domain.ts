/**
 * The app's domain types: the one place where the shapes of service types,
 * plans, plan items, songs and hymnbook matches are declared. Pure types, safe
 * to import from client and server code alike.
 *
 * Raw Planning Center (JSON:API) shapes live in lib/pco/resources.ts, and
 * lib/pco/mappers.ts turns them into these.
 */

/** A Planning Center service type, such as "Sunday Morning". */
export interface ServiceType {
    id: string;
    name: string;
    frequency: string;
    sequence: number;
    archived: boolean;
}

/** One plan (a service on a given date) of a service type. */
export interface Plan {
    id: string;
    serviceTypeId: string;
    title: string | null;
    /** Human-readable date(s), e.g. "October 4, 2026". */
    dates: string;
    shortDates: string;
    /**
     * PCO's sort timestamp, e.g. "2026-10-04T08:00:00Z". It is org-local time
     * labelled as UTC, so its `YYYY-MM-DD` part is the plan's calendar date.
     */
    sortDate: string;
    itemsCount: number;
    /** The plan's page in the Planning Center web app. */
    planningCenterUrl: string;
    createdAt: string;
    updatedAt: string;
}

/** A plan in the all-plans list, carrying the name of its service type. */
export type PlanSummary = Plan & {
    serviceType: Pick<ServiceType, "id" | "name">;
};

/**
 * A song from the Planning Center library. Fields that PCO may leave empty are
 * `null`. There is no URL field: web links are built from the ID.
 */
export interface Song {
    id: string;
    title: string;
    author: string | null;
    admin: string | null;
    ccliNumber: number | null;
    copyright: string | null;
    notes: string | null;
    themes: string | null;
}

/** One item of a plan: a song, header, media or other element. */
export interface PlanItem {
    id: string;
    title: string;
    /** PCO's item type, e.g. "song", "header", "media" or "item". */
    itemType: string;
    sequence: number;
    servicePosition: string;
    keyName: string | null;
    length: number;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    /** The PCO song this item schedules, or null when it has none. */
    songId: string | null;
}

/** A plan item joined to its song (null when no song was found for it). */
export type PlanItemWithSong = PlanItem & { song: Song | null };

/**
 * One tune version of a hymn in the hymnbooks. Numbers are strings, and "-1"
 * means the hymn is not in that book.
 */
export interface HymnVersion {
    id: string;
    tune_name: string;
    rejoice_hymns_number: string;
    great_hymns_number: string;
}

/** The hymnbook match for a requested song title, with every tune version. */
export interface HymnData {
    /** The title as it was requested, not the hymnbook's spelling. */
    song_title: string;
    versions: HymnVersion[];
}

/**
 * The choices made for one song on the Schedule tab. This is UI state, not
 * PCO data, so it is kept apart from PlanItem and combined with it only where
 * a view needs both (`PlanItem & ScheduleSelection`).
 */
export interface ScheduleSelection {
    selectedOption?: "Leave blank" | "Custom";
    customText?: string;
    selectedVersionIndex?: number;
}
