import Link from "next/link";
import type { CatalogTuneRow } from "@/lib/catalog/tuneFilter";
import { routes } from "@/lib/routes";

const HEADER_CELL =
    "px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider";

interface TunesTableProps {
    rows: readonly CatalogTuneRow[];
    /** What the table says when there are no rows. */
    emptyMessage: string;
}

/**
 * Tunes as table rows: the name (a real link to the tune, stretched over the
 * row), with its meter and other names under it when it has them, and how
 * many songs use it. Links keep the default prefetch: a tune's page reads
 * only the local database, so prefetching costs no Planning Center requests.
 */
export default function TunesTable({ rows, emptyMessage }: TunesTableProps) {
    return (
        <table className="w-full">
            <caption className="sr-only">Tunes</caption>
            <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                    <th scope="col" className={HEADER_CELL}>
                        Tune
                    </th>
                    <th scope="col" className={`${HEADER_CELL} text-right`}>
                        Songs
                    </th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.length === 0 ? (
                    <tr>
                        <td
                            colSpan={2}
                            className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                        >
                            {emptyMessage}
                        </td>
                    </tr>
                ) : (
                    rows.map((tune) => {
                        const details = [
                            tune.meter,
                            tune.aliases.length > 0
                                ? `also ${tune.aliases.join(", ")}`
                                : null,
                        ].filter((detail) => detail !== null);
                        return (
                            // `relative` makes the row the box the link's
                            // overlay fills; `transform-gpu` does the same in
                            // Safari, which ignored `relative` on table rows
                            // until 2026 (WebKit bug 240961).
                            <tr
                                key={tune.id}
                                className="relative transform-gpu hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                            >
                                <td className="px-3 sm:px-6 py-3 text-sm align-top">
                                    <Link
                                        href={routes.catalogTune(tune.id)}
                                        className="font-medium text-gray-900 dark:text-gray-100 after:absolute after:inset-0"
                                    >
                                        {tune.name}
                                    </Link>
                                    {details.length > 0 && (
                                        <span className="block mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                            {details.join(" · ")}
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 sm:px-6 py-3 text-sm text-right tabular-nums text-gray-700 dark:text-gray-300 align-top">
                                    {tune.songCount}
                                </td>
                            </tr>
                        );
                    })
                )}
            </tbody>
        </table>
    );
}
