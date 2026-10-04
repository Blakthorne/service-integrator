import type {
    HymnData,
    HymnVersion,
    PlanItem,
    ScheduleSelection,
    ServiceType,
} from "./domain";
import { formatShortDate } from "./format";
import { normalizeTitle } from "./normalizeTitle";

/**
 * The hymn-book numbers of one tune version, as strings. A number of "-1"
 * means the hymn is not in that book.
 */
export type ScheduleHymnVersion = Pick<
    HymnVersion,
    "rejoice_hymns_number" | "great_hymns_number"
>;

/** A hymn catalog entry: a song title and its tune versions. */
export type ScheduleHymn = Pick<HymnData, "song_title"> & {
    versions: ScheduleHymnVersion[];
};

/** A plan item together with the selections made for it on the Schedule tab. */
export type ScheduleItem = Pick<PlanItem, "title" | "itemType" | "sequence"> &
    ScheduleSelection;

/** Everything buildScheduleCopyText reads. */
export interface ScheduleCopyInput {
    items: ScheduleItem[];
    hymnData: ScheduleHymn[];
    serviceTypeName: ServiceType["name"];
    /**
     * The plan's calendar date as `YYYY-MM-DD` (see `planDateFromSortDate`), or
     * null when it is not known.
     */
    planDate: string | null;
}

/**
 * The hymn-book numbers of a tune version as "R-<rejoice>/G-<great>". A "-1"
 * number is left out, so a version in neither book gives "" (the Schedule tab
 * then shows "TUNE ()").
 */
export function formatHymnNumbers(version: ScheduleHymnVersion): string {
    return [
        version.rejoice_hymns_number !== "-1"
            ? `R-${version.rejoice_hymns_number}`
            : null,
        version.great_hymns_number !== "-1"
            ? `G-${version.great_hymns_number}`
            : null,
    ]
        .filter(Boolean)
        .join("/");
}

/**
 * The text the "Copy All" button on the Schedule tab copies: an optional
 * "Sunday AM/PM <date>" header followed by one line per song item, in
 * sequence order.
 *
 * Moved from ServiceSchedule.tsx; serviceSchedule.test.ts pins its behavior,
 * quirks included. The header date is the plan's calendar date, formatted
 * from its `YYYY-MM-DD` text (see `formatShortDate`), so it reads the same in
 * every time zone. With no `planDate` the header has no date ("Sunday AM").
 */
export function buildScheduleCopyText({
    items,
    hymnData,
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
            const hymn = hymnData.find(
                (h) =>
                    normalizeTitle(h.song_title) === normalizeTitle(item.title)
            );
            if (!hymn) {
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

            // Use the actual selected version index from the UI state
            const selectedVersionIndex = item.selectedVersionIndex ?? 0;
            const selectedVersion = hymn.versions[selectedVersionIndex];
            if (!selectedVersion) return item.title;

            const parts: string = formatHymnNumbers(selectedVersion);

            if (parts.length > 0) {
                return `${item.title} (${parts})`;
            }
            return item.title;
        })
        .join("\n");

    return result;
}
