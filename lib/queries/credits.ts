import "server-only";
import {
    buildCreditLabelReview,
    proposeCreditLabel,
    type CreditLabelAsked,
    type CreditLabelReview,
    type RequestedCreditLabels,
} from "@/lib/creditLabels";
import { creditLabelSets, type CreditLabelSet } from "@/lib/creditRoleImpact";
import { getDb, withTransaction } from "@/lib/db";
import {
    cancelWaitingCreditLabels,
    listCreditLabelSongs,
    listWaitingCreditLabels,
    queueCreditLabels,
    recentCreditLabels,
    type NewCreditLabelRequest,
} from "@/lib/db/creditLabels";
import { deriveSongCredits, type CreditStatusCounts } from "@/lib/db/credits";
import { errorMessage } from "@/lib/db/errors";
import { findPcoSongs, listPcoSongs } from "@/lib/db/pcoSongs";
import { listStoredSettings } from "@/lib/db/settings";
import { latestSyncRun, type SyncRun } from "@/lib/db/syncRuns";
import type { CreditLabelOutcome, CreditLabelSource } from "@/lib/domain";
import { creditLabelsJob, runJob } from "@/lib/jobs";
import { resolveSettings } from "@/lib/settings";

/**
 * Songs' credits as the app derives them from the mirror (`pco_song_credits`;
 * see lib/credits.ts), for what changes them all at once: a change of the
 * credit roles, and what such a change would do to them. The sync derives
 * them song by song (lib/queries/sync.ts), and so does every write to a
 * song (lib/queries/pcoSongs.ts).
 */

/** The labels the songs' authors use, or why they could not be read. */
export interface CreditLabelSetsRead {
    /** Biggest first (`creditLabelSets`); none when they could not be read. */
    sets: CreditLabelSet[];
    /** Why they could not be read, or null. */
    error: string | null;
}

/**
 * The labels the mirrored songs' authors use, read with the stored
 * `creditRoles` setting (its default when the stored value does not parse)
 * and grouped by `creditLabelSets`: what the Settings page's Credits form
 * shows the impact of new roles from, and what `saveCreditsAction` checks
 * that impact against before it saves. Songs that Planning Center no longer
 * has are left out: they print no copyright text. It reads the database
 * alone, never Planning Center, and never throws: a failure is logged and
 * comes back as `error`, with no sets.
 */
export function getCreditLabelSets(): CreditLabelSetsRead {
    try {
        const db = getDb();
        const roles = resolveSettings(listStoredSettings(db)).settings.creditRoles;
        const authors = listPcoSongs(db)
            .filter((song) => song.removedAt === null)
            .map((song) => song.author);
        return { sets: creditLabelSets(authors, roles), error: null };
    } catch (error) {
        console.error("Failed to read the labels of the songs' credits:", error);
        return { sets: [], error: errorMessage(error) };
    }
}

/** What `rederiveAllCredits` did: how many songs it read again, and how many read as each status. */
export interface RederivedCredits extends CreditStatusCounts {
    songs: number;
}

/**
 * Read every mirrored song's author again with the stored `creditRoles`
 * setting (its default when the stored value does not parse) and replace
 * the credits derived from it, all in one transaction, removed and ignored
 * songs too: what saving the roles calls, so that every song's credits
 * follow the new roles at once instead of at the next sync. It reads and
 * writes only the database, never Planning Center. Throws, changing
 * nothing, when the database cannot be opened, read or written.
 */
export function rederiveAllCredits(): RederivedCredits {
    const db = getDb();
    return withTransaction(db, () => {
        const roles = resolveSettings(listStoredSettings(db)).settings.creditRoles;
        const songs = listPcoSongs(db);
        return { songs: songs.length, ...deriveSongCredits(db, songs, roles) };
    });
}

// ---------------------------------------------------------------------------
// The Credits page: labelling songs' authors (see lib/creditLabels.ts)
// ---------------------------------------------------------------------------

/** The outcomes the Credits page lists as labels that did not go through. */
const PROBLEM_OUTCOMES: readonly CreditLabelOutcome[] = ["changed", "refused", "failed", "gone"];

/** How many of them it lists. */
export const CREDIT_LABEL_PROBLEMS_LIMIT = 20;

/** A request that ended without its label, as the Credits page lists it. */
export interface CreditLabelProblem {
    id: number;
    pcoSongId: string;
    /** The song's title, as the mirror has it. */
    title: string;
    source: CreditLabelSource;
    outcome: CreditLabelOutcome;
    message: string | null;
    finishedAt: string;
}

/** What the Credits page shows. */
export interface CreditLabelsPageData {
    /** The songs, sorted by what the app would label them as (see `buildCreditLabelReview`). */
    review: CreditLabelReview;
    /** How many labels wait to be written. */
    waiting: number;
    /** The credit labels job's latest run, or null before the first. */
    lastRun: SyncRun | null;
    /** The song sync's latest run: before the first, there are no songs to label. */
    lastSync: SyncRun | null;
    /** The latest requests that ended without their label, newest first. */
    problems: CreditLabelProblem[];
}

/**
 * What the Credits page shows: every song still in Planning Center sorted
 * by what the app would label its author as, with the stored credit roles
 * and phrases (their defaults when they do not parse); how many labels
 * wait; the job's and the song sync's latest runs; and the labels that
 * lately did not go through. It reads the local database alone, in seven
 * queries at most. Throws when the database cannot be opened, for the error
 * boundary.
 */
export function getCreditLabelsPage(): CreditLabelsPageData {
    const db = getDb();
    const settings = resolveSettings(listStoredSettings(db)).settings;
    const waiting = listWaitingCreditLabels(db);
    const ended = recentCreditLabels(db, CREDIT_LABEL_PROBLEMS_LIMIT * 5)
        .filter(({ outcome }) => outcome !== null && PROBLEM_OUTCOMES.includes(outcome))
        .slice(0, CREDIT_LABEL_PROBLEMS_LIMIT);
    const titles = findPcoSongs(
        db,
        ended.map(({ pcoSongId }) => pcoSongId)
    );
    return {
        review: buildCreditLabelReview(
            listCreditLabelSongs(db),
            settings,
            new Set(waiting.map(({ pcoSongId }) => pcoSongId))
        ),
        waiting: waiting.length,
        lastRun: latestSyncRun(db, "credit-labels"),
        lastSync: latestSyncRun(db, "pco-songs"),
        problems: ended.map((request) => ({
            id: request.id,
            pcoSongId: request.pcoSongId,
            title: titles.get(request.pcoSongId)?.title ?? `Song ${request.pcoSongId}`,
            source: request.source,
            outcome: request.outcome ?? "changed",
            message: request.message,
            finishedAt: request.finishedAt ?? request.requestedAt,
        })),
    };
}

/**
 * Queue the labels a person asked for on the Credits page, then start the
 * credit labels job for them, and for those that waited already (`runJob`,
 * not awaited: it writes in the background, and joins a run in progress). Each label is held to what the page showed:
 * a song is queued only when the mirror still has it in Planning Center
 * with the author the page showed, and the label the page showed is the
 * one the app makes of that author with the settings now. Any other is
 * counted as changed and left out, so nobody's label is written over an
 * author they did not see. The job checks the author against Planning
 * Center itself again before it writes. Throws when the database cannot be
 * opened or written, queuing nothing.
 */
export function requestCreditLabels(
    asked: readonly CreditLabelAsked[],
    now: Date = new Date()
): RequestedCreditLabels {
    const db = getDb();
    const settings = resolveSettings(listStoredSettings(db)).settings;
    const songs = findPcoSongs(
        db,
        asked.map(({ pcoSongId }) => pcoSongId)
    );
    const requests: NewCreditLabelRequest[] = [];
    let changed = 0;
    for (const label of asked) {
        const song = songs.get(label.pcoSongId);
        const proposal = proposeCreditLabel(label.shownAuthor, settings);
        if (
            song === undefined ||
            song.removedAt !== null ||
            (song.author ?? "") !== label.shownAuthor ||
            proposal.kind !== "proposed" ||
            proposal.author !== label.author
        ) {
            changed += 1;
            continue;
        }
        requests.push({ ...label, source: "review" });
    }
    const { queued, waiting } = queueCreditLabels(db, requests, now);
    if (queued.length + waiting.length > 0) {
        void runJob(creditLabelsJob);
    }
    return { queued: queued.length, waiting: waiting.length, changed };
}

/**
 * Stop the labels that wait: each ends as cancelled, and the job tries none
 * of them (one being written as this runs is written all the same). Gives
 * how many. Throws when the database cannot be opened or written.
 */
export function cancelCreditLabels(now: Date = new Date()): number {
    return cancelWaitingCreditLabels(getDb(), now);
}
