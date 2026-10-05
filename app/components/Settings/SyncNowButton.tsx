"use client";

import { useState } from "react";
import {
    syncPcoSongsAction,
    syncPlanHistoryAction,
    type SyncNowResult,
} from "@/app/(app)/settings/actions";
import { buttonClasses } from "../ui/buttonClasses";

/** What the button says when the action itself fails (no session, the network). */
const COULD_NOT_SYNC: SyncNowResult = {
    ok: false,
    message: "The sync could not be started. Reload the page and try again.",
};

/** The syncs a button can run. */
export type SyncKind = "songs" | "history";

/** What each sync's button says, and the action it calls. */
const SYNCS: Readonly<
    Record<
        SyncKind,
        {
            action: () => Promise<SyncNowResult>;
            label: string;
            /** What is under way, beside the button, while the action runs. */
            reading: string;
        }
    >
> = {
    songs: {
        action: syncPcoSongsAction,
        label: "Sync now",
        reading: "Reading the song library from Planning Center…",
    },
    history: {
        action: syncPlanHistoryAction,
        label: "Sync history now",
        reading:
            "Reading the plans from Planning Center… The first sync takes a minute or two; later ones, seconds.",
    },
};

interface SyncNowButtonProps {
    /** Which sync it runs: the song library's (the default) or the plan history's. */
    kind?: SyncKind;
}

/**
 * "Sync now" for the Planning Center song sync, on Settings and Reconcile,
 * and "Sync history now" for the plan history sync (`kind="history"`), on
 * Settings and Reports: it runs the sync (or joins the one in progress) and
 * says how it went beside the button; the page's own sync status updates
 * with the action's revalidation.
 *
 * A sync can take a while, so the action is called straight from the click
 * and its pending state lives in `useState`. Inside a form action or a
 * transition it would hold a transition open until the sync returned, and
 * every navigation (a link, Back) would wait for it (convention 15). While
 * it runs the button is `aria-disabled`, not `disabled`, so it keeps focus.
 */
export default function SyncNowButton({ kind = "songs" }: SyncNowButtonProps) {
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<SyncNowResult | null>(null);
    const { action, label, reading } = SYNCS[kind];

    async function handleClick() {
        if (pending) {
            return;
        }
        setPending(true);
        setResult(null);
        try {
            setResult(await action());
        } catch (error) {
            console.error("Sync now failed:", error);
            setResult(COULD_NOT_SYNC);
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <button
                type="button"
                onClick={handleClick}
                aria-disabled={pending}
                className={`shrink-0 self-start ${buttonClasses("primary", pending)}`}
            >
                {pending ? "Syncing…" : label}
            </button>
            <p
                role="status"
                className={`text-sm ${
                    result?.ok === false
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-600 dark:text-gray-300"
                }`}
            >
                {pending ? reading : result?.message}
            </p>
        </div>
    );
}
