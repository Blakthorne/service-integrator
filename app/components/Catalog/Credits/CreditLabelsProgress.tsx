"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    cancelCreditLabelsAction,
    type CreditLabelsActionResult,
} from "@/app/(app)/catalog/credits/actions";
import { buttonClasses } from "@/app/components/ui/buttonClasses";

/** How often the page reads the database again while labels wait, to show how the writing goes. */
export const CREDIT_LABELS_REFRESH_MS = 5000;

/** What the page says when Stop itself fails (no session, the network). */
const COULD_NOT_STOP: CreditLabelsActionResult = {
    ok: false,
    message: "The labels could not be stopped. Reload the page to see whether they are still waiting.",
};

interface CreditLabelsProgressProps {
    /** How many labels wait to be written. */
    waiting: number;
}

/**
 * How many labels wait to be written, with Stop, which ends them unwritten
 * (`cancelCreditLabelsAction`, called from its click with its pending
 * state in `useState`, convention 15). While any wait, the page is read
 * again every few seconds (`router.refresh()`: it reads only the local
 * database), so the counts and the rows follow the background job; once
 * none wait it stops. With none waiting it says so and offers nothing.
 */
export default function CreditLabelsProgress({ waiting }: CreditLabelsProgressProps) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<CreditLabelsActionResult | null>(null);

    useEffect(() => {
        if (waiting === 0) {
            return;
        }
        const timer = setInterval(() => router.refresh(), CREDIT_LABELS_REFRESH_MS);
        return () => clearInterval(timer);
    }, [waiting, router]);

    async function stop() {
        if (pending) {
            return;
        }
        setPending(true);
        setResult(null);
        try {
            setResult(await cancelCreditLabelsAction());
        } catch (error) {
            console.error("Stopping the credit labels failed:", error);
            setResult(COULD_NOT_STOP);
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
                {waiting === 0
                    ? "No labels are waiting to be written."
                    : `${waiting} ${waiting === 1 ? "label is" : "labels are"} waiting to be written to Planning Center.`}
            </p>
            {waiting > 0 && (
                <button
                    type="button"
                    aria-disabled={pending}
                    onClick={stop}
                    className={`shrink-0 self-start ${buttonClasses("secondary", pending)}`}
                >
                    {pending ? "Stopping…" : "Stop"}
                </button>
            )}
            <p
                role="status"
                className={`text-sm ${
                    result?.ok === false
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-600 dark:text-gray-300"
                }`}
            >
                {result?.message}
            </p>
        </div>
    );
}
