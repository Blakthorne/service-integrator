"use client";

import { useCallback, useMemo } from "react";
import { useUrlState } from "@/app/hooks/useUrlState";
import { formatMatchCount } from "@/lib/catalog/counts";
import { filterUnlinkedPcoSongs } from "@/lib/catalog/pickers";
import type { CatalogSongOption, UnlinkedPcoSong } from "@/lib/domain";
import SearchBox from "../SearchBox";
import RowNoticeText from "./RowNoticeText";
import UnlinkedSongRow from "./UnlinkedSongRow";
import { useRowNotice } from "./useRowNotice";

interface ReconcileViewProps {
    /** The Planning Center songs not in the catalog, by title, each with its suggestions. */
    unlinked: UnlinkedPcoSong[];
    /** Every catalog song, by title, for the rows' pickers. */
    catalogSongs: CatalogSongOption[];
}

/** The id of the notice above the list. */
const NOTICE_ID = "unlinked-notice";

/** The id of a row's heading. */
function headingIdOf(pcoSongId: string): string {
    return `pco-song-${pcoSongId}`;
}

/**
 * Reconcile's main list: the Planning Center songs not in the catalog, each
 * a row to link, search for, make a catalog song from, or ignore. A search
 * over their titles and authors narrows the list in the browser, kept in
 * the URL (`?q=`) like the catalog lists' searches. When a row's song is
 * linked or ignored it leaves the list: the notice above it says what was
 * done, and focus moves to the row that took its place.
 */
export default function ReconcileView({ unlinked, catalogSongs }: ReconcileViewProps) {
    const { searchParams, setSearchParams } = useUrlState();
    const query = searchParams.get("q") ?? "";
    const rows = useMemo(() => filterUnlinkedPcoSongs(unlinked, query), [unlinked, query]);
    const rowIds = useMemo(() => rows.map(({ pcoSong }) => pcoSong.id), [rows]);
    const { notice, announce } = useRowNotice(NOTICE_ID, headingIdOf);

    const resolved = useCallback(
        (pcoSongId: string, message: string) => announce(rowIds, pcoSongId, message),
        [announce, rowIds]
    );

    return (
        <div className="space-y-4">
            {unlinked.length > 0 && (
                <div
                    role="search"
                    aria-label="Planning Center songs not in the catalog"
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 space-y-3"
                >
                    <SearchBox
                        value={query}
                        onChange={(next) =>
                            setSearchParams({ q: next === "" ? null : next }, { history: "replace" })
                        }
                        label="Search these songs"
                        placeholder="Title or author"
                    />
                    <p
                        aria-live="polite"
                        className="border-t border-gray-100 dark:border-gray-700 pt-3 text-sm font-medium text-gray-900 dark:text-gray-100"
                    >
                        {formatMatchCount(rows.length, unlinked.length, "song")}
                    </p>
                </div>
            )}
            <RowNoticeText id={NOTICE_ID} notice={notice} />
            {rows.length > 0 ? (
                <ul className="space-y-4">
                    {rows.map((row) => (
                        <li key={row.pcoSong.id}>
                            <UnlinkedSongRow
                                row={row}
                                catalogSongs={catalogSongs}
                                headingId={headingIdOf(row.pcoSong.id)}
                                onResolved={resolved}
                            />
                        </li>
                    ))}
                </ul>
            ) : (
                unlinked.length > 0 && (
                    <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                        No song matches.
                    </p>
                )
            )}
        </div>
    );
}
