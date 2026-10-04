import type {
    LabelledEntry,
    PlanItem,
    ScheduleSelection,
    ServiceType,
} from "./domain";
import { formatShortDate } from "./format";

/** What the schedule text reads of a catalog song's entry. */
export type ScheduleEntry = Pick<
    LabelledEntry,
    "bookCode" | "number" | "variantNote"
>;

/** What the schedule text reads of a catalog song: its entries, in book order. */
export type ScheduleMatch = { entries: readonly ScheduleEntry[] };

/**
 * The catalog songs that the song items' Planning Center songs are linked
 * to, by Planning Center song id (`PlanDetail.catalog`).
 */
export type ScheduleCatalog = Readonly<Record<string, ScheduleMatch>>;

/** A plan item together with the selections made for it on the Schedule tab. */
export type ScheduleItem = Pick<
    PlanItem,
    "title" | "itemType" | "sequence" | "songId"
> &
    ScheduleSelection;

/** Everything buildScheduleCopyText reads. */
export interface ScheduleCopyInput {
    items: ScheduleItem[];
    /** The catalog songs the items' Planning Center songs are linked to. */
    catalog: ScheduleCatalog;
    serviceTypeName: ServiceType["name"];
    /**
     * The plan's calendar date as `YYYY-MM-DD` (see `planDateFromSortDate`), or
     * null when it is not known.
     */
    planDate: string | null;
}

/**
 * The catalog song an item's Planning Center song is linked to, or undefined
 * when the item has no Planning Center song or its song is not linked. The
 * link, not the item's title, decides, so an item renamed in the plan keeps
 * its song's numbers.
 */
export function catalogMatchFor<T>(
    catalog: Readonly<Record<string, T>>,
    songId: PlanItem["songId"]
): T | undefined {
    return songId !== null && Object.hasOwn(catalog, songId)
        ? catalog[songId]
        : undefined;
}

/** True when an entry has no variant note (a blank one counts as none). */
function isPlainEntry(entry: Pick<LabelledEntry, "variantNote">): boolean {
    return (entry.variantNote?.trim() ?? "") === "";
}

/**
 * The entries whose numbers a song prints: those without a variant note, or
 * every entry when each has one. A descant that a book prints under a number
 * of its own (R-29, "Descant - Last Chorus only", beside How Great Thou Art
 * at R-28) is not where the congregation finds the hymn, so it is left out,
 * as it was when each descant was a hymnbook record with its own title; a
 * round printed only as a round is all the song has, so it is kept.
 */
export function scheduleEntries<T extends Pick<LabelledEntry, "variantNote">>(
    entries: readonly T[]
): T[] {
    const plain = entries.filter(isPlainEntry);
    return plain.length > 0 ? plain : [...entries];
}

/**
 * A song's numbers as the schedule text prints them, from the entries
 * `scheduleEntries` picks: each as its book's code and number, joined with
 * "/" ("R-12/G-34"). An entry with no number prints 0, as hymns.json had the
 * Doxology on the front cover of Great Hymns ("G-0"). No entries give "".
 */
export function formatScheduleNumbers(entries: readonly ScheduleEntry[]): string {
    return scheduleEntries(entries)
        .map((entry) => `${entry.bookCode}-${entry.number ?? 0}`)
        .join("/");
}

/**
 * The text the "Copy All" button on the Schedule tab copies: an optional
 * "Sunday AM/PM <date>" header followed by one line per song item, in
 * sequence order.
 *
 * A song item whose Planning Center song is linked to a catalog song prints
 * that song's numbers (see `formatScheduleNumbers`) unless Custom is chosen;
 * the item's title only names the line. serviceSchedule.test.ts pins its
 * behavior, quirks included. The header date is the plan's calendar date,
 * formatted from its `YYYY-MM-DD` text (see `formatShortDate`), so it reads
 * the same in every time zone. With no `planDate` the header has no date
 * ("Sunday AM").
 */
export function buildScheduleCopyText({
    items,
    catalog,
    serviceTypeName,
    planDate,
}: ScheduleCopyInput): string {
    let result: string = "";

    if (
        serviceTypeName === "Sunday Morning" ||
        serviceTypeName === "Sunday Evening"
    ) {
        result +=
            "Sunday" +
            (serviceTypeName === "Sunday Morning" ? " AM" : " PM") +
            (planDate === null ? "" : " " + formatShortDate(planDate)) +
            "\n\n";
    }

    result += items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            const match = catalogMatchFor(catalog, item.songId);
            if (!match) {
                if (item.selectedOption === "Custom" && item.customText) {
                    return `${item.title} (${item.customText})`;
                }
                return item.title;
            }

            if (item.selectedOption === "Custom") {
                if (
                    item.customText === undefined ||
                    item.customText === ""
                ) {
                    return item.title;
                }
                return `${item.title} (${item.customText})`;
            }

            const numbers = formatScheduleNumbers(match.entries);
            if (numbers.length > 0) {
                return `${item.title} (${numbers})`;
            }
            return item.title;
        })
        .join("\n");

    return result;
}
