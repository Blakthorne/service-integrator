"use client";

import { useRef, useState } from "react";
import { exportCatalogAction } from "@/app/(app)/settings/actions";
import { catalogExportFileName } from "@/lib/catalog/exportJson";
import {
    EXPORT_BUTTON_LABEL,
    EXPORT_COULD_NOT_START_MESSAGE,
    EXPORT_PENDING_LABEL,
    EXPORT_PENDING_STATUS,
    describeExported,
} from "@/lib/catalog/exportText";
import { buttonClasses } from "../ui/buttonClasses";
import { downloadJson } from "./downloadJson";

/** What the last export said went wrong; `attempt` keys its alert, so the same words twice are announced twice. */
interface Failure {
    attempt: number;
    message: string;
}

/**
 * "Export catalog (JSON)": asks the server for the catalog's JSON and saves it
 * as `catalog-YYYY-MM-DD.json` (`catalogExportFileName`, by the browser's own
 * calendar), in the browser, from a Blob (`downloadJson`).
 *
 * The action is called straight from the click and its pending state lives in
 * `useState`: inside a form action or a transition it would hold a transition
 * open until the catalog was read, and every navigation would wait for it
 * (convention 15). While it runs the button is `aria-disabled`, not
 * `disabled`, so it keeps focus. What it did goes in a status region that is
 * always rendered, empty while the export runs so the same line twice is
 * announced twice; a failure is an alert keyed per attempt.
 */
export default function ExportCatalogButton() {
    const [pending, setPending] = useState(false);
    const [done, setDone] = useState("");
    const [failure, setFailure] = useState<Failure | null>(null);
    const attempts = useRef(0);

    function fail(message: string): void {
        attempts.current += 1;
        setFailure({ attempt: attempts.current, message });
    }

    async function handleClick() {
        if (pending) {
            return;
        }
        setPending(true);
        setDone("");
        setFailure(null);
        try {
            const exported = await exportCatalogAction();
            if (exported.ok) {
                // Named by the browser's calendar, so the date is the viewer's today.
                const fileName = catalogExportFileName(new Date());
                downloadJson(fileName, exported.json);
                setDone(describeExported(fileName));
            } else {
                fail(exported.message);
            }
        } catch (error) {
            console.error("Exporting the catalog failed:", error);
            fail(EXPORT_COULD_NOT_START_MESSAGE);
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <button
                    type="button"
                    onClick={handleClick}
                    aria-disabled={pending}
                    className={`shrink-0 self-start ${buttonClasses("primary", pending)}`}
                >
                    {pending ? EXPORT_PENDING_LABEL : EXPORT_BUTTON_LABEL}
                </button>
                {/* Always rendered, so a screen reader announces what appears in it. */}
                <p role="status" className="text-sm text-gray-600 dark:text-gray-300">
                    {pending ? EXPORT_PENDING_STATUS : done}
                </p>
            </div>
            {failure && (
                <p
                    key={failure.attempt}
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                >
                    {failure.message}
                </p>
            )}
        </div>
    );
}
