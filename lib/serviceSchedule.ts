import { normalizeTitle } from "./normalizeTitle";

/**
 * The hymn-book numbers of one tune version, as strings. A number of "-1"
 * means the hymn is not in that book.
 */
export interface ScheduleHymnVersion {
    rejoice_hymns_number: string;
    great_hymns_number: string;
}

/** A hymn catalog entry: a song title and its tune versions. */
export interface ScheduleHymn {
    song_title: string;
    versions: ScheduleHymnVersion[];
}

/** A plan item together with the selections made for it on the Schedule tab. */
export interface ScheduleItem {
    title: string;
    itemType: string;
    sequence: number;
    selectedOption?: "Leave blank" | "Custom";
    customText?: string;
    selectedVersionIndex?: number;
}

/** Everything buildScheduleCopyText reads. */
export interface ScheduleCopyInput {
    items: ScheduleItem[];
    hymnData: ScheduleHymn[];
    serviceTypeName: string;
    date: Date;
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
 * Moved verbatim from ServiceSchedule.tsx; serviceSchedule.test.ts pins its
 * behavior, quirks included. `date` is formatted in the runtime's local time
 * zone for now.
 */
export function buildScheduleCopyText({
    items,
    hymnData,
    serviceTypeName,
    date,
}: ScheduleCopyInput): string {
    let result: string = "";

    if (
        serviceTypeName === "Sunday Morning" ||
        serviceTypeName === "Sunday Evening"
    ) {
        result +=
            "Sunday" +
            (serviceTypeName === "Sunday Morning" ? " AM " : " PM ") +
            date.toLocaleDateString("en-US", {
                month: "numeric",
                day: "numeric",
                year: "2-digit",
            }) +
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
