import type { LinkReason, SongLinkSource } from "@/lib/domain";
import { countOf } from "./counts";

/**
 * The words for links between catalog songs and Planning Center songs, as
 * Reconcile, the song page and Settings say them. Each record is typed by
 * the union it spells out, so a new reason or source does not compile until
 * it has its words.
 */

/** Why a catalog song is suggested for a Planning Center song, as a short tag. */
export const LINK_REASON_LABELS: Record<LinkReason, string> = {
    exact: "Same title",
    alias: "Other title",
    "tune-hint": "Title names the tune",
    near: "Similar title",
};

/** The same, said in full, for the tag's tooltip. */
export const LINK_REASON_DESCRIPTIONS: Record<LinkReason, string> = {
    exact: "The Planning Center title is this hymn's title.",
    alias: "The Planning Center title is another title of this hymn.",
    "tune-hint": "The Planning Center title is this hymn's, and names this tune in parentheses.",
    near: "The Planning Center title is close to this hymn's title, or names a tune the hymn is not sung to here.",
};

/** How a link was made, as a short tag. */
export const LINK_SOURCE_LABELS: Record<SongLinkSource, string> = {
    auto: "auto",
    manual: "manual",
    import: "import",
};

/** The same, said in full. */
export const LINK_SOURCE_DESCRIPTIONS: Record<SongLinkSource, string> = {
    auto: "Linked automatically by a sync",
    manual: "Linked by hand",
    import: "Linked by an import",
};

/** "3 Planning Center songs are not in the catalog", or "Every Planning Center song is in the catalog". */
export function describeUnlinkedCount(count: number): string {
    return count === 0
        ? "Every Planning Center song is in the catalog or ignored."
        : `${countOf(count, "Planning Center song")} ${count === 1 ? "is" : "are"} not in the catalog.`;
}

/** "12 catalog songs are not in Planning Center", or that every one is. */
export function describeNotInPcoCount(count: number): string {
    return count === 0
        ? "Every catalog song is linked to Planning Center."
        : `${countOf(count, "catalog song")} ${count === 1 ? "is" : "are"} not in Planning Center.`;
}
