import Link from "next/link";
import { formatShortDate } from "@/lib/format";
import { describeRowUse, type ReportKind, type ReportRow } from "@/lib/reportsView";
import { routes } from "@/lib/routes";

const HEADER_CELL =
    "px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider";

/** A column below the title and the numbers, which a phone folds under the title instead. */
const WIDE_ONLY = "hidden sm:table-cell";

/** The columns a table can have. */
type Column = "place" | "song" | "numbers" | "times" | "lastSung" | "next" | "inPlanningCenter";

/** Each report's columns, in order. */
const COLUMNS: Readonly<Record<ReportKind, readonly Column[]>> = {
    "most-sung": ["place", "song", "numbers", "times", "lastSung"],
    "last-sung": ["song", "numbers", "lastSung", "times", "next"],
    "not-sung": ["song", "numbers", "lastSung"],
    "never-sung": ["song", "numbers", "inPlanningCenter", "next"],
};

const HEADERS: Readonly<Record<Exclude<Column, "place">, string>> = {
    song: "Song",
    numbers: "Numbers",
    times: "Times sung",
    lastSung: "Last sung",
    next: "Next scheduled",
    inPlanningCenter: "In Planning Center",
};

/** The columns that a phone shows: the others are said under the title (`describeRowUse`). */
const ON_PHONES: readonly Column[] = ["place", "song", "numbers"];

function headerClass(column: Column): string {
    return `${HEADER_CELL} ${ON_PHONES.includes(column) ? "" : WIDE_ONLY}`;
}

/** A dash for a cell with nothing to say, with what a screen reader says in its place. */
function None({ said }: { said: string }) {
    return (
        <>
            <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                —
            </span>
            <span className="sr-only">{said}</span>
        </>
    );
}

interface CellProps {
    report: ReportKind;
    row: ReportRow;
    place: number;
}

/** A song's title, a link to its page when it has one, with its tune under it and, on phones, how it was used. */
function SongCell({ report, row }: CellProps) {
    const titleClass = "font-medium text-gray-900 dark:text-gray-100";
    return (
        <td className="px-3 sm:px-6 py-3 text-sm align-top">
            {row.songId === null ? (
                <span className={titleClass}>{row.title}</span>
            ) : (
                // Default prefetch, as the songs list's rows have (convention 13).
                // `after:` stretches the link over the row.
                <Link
                    href={routes.catalogSong(row.songId)}
                    className={`${titleClass} after:absolute after:inset-0`}
                >
                    {row.title}
                </Link>
            )}
            {row.songId === null ? (
                <span className="block mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Not in the catalog
                </span>
            ) : (
                row.tuneName !== null && (
                    <span className="block mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {row.tuneName}
                    </span>
                )
            )}
            <span className="block sm:hidden mt-1 text-xs text-gray-600 dark:text-gray-400">
                {describeRowUse(report, row)}
            </span>
        </td>
    );
}

/** A song's numbers in the books, "Not in a book" for a catalog song with none, a dash for a song not in the catalog. */
function NumbersCell({ row }: CellProps) {
    return (
        <td className="px-3 sm:px-6 py-3 text-sm text-gray-700 dark:text-gray-300 align-top">
            {row.numbers !== "" ? (
                <span className="tabular-nums">{row.numbers}</span>
            ) : row.songId === null ? (
                <None said="No numbers" />
            ) : (
                <span className="text-gray-500 dark:text-gray-400">Not in a book</span>
            )}
        </td>
    );
}

/** The date a song was last sung, or that it never was. */
function LastSungCell({ row }: CellProps) {
    return (
        <td className={`${WIDE_ONLY} px-6 py-3 text-sm text-gray-700 dark:text-gray-300 align-top`}>
            {row.lastSungOn === null ? (
                <span className="text-gray-500 dark:text-gray-400">Never sung</span>
            ) : (
                <span className="tabular-nums">{formatShortDate(row.lastSungOn)}</span>
            )}
        </td>
    );
}

function TimesCell({ row }: CellProps) {
    return (
        <td className={`${WIDE_ONLY} px-6 py-3 text-sm text-gray-700 dark:text-gray-300 align-top tabular-nums`}>
            {row.times}
        </td>
    );
}

/** The date a song is next scheduled, or a dash. */
function NextCell({ row }: CellProps) {
    return (
        <td className={`${WIDE_ONLY} px-6 py-3 text-sm text-gray-700 dark:text-gray-300 align-top`}>
            {row.nextScheduledOn === null ? (
                <None said="Not scheduled" />
            ) : (
                <span className="tabular-nums">{formatShortDate(row.nextScheduledOn)}</span>
            )}
        </td>
    );
}

/** Whether a song is in Planning Center ("never sung" lists the catalog's songs that are not). */
function InPlanningCenterCell({ row }: CellProps) {
    return (
        <td className={`${WIDE_ONLY} px-6 py-3 text-sm text-gray-700 dark:text-gray-300 align-top`}>
            {row.inPlanningCenter === false ? (
                <span className="text-gray-500 dark:text-gray-400">No</span>
            ) : (
                "Yes"
            )}
        </td>
    );
}

/** The song's place in the report ("most sung" ranks its rows). */
function PlaceCell({ place }: CellProps) {
    return (
        <td className="w-10 px-3 sm:px-6 py-3 text-sm text-gray-500 dark:text-gray-400 align-top tabular-nums">
            {place}
        </td>
    );
}

const CELLS: Readonly<Record<Column, (props: CellProps) => React.JSX.Element>> = {
    place: PlaceCell,
    song: SongCell,
    numbers: NumbersCell,
    times: TimesCell,
    lastSung: LastSungCell,
    next: NextCell,
    inPlanningCenter: InPlanningCenterCell,
};

interface ReportTableProps {
    report: ReportKind;
    /** The rows of one page. */
    rows: readonly ReportRow[];
    /** Names the table for screen readers, such as "Most sung, last 12 months". */
    caption: string;
    /** The place in the report of the first row: "most sung" numbers its rows with it. */
    firstPlace: number;
    /** What the table says when there are no rows. */
    emptyMessage: string;
}

/**
 * One page of a report as a table: each song's title (a link to its page
 * when it is in the catalog; a song that is not says so), its numbers, and
 * the report's own columns (`COLUMNS`): the place and the times sung and the
 * last date for "most sung", the last date, the times and the next date for
 * "last sung", the last date for "not sung since", and whether it is in
 * Planning Center and the next date for "never sung". On phones the
 * columns past the numbers are said under the title instead.
 */
export default function ReportTable({ report, rows, caption, firstPlace, emptyMessage }: ReportTableProps) {
    const columns = COLUMNS[report];
    return (
        <table className="w-full">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                    {columns.map((column) => (
                        <th key={column} scope="col" className={headerClass(column)}>
                            {column === "place" ? (
                                <>
                                    <span aria-hidden="true">#</span>
                                    <span className="sr-only">Place</span>
                                </>
                            ) : (
                                HEADERS[column]
                            )}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                    <tr>
                        <td
                            colSpan={columns.length}
                            className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                        >
                            {emptyMessage}
                        </td>
                    </tr>
                ) : (
                    rows.map((row, index) => (
                        // `relative` makes the row the box the link's overlay
                        // fills; `transform-gpu` does the same in Safari,
                        // which ignored `relative` on table rows until 2026
                        // (WebKit bug 240961).
                        <tr
                            key={row.key}
                            className={`relative transform-gpu transition-colors ${
                                row.songId === null
                                    ? ""
                                    : "hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                            }`}
                        >
                            {columns.map((column) => {
                                const Cell = CELLS[column];
                                return (
                                    <Cell
                                        key={column}
                                        report={report}
                                        row={row}
                                        place={firstPlace + index}
                                    />
                                );
                            })}
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    );
}
