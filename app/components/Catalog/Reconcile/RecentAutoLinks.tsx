"use client";

import Link from "next/link";
import { useActionState, useCallback, useMemo } from "react";
import {
    undoAutoLinkAction,
    type LinkActionState,
} from "@/app/(app)/catalog/reconcile/actions";
import LocalTime from "@/app/components/ui/LocalTime";
import SubmitButton from "@/app/components/ui/SubmitButton";
import { undoneMessage } from "@/lib/catalog/linkText";
import { songOptionLabel } from "@/lib/catalog/pickers";
import type { AutoLinkedSong } from "@/lib/domain";
import { IDLE_FORM, formStateKey } from "@/lib/forms";
import { routes } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";
import EntryLabels from "../EntryLabels";
import RowNoticeText from "./RowNoticeText";
import { useRowNotice } from "./useRowNotice";

interface RecentAutoLinksProps {
    /** The auto-links of the last days that still stand, newest first. */
    links: AutoLinkedSong[];
}

/** The id of the notice above the list. */
const NOTICE_ID = "auto-links-notice";

/** The id of a row's heading: an auto-link is the catalog song's, which has one link at most. */
function headingIdOf(songId: string): string {
    return `auto-link-${songId}`;
}

interface AutoLinkRowProps {
    link: AutoLinkedSong;
    /** Called once Undo succeeds (the row then leaves the list), with what to say. */
    onUndone: (songId: number, message: string) => void;
}

/** One auto-link: the Planning Center song, the catalog song it was linked to, when, and Undo. */
function AutoLinkRow({ link, onUndone }: AutoLinkRowProps) {
    const label = songOptionLabel(link);
    const pcoTitle = link.pcoTitle ?? `Planning Center song ${link.pcoSongId}`;
    const [state, action] = useActionState(
        async (previous: LinkActionState, formData: FormData): Promise<LinkActionState> => {
            const next = await undoAutoLinkAction(previous, formData);
            if (next.status === "success") {
                onUndone(link.songId, undoneMessage(pcoTitle, label));
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
                        id={headingIdOf(String(link.songId))}
                        tabIndex={-1}
                        className="font-medium text-gray-900 dark:text-gray-100 focus:outline-none"
                    >
                        {pcoTitle}
                        <span aria-hidden="true" className="text-gray-500 dark:text-gray-400">
                            {" "}
                            →{" "}
                        </span>
                        <span className="sr-only"> is linked to </span>
                        {/* Default prefetch: a song's page reads the local database (convention 13). */}
                        <Link href={routes.catalogSong(link.songId)} className={LINK_CLASS}>
                            {label}
                        </Link>
                    </h3>
                    <div className="text-sm text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-3">
                        <EntryLabels entries={link.entries} />
                        <span>
                            linked <LocalTime iso={link.linkedAt} />
                        </span>
                    </div>
                </div>
                <form action={action} className="shrink-0">
                    <input type="hidden" name="songId" value={link.songId} />
                    <input type="hidden" name="pcoSongId" value={link.pcoSongId} />
                    <SubmitButton variant="secondary" pendingLabel="Undoing…">
                        Undo<span className="sr-only"> the link to {label}</span>
                    </SubmitButton>
                </form>
            </div>
            {state.status === "error" && (
                // A new key per attempt: a repeated refusal is announced again.
                <p
                    key={formStateKey(state)}
                    role="alert"
                    className="text-sm text-red-600 dark:text-red-400"
                >
                    {state.message}
                </p>
            )}
        </li>
    );
}

/**
 * The links syncs made on their own lately, newest first, for review: each
 * with Undo, which unlinks the two songs and keeps syncs from linking them
 * again (a link by hand still can). An undone row leaves the list, and its
 * Planning Center song goes back on the list above.
 */
export default function RecentAutoLinks({ links }: RecentAutoLinksProps) {
    const rowIds = useMemo(() => links.map(({ songId }) => String(songId)), [links]);
    const { notice, announce } = useRowNotice(NOTICE_ID, headingIdOf);
    const undone = useCallback(
        (songId: number, message: string) => announce(rowIds, String(songId), message),
        [announce, rowIds]
    );

    return (
        <div className="space-y-3">
            <RowNoticeText id={NOTICE_ID} notice={notice} />
            {links.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">None lately.</p>
            ) : (
                <ul className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                    {links.map((link) => (
                        <AutoLinkRow key={link.songId} link={link} onUndone={undone} />
                    ))}
                </ul>
            )}
        </div>
    );
}
