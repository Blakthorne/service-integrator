"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { describeCancelledCreditLabels, describeRequestedCreditLabels } from "@/lib/creditLabels";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { cancelCreditLabels, requestCreditLabels } from "@/lib/queries/credits";
import { readRequestedCreditLabels } from "@/lib/requestedCreditLabels";
import { routes } from "@/lib/routes";

/** What the Credits page's actions say: whether it went as asked, and a sentence. */
export interface CreditLabelsActionResult {
    ok: boolean;
    message: string;
}

/** What an action says when what it was sent is not what the page sends: a stale or tampered page. */
const NOT_LABELS_MESSAGE = "This page asked for labels that cannot be written. Reload it and try again.";

/**
 * A server action is a public POST endpoint, so each one checks the session
 * itself rather than relying on the middleware (convention 15), and throws
 * without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

/**
 * The Credits page's Label: queue the labels the page showed for the songs
 * the person chose, `asked` (`[{ pcoSongId, shownAuthor, author }]`), and
 * start the credit labels job, which writes them to Planning Center in the
 * background (`requestCreditLabels`). Every id goes through `parsePcoId`
 * and the rest through `readRequestedCreditLabels`; anything else is
 * answered with a message, asking for nothing. The page is revalidated, so
 * it shows the labels waiting; the job's writes show as the page refreshes
 * while they wait.
 *
 * It only writes the local database, but the page calls it from a click,
 * with its pending state in `useState`, as the song page's writes are
 * (convention 15): the labels come from the page's own state, not a form.
 */
export async function requestCreditLabelsAction(asked: unknown): Promise<CreditLabelsActionResult> {
    await requireSession();
    const labels = readRequestedCreditLabels(asked);
    if (labels === null) {
        return { ok: false, message: NOT_LABELS_MESSAGE };
    }
    let result;
    try {
        result = requestCreditLabels(labels);
    } catch (error) {
        console.error("Failed to queue the credit labels:", error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    revalidatePath(routes.catalogCredits());
    return { ok: result.queued + result.waiting > 0, message: describeRequestedCreditLabels(result) };
}

/**
 * The Credits page's Stop: end every label that waits, so none of them is
 * written (`cancelCreditLabels`; one being written as it runs is written
 * all the same). The page is revalidated.
 */
export async function cancelCreditLabelsAction(): Promise<CreditLabelsActionResult> {
    await requireSession();
    let cancelled: number;
    try {
        cancelled = cancelCreditLabels();
    } catch (error) {
        console.error("Failed to stop the credit labels:", error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    revalidatePath(routes.catalogCredits());
    return { ok: true, message: describeCancelledCreditLabels(cancelled) };
}
