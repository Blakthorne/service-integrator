"use client";

import { useState } from "react";
import { syncPcoSongsAction, type SyncNowResult } from "@/app/(app)/settings/actions";

/** What the button says when the action itself fails (no session, the network). */
const COULD_NOT_SYNC: SyncNowResult = {
    ok: false,
    message: "The sync could not be started. Reload the page and try again.",
};

/**
 * "Sync now" for the Planning Center song sync, on Settings and Reconcile:
 * it runs the sync (or joins the one in progress) and says how it went
 * beside the button; the page's own sync status updates with the action's
 * revalidation.
 *
 * A sync can take a while, so the action is called straight from the click
 * and its pending state lives in `useState`. Inside a form action or a
 * transition it would hold a transition open until the sync returned, and
 * every navigation (a link, Back) would wait for it (convention 15). While
 * it runs the button is `aria-disabled`, not `disabled`, so it keeps focus.
 */
export default function SyncNowButton() {
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<SyncNowResult | null>(null);

    async function handleClick() {
        if (pending) {
            return;
        }
        setPending(true);
        setResult(null);
        try {
            setResult(await syncPcoSongsAction());
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
                // SubmitButton's primary colours: white text is 5.3:1 on
                // blue-600, and the ring outside the button 3:1 on the page.
                className={`shrink-0 self-start px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors ${
                    pending ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700 cursor-pointer"
                }`}
            >
                {pending ? "Syncing…" : "Sync now"}
            </button>
            <p
                role="status"
                className={`text-sm ${
                    result?.ok === false
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-600 dark:text-gray-300"
                }`}
            >
                {pending ? "Reading the song library from Planning Center…" : result?.message}
            </p>
        </div>
    );
}
