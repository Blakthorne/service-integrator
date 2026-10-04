import type {
    LabelledEntry,
    PlanItem,
    ScheduleSelection,
    ServiceType,
} from "./domain";
import { formatShortDate } from "./format";
import { DEFAULT_SETTINGS, defaultScheduleHeaderLabel } from "./settings";

/** What the schedule text reads of a catalog song's entry. */
export type ScheduleEntry = Pick<LabelledEntry, "label" | "variantNote">;

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
    /** The plan's service type's name, which picks the header when `headerLabel` is left out. */
    serviceTypeName: ServiceType["name"];
    /**
     * The plan's calendar date as `YYYY-MM-DD` (see `planDateFromSortDate`), or
     * null when it is not known.
     */
    planDate: string | null;
    /**
     * The header's label from the settings, resolved for the plan's service
     * type (`scheduleHeaderLabel`): "Sunday AM", or null for no header. Left
     * out, the service type's name decides, as it did before settings:
     * "Sunday Morning" is "Sunday AM", "Sunday Evening" is "Sunday PM", and
     * any other type gets no header.
     */
    headerLabel?: string | null;
    /** What goes between a song's numbers, from the settings; left out, " / ". */
    numberSeparator?: string;
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
 * A song's numbers as the schedule text prints them: the labels of the
 * entries `scheduleEntries` picks, in book order, joined with `separator`
 * (the `numberSeparator` setting, " / " by default: "R-396 / G-317"). Each
 * label is the one its book gives the entry (see `formatEntryLabel`), so the
 * Doxology on the front cover of Great Hymns is "G-Front Cover" and an entry
 * of an unnumbered book is the book's short name. No entries give "".
 */
export function formatScheduleNumbers(
    entries: readonly ScheduleEntry[],
    separator: string = DEFAULT_SETTINGS.numberSeparator
): string {
    return scheduleEntries(entries)
        .map((entry) => entry.label)
        .join(separator);
}

/**
 * The text the "Copy All" button on the Schedule tab copies: an optional
 * "<label> <date>" header ("Sunday AM 10/4/26") followed by one line per
 * song item, in sequence order.
 *
 * Each line is the item's title, followed by what its option adds:
 * "numbers" adds the numbers of the catalog song its Planning Center song is
 * linked to (see `formatScheduleNumbers`, joined with `numberSeparator`),
 * "custom" adds the custom text, and "blank" adds nothing; so does "numbers"
 * without numbers, or "custom" without text. The title only names the line:
 * the link, not the title, finds the numbers. serviceSchedule.test.ts pins
 * its behavior, quirks included.
 *
 * The header's label is `headerLabel`, from the settings; there is no header
 * when it is null or empty. Left out, the label is the default for the
 * service type's name (`defaultScheduleHeaderLabel`). The header date is the
 * plan's calendar date, formatted from its `YYYY-MM-DD` text (see
 * `formatShortDate`), so it reads the same in every time zone. With no
 * `planDate` the header has no date ("Sunday AM").
 */
export function buildScheduleCopyText({
    items,
    catalog,
    serviceTypeName,
    planDate,
    headerLabel,
    numberSeparator = DEFAULT_SETTINGS.numberSeparator,
}: ScheduleCopyInput): string {
    let result: string = "";

    const label =
        headerLabel === undefined ? defaultScheduleHeaderLabel(serviceTypeName) : headerLabel;
    if (label !== null && label !== "") {
        result +=
            label +
            (planDate === null ? "" : " " + formatShortDate(planDate)) +
            "\n\n";
    }

    result += items
        .filter((item) => item.itemType === "song")
        .sort((a, b) => a.sequence - b.sequence)
        .map((item) => {
            if (item.option === "custom" && item.customText) {
                return `${item.title} (${item.customText})`;
            }
            if (item.option === "numbers") {
                const match = catalogMatchFor(catalog, item.songId);
                const numbers = match
                    ? formatScheduleNumbers(match.entries, numberSeparator)
                    : "";
                if (numbers.length > 0) {
                    return `${item.title} (${numbers})`;
                }
            }
            return item.title;
        })
        .join("\n");

    return result;
}
