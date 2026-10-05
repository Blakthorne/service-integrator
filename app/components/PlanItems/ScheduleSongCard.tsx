"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { CatalogMatch, PlanItemWithSong, ScheduleSelection } from "@/lib/domain";
import type { CardNoteBadge, HymnNoteShownState } from "@/lib/hymnNoteText";
import { describeRepeatWarning, type RepeatWarning } from "@/lib/repeatWarnings";
import { routes } from "@/lib/routes";
import {
    SAVED_AFTER_FAILURE_NOTICE,
    differentSongTitle,
    linkedNotice,
    saveFailureText,
    scheduleChoices,
    type ScheduleSongView,
} from "@/lib/scheduleCards";
import type { ChooseOption, SetCustomText } from "@/lib/scheduleSelections";
import type { SelectionSaveState } from "@/lib/scheduleSelectionsStore";
import EntryNumbers from "./EntryNumbers";
import LinkToCatalogInline, { type LinkSong } from "./LinkToCatalogInline";
import type { RetrySave } from "./PlanProvider";
import ScheduleChoices from "./ScheduleChoices";

/** A song item with its Schedule-tab selection. */
type ItemWithSelection = PlanItemWithSong & ScheduleSelection;

/** Muted text under a card's title. */
const NOTE_CLASS = "text-sm text-gray-600 dark:text-gray-400";

/**
 * Each hymnal note status's badge colours, as the dashboard's: green in
 * sync, amber to be synced, grey for a note left alone, as the sync dialog
 * tags it. The words say the same, so colour is never the only sign.
 */
const NOTE_BADGE_CLASSES: Readonly<Record<HymnNoteShownState, string>> = {
    "in-sync":
        "bg-green-50 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900",
    differs:
        "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    missing:
        "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    kept: "bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700",
};

/** A card's hymnal note status, under its title: "Note in sync"; and, for a note left alone, why. */
function NoteBadge({ badge }: { badge: CardNoteBadge }) {
    return (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    NOTE_BADGE_CLASSES[badge.state]
                }`}
            >
                {badge.label}
            </span>
            {badge.detail !== null && (
                <span className="text-xs text-gray-600 dark:text-gray-400">{badge.detail}</span>
            )}
        </p>
    );
}

/**
 * A card's warning that its song was sung lately: "Sung Sep 20 (2 weeks
 * ago)", a link to that plan. The words, not the colour, say it is a warning
 * (a screen reader hears "Repeat:" first), and the link is underlined since
 * its colour alone is under 3:1 against the line's. It does not prefetch
 * (convention 13): a plan's page reads the plan from Planning Center.
 */
function RepeatWarningLine({ warning }: { warning: RepeatWarning }) {
    return (
        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v4m0 4h.01M10.3 3.9L2.4 17.6A2 2 0 004.1 20.5h15.8a2 2 0 001.7-2.9L13.7 3.9a2 2 0 00-3.4 0z"
                />
            </svg>
            <span>
                <span className="sr-only">Repeat: </span>
                <Link
                    prefetch={false}
                    href={routes.plan(warning.serviceTypeId, warning.planId)}
                    className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                >
                    {describeRepeatWarning(warning)}
                    <span className="sr-only">, open that plan</span>
                </Link>
            </span>
        </p>
    );
}

/**
 * The catalog song a linked song is: its hymn's title (a link to the song's
 * page) and its tune, then where it is in the books.
 */
function LinkedSong({ match }: { match: CatalogMatch }) {
    return (
        <div className="space-y-1">
            <p className="text-sm text-gray-700 dark:text-gray-300">
                {/* Default prefetch: a catalog song's page reads the local database (convention 13). */}
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

/**
 * The line under a card's choices when its choice could not be saved: why,
 * as an alert that is new for each failure (so a repeated one is announced
 * again), and Retry. Retry stays put while it runs, `aria-disabled` rather
 * than disabled, so it keeps focus.
 */
function SaveFailure({
    state,
    onRetry,
}: {
    state: Extract<SelectionSaveState, { status: "failed" }>;
    onRetry: () => void;
}) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <p key={state.attempt} role="alert" className="text-red-600 dark:text-red-400">
                {saveFailureText(state.message)}
            </p>
            <button
                type="button"
                onClick={() => {
                    if (!state.retrying) {
                        onRetry();
                    }
                }}
                aria-disabled={state.retrying}
                className={`rounded-sm font-medium text-blue-600 dark:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    state.retrying
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer hover:text-blue-800 hover:underline dark:hover:text-blue-300"
                }`}
            >
                {state.retrying ? "Retrying…" : "Retry"}
            </button>
        </div>
    );
}

interface ScheduleSongCardProps {
    item: ItemWithSelection;
    /** Which card it is (see `scheduleSongView`). */
    view: ScheduleSongView;
    /** Its hymnal note's status (see `cardNoteBadge`); null when there is nothing to say. */
    noteBadge: CardNoteBadge | null;
    /** How the save of its choice stands; null when it is saved, or was never changed. */
    saveState: SelectionSaveState | null;
    /** The plan its song was last sung in, when that was lately; null for no warning. */
    repeatWarning: RepeatWarning | null;
    /** What goes between a song's numbers, from the settings, for what a Link says. */
    numberSeparator: string;
    /** This Schedule tab's address, where the new-song form comes back to. */
    scheduleHref: string;
    onChooseOption: ChooseOption;
    onCustomTextChange: SetCustomText;
    onRetrySave: RetrySave;
    onLink: LinkSong;
}

/**
 * A song item on the Schedule tab: its title, a warning when its song was
 * sung lately ("Sung Sep 20 (2 weeks ago)", linking to that plan), its
 * hymnal note's status (in sync, needs sync, missing, or left alone: a note
 * the app did not write), then what the catalog knows of it, then the
 * choices for its line in the schedule text.
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
 *
 * Each choice is saved as it is made. One that could not be saved stays
 * chosen, and the card says so under its choices, with Retry
 * (`SaveFailure`). Once a later save goes through, that line goes and the
 * status region says "Saved."; when focus was on Retry, which goes with the
 * line, the heading takes it.
 */
export default function ScheduleSongCard({
    item,
    view,
    noteBadge,
    saveState,
    repeatWarning,
    numberSeparator,
    scheduleHref,
    onChooseOption,
    onCustomTextChange,
    onRetrySave,
    onLink,
}: ScheduleSongCardProps) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    /** True once a Link made on this card has gone through. */
    const [linkedHere, setLinkedHere] = useState(false);
    const linkNotice = linkedHere ? linkedNotice(view, numberSeparator) : null;
    const failure = saveState?.status === "failed" ? saveState : null;
    /** True once a save has gone through after a failure, until the next save starts. */
    const [savedAgain, setSavedAgain] = useState(false);
    const failedBefore = useRef(false);
    const notice = linkNotice ?? (savedAgain ? SAVED_AFTER_FAILURE_NOTICE : null);

    // In a transition, like the revalidated plan the action brings, so the
    // notice can land with it.
    const onLinked = useCallback(() => {
        startTransition(() => setLinkedHere(true));
    }, []);

    useEffect(() => {
        if (linkNotice !== null) {
            headingRef.current?.focus();
        }
    }, [linkNotice]);

    useEffect(() => {
        if (saveState !== null) {
            failedBefore.current ||= saveState.status === "failed";
            setSavedAgain(false);
            return;
        }
        if (!failedBefore.current) {
            return;
        }
        failedBefore.current = false;
        setSavedAgain(true);
        // Retry went with the failure's line: focus would be on the body.
        if (document.activeElement === null || document.activeElement === document.body) {
            headingRef.current?.focus();
        }
    }, [saveState]);

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h3
                ref={headingRef}
                tabIndex={-1}
                className="text-lg font-medium text-gray-900 dark:text-gray-100 focus:outline-none"
            >
                {item.title}
            </h3>
            {repeatWarning !== null && <RepeatWarningLine warning={repeatWarning} />}
            {noteBadge !== null && <NoteBadge badge={noteBadge} />}
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
                    {/* Underlined: in running text, its colour alone is under 3:1 against the text's. */}
                    <Link
                        href={routes.catalogReconcile()}
                        prefetch={false}
                        className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
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
            {failure !== null && (
                <SaveFailure state={failure} onRetry={() => onRetrySave(item.id)} />
            )}
        </div>
    );
}
