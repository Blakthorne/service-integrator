"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import {
    ignorePcoSongAction,
    linkSongAction,
    type LinkActionState,
} from "@/app/(app)/catalog/reconcile/actions";
import SubmitButton from "@/app/components/ui/SubmitButton";
import { parseCatalogId } from "@/lib/catalog/ids";
import { formatLastScheduled } from "@/lib/catalog/lastScheduled";
import {
    LINK_REASON_DESCRIPTIONS,
    LINK_REASON_LABELS,
    ignoredMessage,
    linkedMessage,
} from "@/lib/catalog/linkText";
import { songOptionLabel } from "@/lib/catalog/pickers";
import type { CatalogSongOption, LinkSuggestion, UnlinkedPcoSong } from "@/lib/domain";
import { IDLE_FORM, formStateKey } from "@/lib/forms";
import { routes } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";
import EntryLabels from "../EntryLabels";
import LinkForm from "./LinkForm";
import PcoSongWebLink from "./PcoSongWebLink";
import SongPicker from "./SongPicker";

interface UnlinkedSongRowProps {
    row: UnlinkedPcoSong;
    /** Every catalog song, by title, for the picker and for naming the song linked. */
    catalogSongs: readonly CatalogSongOption[];
    /** The id of the row's heading, where focus goes when the row above it leaves. */
    headingId: string;
    /** Called once the row's song is linked or ignored (it then leaves the list), with what to say. */
    onResolved: (pcoSongId: string, message: string) => void;
}

/** The look of a secondary action that is a link, such as "New catalog song". */
const SECONDARY_LINK_CLASS =
    "px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors";

/** A suggestion's reason, as a small tag with its explanation as a tooltip. */
function ReasonTag({ suggestion }: { suggestion: LinkSuggestion }) {
    return (
        <span
            title={LINK_REASON_DESCRIPTIONS[suggestion.reason]}
            className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300"
        >
            {LINK_REASON_LABELS[suggestion.reason]}
        </span>
    );
}

/**
 * A Planning Center song with no catalog song, on Reconcile: its title,
 * author and when it was last scheduled, the catalog songs it may be (each
 * with Link, or a note when that song is linked to another Planning Center
 * song), and the other ways out: a search over every catalog song, a new
 * catalog song made from it, or Ignore when it is not hymnal material.
 *
 * Its Link forms share one action, and Ignore has its own; each comes back
 * through `useActionState`, with a refusal shown in the row. Once one
 * succeeds the row leaves the list (the action revalidates the page), so
 * the action tells the list first (`onResolved`), which says what was done
 * and moves focus on.
 */
export default function UnlinkedSongRow({
    row,
    catalogSongs,
    headingId,
    onResolved,
}: UnlinkedSongRowProps) {
    const { pcoSong, suggestions } = row;
    const pickerId = useId();
    const [pickerOpen, setPickerOpen] = useState(false);

    const [linkState, linkAction] = useActionState(
        async (state: LinkActionState, formData: FormData): Promise<LinkActionState> => {
            const next = await linkSongAction(state, formData);
            if (next.status === "success") {
                const songId = parseCatalogId(formData.get("songId"));
                const song = catalogSongs.find((option) => option.songId === songId);
                onResolved(
                    pcoSong.id,
                    linkedMessage(pcoSong.title, song ? songOptionLabel(song) : "the catalog song")
                );
            }
            return next;
        },
        IDLE_FORM
    );
    const [ignoreState, ignoreAction] = useActionState(
        async (state: LinkActionState, formData: FormData): Promise<LinkActionState> => {
            const next = await ignorePcoSongAction(state, formData);
            if (next.status === "success") {
                onResolved(pcoSong.id, ignoredMessage(pcoSong.title));
            }
            return next;
        },
        IDLE_FORM
    );

    const scheduled = formatLastScheduled(pcoSong.lastScheduledAt);
    const details = [
        pcoSong.author,
        scheduled ? `last scheduled ${scheduled}` : "never scheduled",
        pcoSong.hidden ? "hidden in Planning Center" : null,
    ].filter(Boolean);

    return (
        <article
            aria-labelledby={headingId}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-5 space-y-4"
        >
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                    <h3
                        id={headingId}
                        tabIndex={-1}
                        className="text-lg font-semibold text-gray-900 dark:text-gray-100 focus:outline-none"
                    >
                        {pcoSong.title}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{details.join(" · ")}</p>
                </div>
                <PcoSongWebLink pcoSongId={pcoSong.id} />
            </header>

            {suggestions.length > 0 ? (
                <div>
                    <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Catalog songs it may be
                    </h4>
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700">
                        {suggestions.map((suggestion) => {
                            const label = songOptionLabel(suggestion);
                            return (
                                <li
                                    key={suggestion.songId}
                                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                                >
                                    <div className="min-w-0 space-y-0.5">
                                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            {/* Default prefetch: a song's page reads the local database (convention 13). */}
                                            <Link
                                                href={routes.catalogSong(suggestion.songId)}
                                                className={`font-medium ${LINK_CLASS}`}
                                            >
                                                {label}
                                            </Link>
                                            <ReasonTag suggestion={suggestion} />
                                        </p>
                                        <div className="text-sm text-gray-600 dark:text-gray-400">
                                            <EntryLabels entries={suggestion.entries} />
                                        </div>
                                    </div>
                                    {suggestion.pcoSongId === null ? (
                                        <LinkForm
                                            action={linkAction}
                                            songId={suggestion.songId}
                                            pcoSongId={pcoSong.id}
                                            songLabel={label}
                                        />
                                    ) : (
                                        <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                                            Linked to another Planning Center song
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ) : (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    No catalog song has a title like this one.
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    aria-expanded={pickerOpen}
                    aria-controls={pickerOpen ? pickerId : undefined}
                    onClick={() => setPickerOpen((open) => !open)}
                    className={`${SECONDARY_LINK_CLASS} cursor-pointer`}
                >
                    {pickerOpen ? "Close the search" : "Choose another song"}
                </button>
                {/* No prefetch: the form loads every hymn and tune. */}
                <Link
                    prefetch={false}
                    href={routes.catalogSongNew({
                        pcoSongId: pcoSong.id,
                        returnTo: routes.catalogReconcile(),
                    })}
                    className={SECONDARY_LINK_CLASS}
                >
                    New catalog song
                </Link>
                <form action={ignoreAction}>
                    <input type="hidden" name="pcoSongId" value={pcoSong.id} />
                    <SubmitButton variant="secondary" pendingLabel="Ignoring…">
                        Ignore
                    </SubmitButton>
                </form>
            </div>

            {pickerOpen && (
                <SongPicker
                    id={pickerId}
                    pcoSongId={pcoSong.id}
                    catalogSongs={catalogSongs}
                    linkAction={linkAction}
                />
            )}

            {[linkState, ignoreState].map((state) =>
                state.status === "error" ? (
                    // A new key per attempt: a repeated refusal is announced again.
                    <p
                        key={formStateKey(state)}
                        role="alert"
                        className="text-sm text-red-600 dark:text-red-400"
                    >
                        {state.message}
                    </p>
                ) : null
            )}
        </article>
    );
}
