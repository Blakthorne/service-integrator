"use client";

import { useActionState, useCallback, useMemo } from "react";
import {
    unignorePcoSongAction,
    type LinkActionState,
} from "@/app/(app)/catalog/reconcile/actions";
import SubmitButton from "@/app/components/ui/SubmitButton";
import { formatCount } from "@/lib/catalog/counts";
import { unignoredMessage } from "@/lib/catalog/linkText";
import type { MirroredPcoSong } from "@/lib/domain";
import { IDLE_FORM } from "@/lib/forms";
import PcoSongWebLink from "./PcoSongWebLink";
import RowNoticeText from "./RowNoticeText";
import { useRowNotice } from "./useRowNotice";

interface IgnoredSongsProps {
    /** The ignored Planning Center songs still in Planning Center, by title. */
    songs: MirroredPcoSong[];
}

/** The id of the notice above the list. */
const NOTICE_ID = "ignored-notice";

/** The id of a row's heading. */
function headingIdOf(pcoSongId: string): string {
    return `ignored-${pcoSongId}`;
}

interface IgnoredRowProps {
    song: MirroredPcoSong;
    /** Called once Unignore succeeds (the row then leaves the list), with what to say. */
    onUnignored: (pcoSongId: string, message: string) => void;
}

/** One ignored song, with a link to it in Planning Center and Unignore. */
function IgnoredRow({ song, onUnignored }: IgnoredRowProps) {
    const [state, action] = useActionState(
        async (previous: LinkActionState, formData: FormData): Promise<LinkActionState> => {
            const next = await unignorePcoSongAction(previous, formData);
            if (next.status === "success") {
                onUnignored(song.id, unignoredMessage(song.title));
            }
            return next;
        },
        IDLE_FORM
    );

    return (
        <li className="px-4 sm:px-6 py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h3
                        id={headingIdOf(song.id)}
                        tabIndex={-1}
                        className="font-medium text-gray-900 dark:text-gray-100 focus:outline-none"
                    >
                        {song.title}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {song.author && <>{song.author} · </>}
                        <PcoSongWebLink pcoSongId={song.id} />
                    </p>
                </div>
                <form action={action} className="shrink-0">
                    <input type="hidden" name="pcoSongId" value={song.id} />
                    <SubmitButton variant="secondary" pendingLabel="Unignoring…">
                        Unignore<span className="sr-only"> {song.title}</span>
                    </SubmitButton>
                </form>
            </div>
            {state.status === "error" && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {state.message}
                </p>
            )}
        </li>
    );
}

/**
 * The songs set aside as not hymnal material, collapsed under their count
 * (the native `<details>`, which keeps its own open state), each with
 * Unignore, which puts it back on the list of songs not in the catalog.
 */
export default function IgnoredSongs({ songs }: IgnoredSongsProps) {
    const rowIds = useMemo(() => songs.map(({ id }) => id), [songs]);
    const { notice, announce } = useRowNotice(NOTICE_ID, headingIdOf);
    const unignored = useCallback(
        (pcoSongId: string, message: string) => announce(rowIds, pcoSongId, message),
        [announce, rowIds]
    );

    return (
        <div className="space-y-3">
            <RowNoticeText id={NOTICE_ID} notice={notice} />
            <details className="group bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-6 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                        Ignored songs
                    </span>
                    <span className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-300">
                        <span className="tabular-nums">{formatCount(songs.length)}</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                            className="h-4 w-4 transition-transform group-open:rotate-180"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                            />
                        </svg>
                    </span>
                </summary>
                {songs.length === 0 ? (
                    <p className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 sm:px-6 text-sm text-gray-500 dark:text-gray-400">
                        None. Ignore a Planning Center song that is not hymnal material to take it
                        off the list.
                    </p>
                ) : (
                    <ul className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                        {songs.map((song) => (
                            <IgnoredRow key={song.id} song={song} onUnignored={unignored} />
                        ))}
                    </ul>
                )}
            </details>
        </div>
    );
}
