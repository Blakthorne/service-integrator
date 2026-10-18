import {
    checkCredits,
    creditLineOf,
    parseCredits,
    readLegacyAuthor,
    renderCredits,
} from "./credits";
import type { CreditSettings } from "./settings";

/**
 * Credit labels: a song's author that is not in the labelled convention yet
 * (`Words: …; Music: …`, see lib/credits.ts), labelled for it by the app.
 * Pure and safe on both sides.
 *
 * The label is what the copyright text already reads the author as (the
 * legacy reading), written in the convention, so labelling a song names the
 * same people in the same roles as its copyright text does now. That
 * reading is a guess at who wrote what, so each author is sorted by its
 * shape: a person checks the shapes the app is not trusted with on the
 * Credits page, and the app labels the trusted ones of new songs by itself
 * (see `isTrustedProposal`). An author the reading cannot label without
 * losing or inventing something is left for a person, with the reason.
 */

/**
 * The shape of an author with no labels, as the legacy reading splits it:
 *
 * - "one": one name, credited with the words and the music
 *   (`Fanny Crosby` → `Words & Music: Fanny Crosby`);
 * - "two": two names joined by " and ", the first credited with the words
 *   and the second with the music (`Isaac Watts and Lowell Mason` →
 *   `Words: Isaac Watts; Music: Lowell Mason`);
 * - "three": three names separated by commas, the first two credited with
 *   the words and the third with the music.
 */
export type CreditLabelShape = "one" | "two" | "three";

/** The shapes, in the order the Credits page lists them. */
export const CREDIT_LABEL_SHAPES: readonly CreditLabelShape[] = ["one", "two", "three"];

/**
 * The shapes the app labels by itself, for a new song: the church's
 * practice puts the words' author, then " and ", then the tune's composer
 * in the author field, so "two" reads right as well as "one".
 */
export const TRUSTED_CREDIT_LABEL_SHAPES: readonly CreditLabelShape[] = ["one", "two"];

/** Why an author is left for a person to label on the song's page. */
export type CreditLabelManualReason =
    /** No author at all: there is nobody to credit. */
    | "empty"
    /** It has labels that do not parse (see `parseCredits`). */
    | "unparsed"
    /** The legacy reading leaves some of its names out, so a label would drop them from Planning Center. */
    | "dropped-names"
    /** A part the legacy reading splits off is empty ("and Lowell Mason"). */
    | "missing-part"
    /** A name would hold a comma ("Isaac Watts, Lowell Mason"): who wrote what is not known. */
    | "comma-name"
    /** A name cannot be written: it holds a semicolon or a line break, or is too long. */
    | "unwritable";

/** What the app would label an author as (see `proposeCreditLabel`). */
export type CreditLabelProposal =
    /** It follows the convention already: nothing to do. */
    | { kind: "labelled" }
    /** It has no labels, and can be labelled. */
    | {
          kind: "proposed";
          shape: CreditLabelShape;
          /** The author as labelled, as Planning Center would hold it. */
          author: string;
          /** The copyright text's credit line now, with its period. */
          lineBefore: string;
          /** The copyright text's credit line once labelled. */
          lineAfter: string;
      }
    /** It is left for a person, for `reason`. */
    | { kind: "manual"; reason: CreditLabelManualReason };

/**
 * What the app would label a Planning Center song's `author` as, with the
 * credit roles and phrases of `settings`: nothing for an author that is
 * labelled already; for one with no labels, the credits the legacy reading
 * gives it, written in the convention (`renderCredits`), with the credit
 * line before and after; and otherwise why a person has to do it.
 *
 * A proposal never drops a name and never splits one the reading did not
 * split: an author whose reading leaves names out, has an empty part, or
 * would give a name with a comma in it (which the convention cannot hold as
 * one name, and which does not say who wrote what) is left for a person,
 * and so is one with a name `checkCredits` refuses. What a proposal gives
 * reads back through `parseCredits` as the same credits.
 */
export function proposeCreditLabel(
    author: string | null | undefined,
    settings: CreditSettings
): CreditLabelProposal {
    const roles = settings.creditRoles;
    const parsed = parseCredits(author, roles);
    if (parsed.status === "ok") {
        return { kind: "labelled" };
    }
    if (parsed.status === "unparsed") {
        return manual("unparsed");
    }
    if (parsed.raw.trim() === "") {
        return manual("empty");
    }
    const reading = readLegacyAuthor(parsed.raw);
    if (reading.kind !== "one" && reading.dropped.length > 0) {
        return manual("dropped-names");
    }
    const parts =
        reading.kind === "one"
            ? [reading.author]
            : reading.kind === "two"
              ? [reading.words, reading.music]
              : [...reading.words, reading.music];
    if (parts.some((part) => part === "")) {
        return manual("missing-part");
    }
    if (parts.some((part) => part.includes(","))) {
        return manual("comma-name");
    }
    const checked = checkCredits(parsed.credits, roles);
    if (!checked.ok || checked.credits.length === 0) {
        return manual("unwritable");
    }
    const labelled = renderCredits(checked.credits);
    return {
        kind: "proposed",
        shape: reading.kind,
        author: labelled,
        lineBefore: creditLineOf(parsed, settings),
        lineAfter: creditLineOf(parseCredits(labelled, roles), settings),
    };
}

function manual(reason: CreditLabelManualReason): CreditLabelProposal {
    return { kind: "manual", reason };
}

/** A proposal whose copyright line stays exactly as it is. */
export function keepsCreditLine(
    proposal: Extract<CreditLabelProposal, { kind: "proposed" }>
): boolean {
    return proposal.lineBefore === proposal.lineAfter;
}

/**
 * Whether the app may write `proposal` with nobody checking it: its shape
 * is trusted (`TRUSTED_CREDIT_LABEL_SHAPES`), and its copyright line stays
 * exactly as it is, so labelling it changes what Planning Center's author
 * says, never what the copyright text prints.
 */
export function isTrustedProposal(
    proposal: CreditLabelProposal
): proposal is Extract<CreditLabelProposal, { kind: "proposed" }> {
    return (
        proposal.kind === "proposed" &&
        TRUSTED_CREDIT_LABEL_SHAPES.includes(proposal.shape) &&
        keepsCreditLine(proposal)
    );
}

// ---------------------------------------------------------------------------
// The Credits page
// ---------------------------------------------------------------------------

/** A Planning Center song, as the Credits page reads it. */
export interface CreditLabelSong {
    pcoSongId: string;
    title: string;
    /** As Planning Center has it; null for none. */
    author: string | null;
    /** The catalog song linked to it, whose page has the credit editor; null when none is. */
    catalogSongId: number | null;
}

/** A song the app can label, as the Credits page lists it. */
export interface ProposedCreditLabelRow extends CreditLabelSong {
    proposal: Extract<CreditLabelProposal, { kind: "proposed" }>;
    /** Whether the app would label it by itself, for a new song (`isTrustedProposal`). */
    trusted: boolean;
    /** Whether it is waiting to be written. */
    queued: boolean;
}

/** A song left for a person, as the Credits page lists it. */
export interface ManualCreditLabelRow extends CreditLabelSong {
    reason: CreditLabelManualReason;
}

/** What the Credits page shows of the songs. */
export interface CreditLabelReview {
    /** How many songs follow the convention already. */
    labelled: number;
    /** The songs the app can label, by shape, in the order of `CREDIT_LABEL_SHAPES`, each by title. */
    tiers: { shape: CreditLabelShape; rows: ProposedCreditLabelRow[] }[];
    /** The songs left for a person, by title. */
    manual: ManualCreditLabelRow[];
}

function byTitle(a: CreditLabelSong, b: CreditLabelSong): number {
    return a.title.localeCompare(b.title, "en") || a.pcoSongId.localeCompare(b.pcoSongId);
}

/**
 * The Credits page's songs: each one's proposal with `settings`, the ones
 * the app can label sorted into their shapes and the others listed for a
 * person. `queuedIds` are the songs waiting to be written.
 */
export function buildCreditLabelReview(
    songs: readonly CreditLabelSong[],
    settings: CreditSettings,
    queuedIds: ReadonlySet<string>
): CreditLabelReview {
    let labelled = 0;
    const byShape = new Map<CreditLabelShape, ProposedCreditLabelRow[]>(
        CREDIT_LABEL_SHAPES.map((shape) => [shape, []])
    );
    const manualRows: ManualCreditLabelRow[] = [];
    for (const song of songs) {
        const proposal = proposeCreditLabel(song.author, settings);
        switch (proposal.kind) {
            case "labelled":
                labelled += 1;
                break;
            case "manual":
                manualRows.push({ ...song, reason: proposal.reason });
                break;
            case "proposed":
                byShape.get(proposal.shape)?.push({
                    ...song,
                    proposal,
                    trusted: isTrustedProposal(proposal),
                    queued: queuedIds.has(song.pcoSongId),
                });
                break;
        }
    }
    return {
        labelled,
        tiers: CREDIT_LABEL_SHAPES.map((shape) => ({
            shape,
            rows: (byShape.get(shape) ?? []).sort(byTitle),
        })),
        manual: manualRows.sort(byTitle),
    };
}

/** Each shape's heading and what it means, for the Credits page. */
export const CREDIT_LABEL_SHAPE_WORDS: Readonly<
    Record<CreditLabelShape, { heading: string; description: string }>
> = {
    one: {
        heading: "One author",
        description:
            "The author names one person, credited with the words and the music, as the copyright text prints it now.",
    },
    two: {
        heading: "Words and music",
        description:
            "Two names joined by “and”: the first is credited with the words and the second with the music, as the copyright text prints it now.",
    },
    three: {
        heading: "Three names",
        description:
            "Three names separated by commas: the first two are credited with the words and the third with the music, as the copyright text prints it now. Check these first: a list of people who wrote a song together reads the same way.",
    },
};

/** Why a song is left for a person, in words, for the Credits page. */
export const CREDIT_LABEL_MANUAL_WORDS: Readonly<Record<CreditLabelManualReason, string>> = {
    empty: "It has no author in Planning Center.",
    unparsed: "It has labels the app cannot read.",
    "dropped-names": "It names more people than the app can place: labelling it would drop some.",
    "missing-part": "A part of it is empty, so the app cannot tell who wrote what.",
    "comma-name": "Its names are separated by a comma, which does not say who wrote the words and who the music.",
    unwritable: "A name in it is too long, or holds a semicolon or a line break.",
};
