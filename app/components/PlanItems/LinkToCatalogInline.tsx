"use client";

import Link from "next/link";
import { useId, useState } from "react";
import EntryLabels from "../Catalog/EntryLabels";
// Type-only: the card gets the action through `onLink`.
import type { LinkPcoSongState } from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
import type { LinkSuggestion } from "@/lib/domain";
import { routes } from "@/lib/routes";

/** Link Planning Center song `pcoSongId` to catalog song `songId`, as `linkPcoSong` does. */
export type LinkSong = (pcoSongId: string, songId: number) => Promise<LinkPcoSongState>;

/** What a Link button says, and whether it takes clicks. */
type LinkStatus = { songId: number; state: "linking" | "linked" };

/** Shown when the action never answered: the network failed, or the session ended. */
const NO_ANSWER_MESSAGE =
    "The link could not be made: the server did not answer. Reload the page and try again.";

const LINK_CLASS =
    "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline";

interface LinkToCatalogInlineProps {
    /** The Planning Center song the item schedules, which is not linked. */
    pcoSongId: string;
    /** The best few catalog songs for it, best first; perhaps none. */
    suggestions: readonly LinkSuggestion[];
    /** The Planning Center song's title when the item calls it something else, else null. */
    songTitle: string | null;
    /** Where the new-song form comes back to: this Schedule tab. */
    returnTo: string;
    onLink: LinkSong;
}

/**
 * A song whose Planning Center song has no catalog song yet: its suggestions,
 * each with a one-click Link, then "Create in catalog" (the new-song form,
 * prefilled from the Planning Center song, which links it and comes back
 * here) and "Find in catalog" (Reconcile, to search every catalog song).
 *
 * A link in progress lives in `useState`, not a transition (convention 15).
 * Once it is made, the action's revalidation re-renders the plan and the
 * card turns into the linked song's numbers; until then the suggestion says
 * "Linked". A refusal or failure shows its message below.
 */
export default function LinkToCatalogInline({
    pcoSongId,
    suggestions,
    songTitle,
    returnTo,
    onLink,
}: LinkToCatalogInlineProps) {
    const headingId = useId();
    const [status, setStatus] = useState<LinkStatus | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    /** Counts the Links tried here, so each refusal is a new alert, announced even when it repeats the last. */
    const [attempt, setAttempt] = useState(0);

    async function link(songId: number) {
        if (status !== null) {
            return;
        }
        setStatus({ songId, state: "linking" });
        setMessage(null);
        setAttempt((count) => count + 1);
        let result: LinkPcoSongState;
        try {
            result = await onLink(pcoSongId, songId);
        } catch (error) {
            console.error("Failed to link:", error);
            result = { ok: false, message: NO_ANSWER_MESSAGE };
        }
        if (result.ok) {
            setStatus({ songId, state: "linked" });
        } else {
            setStatus(null);
            setMessage(result.message);
        }
    }

    return (
        <div className="space-y-2">
            <p id={headingId} className="text-sm text-gray-600 dark:text-gray-400">
                {songTitle !== null ? (
                    <>Its Planning Center song, &ldquo;{songTitle}&rdquo;, is not in the catalog yet.</>
                ) : (
                    "Not in the catalog yet."
                )}{" "}
                {suggestions.length > 0
                    ? "Link it to:"
                    : "No catalog song looks like it."}
            </p>
            {suggestions.length > 0 && (
                <ul
                    aria-labelledby={headingId}
                    className="divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700"
                >
                    {suggestions.map((suggestion) => {
                        const mine = status?.songId === suggestion.songId;
                        return (
                            <li
                                key={suggestion.songId}
                                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm text-gray-900 dark:text-gray-100">
                                        <span className="font-medium">{suggestion.title}</span>
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {" · "}
                                            {suggestion.tuneName ?? "tune unknown"}
                                        </span>
                                    </p>
                                    <div className="text-sm text-gray-700 dark:text-gray-300">
                                        <EntryLabels entries={suggestion.entries} />
                                    </div>
                                </div>
                                {suggestion.pcoSongId !== null ? (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        Linked to another Planning Center song
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => link(suggestion.songId)}
                                        // aria-disabled, not disabled, so the button keeps focus
                                        // while the link is made (as SubmitButton does).
                                        aria-disabled={status !== null}
                                        className={`px-3 py-1 text-sm font-medium rounded-md border border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                                            status !== null
                                                ? "opacity-60 cursor-not-allowed"
                                                : "cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700"
                                        }`}
                                    >
                                        {mine && status.state === "linking"
                                            ? "Linking…"
                                            : mine && status.state === "linked"
                                              ? "Linked"
                                              : "Link"}
                                        <span className="sr-only">
                                            {` to ${suggestion.title}, ${suggestion.tuneName ?? "tune unknown"}`}
                                        </span>
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {/* prefetch={false}: the form may read the song from Planning Center. */}
                <Link
                    href={routes.catalogSongNew({ pcoSongId, returnTo })}
                    prefetch={false}
                    className={LINK_CLASS}
                >
                    Create in catalog
                </Link>
                {/* prefetch={false}: Reconcile suggests songs for the whole library. */}
                <Link
                    href={routes.catalogReconcile()}
                    prefetch={false}
                    className={LINK_CLASS}
                >
                    Find in catalog
                </Link>
            </p>
            {message !== null && (
                // Keyed by attempt: a screen reader announces an alert when it
                // appears, not when the same text is set again.
                <p key={attempt} role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {message}
                </p>
            )}
        </div>
    );
}
