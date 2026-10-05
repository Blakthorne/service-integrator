"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { CatalogMatch, PlanItemWithSong, ScheduleSelection } from "@/lib/domain";
import { routes } from "@/lib/routes";
import {
    differentSongTitle,
    linkedNotice,
    scheduleChoices,
    type ScheduleSongView,
} from "@/lib/scheduleCards";
import type { ChooseOption, SetCustomText } from "@/lib/scheduleSelections";
import EntryNumbers from "./EntryNumbers";
import LinkToCatalogInline, { type LinkSong } from "./LinkToCatalogInline";
import ScheduleChoices from "./ScheduleChoices";

/** A song item with its Schedule-tab selection. */
type ItemWithSelection = PlanItemWithSong & ScheduleSelection;

/** Muted text under a card's title. */
const NOTE_CLASS = "text-sm text-gray-600 dark:text-gray-400";

/**
 * The catalog song a linked song is: its hymn's title (a link to the song's
 * page) and its tune, then where it is in the books.
 */
function LinkedSong({ match }: { match: CatalogMatch }) {
    return (
        <div className="space-y-1">
            <p className="text-sm text-gray-700 dark:text-gray-300">
                {/* Default prefetch: a catalog song's page reads only the local database. */}
                <Link
                    href={routes.catalogSong(match.songId)}
                    className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                >
                    {match.title}
                </Link>
                <span className="text-gray-500 dark:text-gray-400">
                    {" · "}
                    {match.tuneName ?? "tune unknown"}
                </span>
            </p>
            <EntryNumbers entries={match.entries} />
        </div>
    );
}

interface ScheduleSongCardProps {
    item: ItemWithSelection;
    /** Which card it is (see `scheduleSongView`). */
    view: ScheduleSongView;
    /** This Schedule tab's address, where the new-song form comes back to. */
    scheduleHref: string;
    onChooseOption: ChooseOption;
    onCustomTextChange: SetCustomText;
    onLink: LinkSong;
}

/**
 * A song item on the Schedule tab: its title, then what the catalog knows of
 * it, then the choices for its line in the schedule text.
 *
 * - Linked: the catalog song's title and tune and its numbers
 *   (`EntryNumbers`); Numbers, Leave blank or Custom.
 * - Not linked: suggestions to link it to, or ways to find or create its
 *   catalog song (`LinkToCatalogInline`); Leave blank or Custom.
 * - Set aside on Reconcile, without a Planning Center song, or with the
 *   catalog unavailable (the tab's banner says so): a note, or nothing;
 *   Leave blank or Custom.
 *
 * The middle part is one slot and the choices always come last, so when a
 * link turns the card from suggestions to numbers React keeps the choices,
 * and a custom text being typed keeps its focus.
 *
 * A Link made here removes the button it was made with, so the card takes
 * over, as Reconcile's rows do (`useRowNotice`): it says what was linked
 * ("Linked: R-396 / G-317") in a status region that is always in the card,
 * empty until then, so screen readers announce it, and moves focus to its
 * heading rather than leave it on the page's body. Both wait for the
 * revalidated plan to show the link.
 */
export default function ScheduleSongCard({
    item,
    view,
    scheduleHref,
    onChooseOption,
    onCustomTextChange,
    onLink,
}: ScheduleSongCardProps) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    /** True once a Link made on this card has gone through. */
    const [linkedHere, setLinkedHere] = useState(false);
    const notice = linkedHere ? linkedNotice(view) : null;

    // In a transition, like the revalidated plan the action brings, so the
    // notice can land with it.
    const onLinked = useCallback(() => {
        startTransition(() => setLinkedHere(true));
    }, []);

    useEffect(() => {
        if (notice !== null) {
            headingRef.current?.focus();
        }
    }, [notice]);

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3
                ref={headingRef}
                tabIndex={-1}
                className="text-lg font-medium text-gray-900 dark:text-gray-100 focus:outline-none"
            >
                {item.title}
            </h3>
            {view.kind === "linked" ? (
                <LinkedSong match={view.match} />
            ) : view.kind === "unlinked" ? (
                <LinkToCatalogInline
                    pcoSongId={view.pcoSongId}
                    suggestions={view.suggestions}
                    songTitle={differentSongTitle(item)}
                    returnTo={scheduleHref}
                    onLink={onLink}
                    onLinked={onLinked}
                />
            ) : view.kind === "ignored" ? (
                <p className={NOTE_CLASS}>
                    Set aside on{" "}
                    <Link
                        href={routes.catalogReconcile()}
                        prefetch={false}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                        Reconcile
                    </Link>{" "}
                    as not hymnal material.
                </p>
            ) : view.kind === "no-song" ? (
                <p className={NOTE_CLASS}>No Planning Center song, so no numbers.</p>
            ) : null}
            <p
                role="status"
                className={notice === null ? "sr-only" : "text-sm font-medium text-green-700 dark:text-green-300"}
            >
                {notice}
            </p>
            <ScheduleChoices
                item={item}
                choices={scheduleChoices(view)}
                onChooseOption={onChooseOption}
                onCustomTextChange={onCustomTextChange}
            />
        </div>
    );
}
