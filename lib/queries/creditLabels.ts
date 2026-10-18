import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { checkCredits, parseCredits, renderCredits } from "@/lib/credits";
import {
    finishCreditLabel,
    listWaitingCreditLabels,
    putOffCreditLabel,
} from "@/lib/db/creditLabels";
import { errorMessage } from "@/lib/db/errors";
import { listStoredSettings } from "@/lib/db/settings";
import type { Credit, CreditLabelOutcome, CreditLabelRequest } from "@/lib/domain";
import { PcoError } from "@/lib/pco";
import { resolveSettings } from "@/lib/settings";
import { saveSongCredits } from "./pcoSongs";

/**
 * The credit labels job's work (lib/jobs.ts): write the labels that wait
 * (`credit_label_requests`; see lib/creditLabels.ts) to Planning Center, one
 * song at a time, paced.
 */

/** How many times a label's write may fail before its request ends as "failed". */
export const CREDIT_LABEL_MAX_ATTEMPTS = 3;

/** A run stops after this many writes in a row failed: Planning Center is likely down, and the rest wait. */
export const CREDIT_LABEL_FAILURES_IN_A_ROW = 3;

/** What a run of the credit labels job did, as its `sync_runs` row records it. */
export type CreditLabelsRunCounts = {
    /** Requests that ended with Planning Center's author the label. */
    labelled: number;
    /** Requests whose song had the label already, so nothing was sent. */
    unchanged: number;
    /** Requests whose song's author, or the credit roles, changed since they were made. */
    changed: number;
    /** Requests Planning Center refused (a 422). */
    refused: number;
    /** Requests whose song Planning Center no longer has. */
    gone: number;
    /** Requests whose write failed this run and that wait to be tried again. */
    putOff: number;
    /** Requests whose write failed for the last time this run. */
    failed: number;
    /** Requests still waiting when the run ended. */
    waiting: number;
};

/**
 * The credits label `label` writes, when it reads back as itself with
 * `roles`; null when it does not any more (the roles changed since it was
 * made), so writing it would send something other than what was asked.
 */
function labelCredits(label: string, roles: readonly string[]): Credit[] | null {
    const parsed = parseCredits(label, roles);
    if (parsed.status !== "ok") {
        return null;
    }
    const checked = checkCredits(parsed.credits, roles);
    return checked.ok && renderCredits(checked.credits) === label ? checked.credits : null;
}

/** How a request a run tries can end: it fails, or is cancelled, only outside `labelSong`. */
type TriedOutcome = Exclude<CreditLabelOutcome, "failed" | "cancelled">;

/** How one request went: ended with an outcome, or its write failed and may be tried again. */
type LabelAttempt =
    | { ended: true; outcome: TriedOutcome; message: string | null }
    | { ended: false; message: string };

/**
 * Write request `request`'s label, as a credit save does (`saveSongCredits`,
 * paced): read the song afresh, send nothing when its author is the label
 * already or is not the one the label was made from, and otherwise write,
 * log and mirror it. Rethrows a 429 the pacer gave up on, which stops the
 * run; any other failure is an attempt that may be tried again.
 */
async function labelSong(
    request: CreditLabelRequest,
    roles: readonly string[],
    now: Date
): Promise<LabelAttempt> {
    const credits = labelCredits(request.author, roles);
    if (credits === null) {
        return {
            ended: true,
            outcome: "changed",
            message: "The credit roles changed since the label was asked for, so it would not read as asked.",
        };
    }
    let result;
    try {
        result = await saveSongCredits(request.pcoSongId, request.shownAuthor, credits, now, {
            paced: true,
            labelledBy: request.source,
        });
    } catch (error) {
        if (error instanceof PcoError && error.status === 429) {
            throw error;
        }
        return { ended: false, message: errorMessage(error) };
    }
    if (result.ok) {
        // A write that failed before may have been made though its answer was lost.
        const labelled = result.changed || request.attempts > 0;
        return { ended: true, outcome: labelled ? "labelled" : "unchanged", message: null };
    }
    switch (result.reason) {
        case "not-found":
            return { ended: true, outcome: "gone", message: result.message };
        case "refused":
            return { ended: true, outcome: "refused", message: result.message };
        case "changed":
            return {
                ended: true,
                outcome: "changed",
                message: `Its author is ${JSON.stringify(result.current?.author ?? "")} now, not ${JSON.stringify(request.shownAuthor)}, so nothing was sent.`,
            };
        default:
            return { ended: true, outcome: "changed", message: result.message };
    }
}

/**
 * Write the labels that wait, oldest first: the work of the
 * `credit-labels` job. Each is written as the credit editor saves (see
 * `labelSong`), paced, so a batch of hundreds takes minutes and leaves a
 * fifth of Planning Center's rate to the pages. The waiting requests are
 * read again before each song, so one cancelled meanwhile is never tried,
 * and one made meanwhile is.
 *
 * A request ends with its outcome. One whose write fails is put off, its
 * attempt counted, and tried again by the next run, until it has failed
 * `CREDIT_LABEL_MAX_ATTEMPTS` times and ends as "failed"; each run tries a
 * request once. After `CREDIT_LABEL_FAILURES_IN_A_ROW` failures in a row
 * the run stops, leaving the rest waiting, untried. A 429 the pacer gave up
 * on stops it too, with that error. The run throws, and so records a failed
 * run, when every write it tried failed.
 *
 * A request cancelled while its song is written keeps "cancelled", though
 * the write may have been made: the write log says what was sent.
 */
export async function writeCreditLabels(
    db: DatabaseSync,
    now: () => Date = () => new Date()
): Promise<CreditLabelsRunCounts> {
    const roles = resolveSettings(listStoredSettings(db)).settings.creditRoles;
    const counts: CreditLabelsRunCounts = {
        labelled: 0,
        unchanged: 0,
        changed: 0,
        refused: 0,
        gone: 0,
        putOff: 0,
        failed: 0,
        waiting: 0,
    };
    const tried = new Set<number>();
    let failuresInARow = 0;
    let lastFailure = "";
    for (;;) {
        const request = listWaitingCreditLabels(db).find(({ id }) => !tried.has(id));
        if (request === undefined || failuresInARow >= CREDIT_LABEL_FAILURES_IN_A_ROW) {
            break;
        }
        tried.add(request.id);
        const attempt = await labelSong(request, roles, now());
        if (attempt.ended) {
            failuresInARow = 0;
            if (finishCreditLabel(db, request.id, attempt.outcome, attempt.message, now())) {
                counts[attempt.outcome] += 1;
            }
            continue;
        }
        failuresInARow += 1;
        lastFailure = attempt.message;
        console.error(`Labelling the credits of Planning Center song ${request.pcoSongId} failed:`, attempt.message);
        const attempts = putOffCreditLabel(db, request.id, attempt.message);
        if (attempts !== null && attempts >= CREDIT_LABEL_MAX_ATTEMPTS) {
            finishCreditLabel(db, request.id, "failed", attempt.message, now());
            counts.failed += 1;
        } else if (attempts !== null) {
            counts.putOff += 1;
        }
    }
    counts.waiting = listWaitingCreditLabels(db).length;
    const ended = counts.labelled + counts.unchanged + counts.changed + counts.refused + counts.gone;
    if (ended === 0 && counts.putOff + counts.failed > 0) {
        throw new Error(`Planning Center took none of the labels tried: ${lastFailure}`);
    }
    return counts;
}

/** "1 song" or "12 songs". */
function songCount(count: number): string {
    return `${count} ${count === 1 ? "song" : "songs"}`;
}

/**
 * A run's counts in words, for its run's message: "Labelled 12 songs: 1
 * already labelled, 2 changed since, 3 to try again; 40 wait", leaving out
 * what did not happen, or "Nothing to label".
 */
export function describeCreditLabelsRun(counts: CreditLabelsRunCounts): string {
    const others = (
        [
            [counts.unchanged, "already labelled"],
            [counts.changed, "changed since"],
            [counts.refused, "refused by Planning Center"],
            [counts.gone, "gone from Planning Center"],
            [counts.failed, "failed"],
            [counts.putOff, "to try again"],
        ] as const
    )
        .filter(([count]) => count > 0)
        .map(([count, what]) => `${count} ${what}`);
    const waiting = counts.waiting > 0 ? `${counts.waiting} wait` : null;
    if (counts.labelled === 0 && others.length === 0) {
        return waiting === null ? "Nothing to label" : `Labelled none; ${waiting}`;
    }
    const head = `Labelled ${songCount(counts.labelled)}`;
    const body = others.length > 0 ? `${head}: ${others.join(", ")}` : head;
    return waiting === null ? body : `${body}; ${waiting}`;
}
