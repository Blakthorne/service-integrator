import { checkCredits, creditLineOf, parseCredits, renderCredits } from "@/lib/credits";
import type { Credit, CreditParseStatus } from "@/lib/domain";
import type { CreditSettings } from "@/lib/settings";

/**
 * The credit editor: the rows of names that the song page's Credits card
 * and the "Create in Planning Center" form edit, what those rows would
 * write to Planning Center's author field and print in the copyright text,
 * and what the card says about a song's credits. Pure and safe on both
 * sides. The convention itself, and every rule about a name, are
 * lib/credits.ts's: these functions call it rather than repeat it.
 */

/** One role of the editor, with the names typed for it. */
export interface CreditNamesRow {
    /** A role, spelled as the `creditRoles` setting spells it. */
    role: string;
    /** One per field, blank ones included; never empty, so every role shows a field. */
    names: string[];
}

/**
 * The editor's rows for `credits`: one per role of `roles`, in that order,
 * with the names of its credit, or one blank field. A credit whose role is
 * not one of `roles` (the roles changed) gets a row at the end, so that no
 * name is lost from sight; saving it is refused until it is moved.
 */
export function creditRows(credits: readonly Credit[], roles: readonly string[]): CreditNamesRow[] {
    const byRole = new Map(credits.map((credit) => [credit.role, credit.names]));
    const rows = roles.map((role) => ({ role, names: namesOrBlank(byRole.get(role)) }));
    for (const credit of credits) {
        if (!roles.includes(credit.role)) {
            rows.push({ role: credit.role, names: namesOrBlank(credit.names) });
        }
    }
    return rows;
}

function namesOrBlank(names: readonly string[] | undefined): string[] {
    return names && names.length > 0 ? [...names] : [""];
}

/** Where the editor starts for a song's author. */
export interface CreditsDraft {
    /** How the author reads (see `parseCredits`). */
    status: CreditParseStatus;
    /**
     * The first rows: the author's credits when it follows the convention;
     * the guided split of one that has no labels (the legacy reading, which
     * is how the copyright text reads it now); and for one whose labels do
     * not parse, the groups that do.
     */
    rows: CreditNamesRow[];
    /**
     * The groups of an unparsed author that name no role, as written
     * ("Tune: Lowell Mason"), for a person to place by hand. Empty
     * otherwise.
     */
    unplaced: string[];
}

/**
 * Where the editor starts for Planning Center song author `author`, read
 * with `roles`. An unparsed author is split at its semicolons, and each
 * group read on its own: the groups that follow the convention fill their
 * roles, and the others are listed as `unplaced`.
 */
export function draftCredits(author: string | null, roles: readonly string[]): CreditsDraft {
    const parsed = parseCredits(author, roles);
    if (parsed.status !== "unparsed") {
        return { status: parsed.status, rows: creditRows(parsed.credits, roles), unplaced: [] };
    }
    const namesByRole = new Map<string, string[]>();
    const unplaced: string[] = [];
    for (const part of parsed.raw.split(";")) {
        const group = part.trim();
        if (group === "") {
            continue;
        }
        const read = parseCredits(group, roles);
        if (read.status !== "ok") {
            unplaced.push(group);
            continue;
        }
        for (const { role, names } of read.credits) {
            const held = namesByRole.get(role) ?? [];
            for (const name of names) {
                if (!held.includes(name)) {
                    held.push(name);
                }
            }
            namesByRole.set(role, held);
        }
    }
    const credits = roles.flatMap((role) => {
        const names = namesByRole.get(role);
        return names ? [{ role, names }] : [];
    });
    return { status: "unparsed", rows: creditRows(credits, roles), unplaced };
}

/** The rows with name `nameIndex` of row `rowIndex` set to `value`. */
export function setCreditName(
    rows: readonly CreditNamesRow[],
    rowIndex: number,
    nameIndex: number,
    value: string
): CreditNamesRow[] {
    return rows.map((row, i) =>
        i === rowIndex
            ? { ...row, names: row.names.map((name, j) => (j === nameIndex ? value : name)) }
            : row
    );
}

/** The rows with a blank name added at the end of row `rowIndex`. */
export function addCreditName(rows: readonly CreditNamesRow[], rowIndex: number): CreditNamesRow[] {
    return rows.map((row, i) => (i === rowIndex ? { ...row, names: [...row.names, ""] } : row));
}

/**
 * The rows without name `nameIndex` of row `rowIndex`. A row keeps one
 * field, so removing its only name leaves it blank.
 */
export function removeCreditName(
    rows: readonly CreditNamesRow[],
    rowIndex: number,
    nameIndex: number
): CreditNamesRow[] {
    return rows.map((row, i) => {
        if (i !== rowIndex) {
            return row;
        }
        const names = row.names.filter((_, j) => j !== nameIndex);
        return { ...row, names: names.length > 0 ? names : [""] };
    });
}

/** Where a typed name holds several names: at its commas and semicolons. */
const NAME_LIST_SEPARATORS = /[,;]/;

/** The names a field holds when it is split at its commas and semicolons, trimmed, blank ones left out. */
function namesIn(text: string): string[] {
    return text
        .split(NAME_LIST_SEPARATORS)
        .map((name) => name.trim())
        .filter((name) => name !== "");
}

/**
 * Whether a field holds several names, separated by commas or semicolons
 * ("Isaac Watts, Lowell Mason", as an author with no labels often has):
 * then the editor offers to split it.
 */
export function canSplitCreditName(name: string): boolean {
    return namesIn(name).length > 1;
}

/**
 * The rows with name `nameIndex` of row `rowIndex` split at its commas and
 * semicolons into one field per name, in its place. A name with nothing
 * to split is left as it is.
 */
export function splitCreditName(
    rows: readonly CreditNamesRow[],
    rowIndex: number,
    nameIndex: number
): CreditNamesRow[] {
    return rows.map((row, i) => {
        if (i !== rowIndex || !canSplitCreditName(row.names[nameIndex] ?? "")) {
            return row;
        }
        const names = row.names.flatMap((name, j) => (j === nameIndex ? namesIn(name) : [name]));
        return { ...row, names };
    });
}

/**
 * What is wrong with one typed name, as `checkCredits` would say it (a
 * colon, semicolon or comma, a line break, too long), or null when it is
 * fine. A blank name is fine: it is left out.
 */
export function creditNameProblem(name: string, roles: readonly string[]): string | null {
    if (roles.length === 0) {
        return null;
    }
    const checked = checkCredits([{ role: roles[0], names: [name] }], roles);
    return checked.ok ? null : checked.message;
}

/** Whether any name of `rows` is marked with a problem (`creditNameProblem`). */
export function hasCreditNameProblems(rows: readonly CreditNamesRow[], roles: readonly string[]): boolean {
    return rows.some(({ names }) => names.some((name) => creditNameProblem(name, roles) !== null));
}

/**
 * What a form says, above its button and in place of its preview, when
 * names are marked with a problem: each mark says what is wrong, so this
 * does not repeat it.
 */
export const FIX_MARKED_NAMES_MESSAGE = "Nothing was sent. Fix the names marked above, then try again.";

/** What the preview says while names are marked with a problem. */
export const PREVIEW_AFTER_FIXES = "The preview shows here once the names marked above are fixed.";

/** What the rows would write and print. */
export type CreditsPreview =
    | {
          ok: true;
          /** The rows as `checkCredits` makes them ready: one per role with names, in the order of the roles. */
          credits: Credit[];
          /** Planning Center's author field as it would be written; "" for no credits. */
          author: string;
          /** The copyright text's credit line for that author, as it would print. */
          creditLine: string;
      }
    /** Why they cannot be written, fit to show. */
    | { ok: false; message: string };

/**
 * What `rows` would write to Planning Center's author field
 * (`renderCredits`, after `checkCredits`) and print in the copyright text
 * (`creditLineOf` for that author, which is `renderCreditLine` for credits
 * with names), with `settings`' roles and phrases; or why they cannot be
 * written.
 */
export function previewCredits(rows: readonly CreditNamesRow[], settings: CreditSettings): CreditsPreview {
    const checked = checkCredits(rows, settings.creditRoles);
    if (!checked.ok) {
        return { ok: false, message: checked.message };
    }
    const author = renderCredits(checked.credits);
    return {
        ok: true,
        credits: checked.credits,
        author,
        creditLine: creditLineOf(parseCredits(author, settings.creditRoles), settings),
    };
}

/** Whether two sets of credits name the same people for the same roles, in the same order. */
export function sameCredits(a: readonly Credit[], b: readonly Credit[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (credit, i) =>
                credit.role === b[i].role &&
                credit.names.length === b[i].names.length &&
                credit.names.every((name, j) => name === b[i].names[j])
        )
    );
}

/** How a song's credits read, as a short tag. */
export const CREDIT_STATUS_LABELS: Readonly<Record<CreditParseStatus, string>> = {
    ok: "Labelled",
    legacy: "Not in the labelled form yet",
    unparsed: "Labels the app cannot read",
};

/** "Words, Music, Arr. or Trans.". */
function listRoles(roles: readonly string[]): string {
    return roles.length <= 1
        ? roles.join("")
        : `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`;
}

/**
 * What the Credits card says of a song's credits, for how its author reads
 * (`draft`): what Planning Center has, and what saving will do.
 */
export function describeCreditsDraft(
    draft: CreditsDraft,
    author: string | null,
    roles: readonly string[]
): string {
    switch (draft.status) {
        case "ok":
            return "Planning Center has the credits in the labelled form, so each name is credited with its role.";
        case "legacy":
            return (author ?? "").trim() === ""
                ? "Planning Center has no credits for this song. Type them below, then save to write them in the labelled form."
                : "Planning Center has the credits without labels, so the copyright text guesses each name's role. That guess is below: check it, then save to write the credits in the labelled form.";
        case "unparsed":
            return `Planning Center's credits have labels that are not the credit roles (${listRoles(roles)}), so the copyright text prints them as they are. Put each name under its role below, then save to write them in the labelled form.`;
    }
}

/**
 * What the Credits card says when Save is pressed with no names at all:
 * the credit editor never empties a song's author (`saveSongCredits` refuses
 * it too).
 */
export const NO_CREDITS_MESSAGE = "Enter at least one name: the credits would be empty.";

/**
 * What the Credits card says when its action never answered (the network,
 * an ended session): Planning Center may have the new credits, or not.
 */
export const CREDITS_NO_ANSWER =
    "The server did not answer, so the credits may or may not have been saved. Reload the page to see what the app has, and look at the song in Planning Center.";

/**
 * What the Credits card adds to a refusal because the author changed in
 * Planning Center since the page loaded: the author it has now.
 */
export function describeAuthorNow(author: string): string {
    return author.trim() === ""
        ? "Planning Center has no credits for it now."
        : `Planning Center has now: "${author}".`;
}

/** What the Credits card says once a save is done: what Planning Center has now. */
export function describeCreditsSave({ changed, author }: { changed: boolean; author: string }): string {
    return changed
        ? `Saved. Planning Center's author is now "${author}".`
        : "Planning Center already had these credits, so nothing was changed.";
}

/** The most credits, and names in one credit, an action takes: far more than any song has. */
const MAX_CREDITS = 50;
const MAX_NAMES = 50;

/**
 * Credits as an action receives them, from the network, so they may be
 * anything: a list of `{ role, names }` with a text role and a list of text
 * names, at most `MAX_CREDITS` of them with at most `MAX_NAMES` names each.
 * Null for anything else. It checks the shape only; `checkCredits` checks
 * the roles and names.
 */
export function readCreditsInput(value: unknown): Credit[] | null {
    if (!Array.isArray(value) || value.length > MAX_CREDITS) {
        return null;
    }
    const credits: Credit[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null) {
            return null;
        }
        const { role, names } = item as { role?: unknown; names?: unknown };
        if (
            typeof role !== "string" ||
            !Array.isArray(names) ||
            names.length > MAX_NAMES ||
            !names.every((name) => typeof name === "string")
        ) {
            return null;
        }
        credits.push({ role, names: [...names] });
    }
    return credits;
}
