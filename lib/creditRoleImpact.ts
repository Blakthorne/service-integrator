import { labelKey, parseCredits } from "./credits";

/**
 * What a change of the credit roles does to the songs whose authors are
 * labelled (`Words: Thomas Ken; Music: Louis Bourgeois`). An author reads
 * as labelled only while every label it uses is a role, so renaming or
 * removing a role that authors use turns them `unparsed`: each song's
 * copyright text then prints its whole author, labels and all, in place of
 * its credit line ("Words and Tune by Words: Thomas Ken; Music: Louis
 * Bourgeois." for "Words by Thomas Ken. Music by Louis Bourgeois."), and
 * its page flags it. Planning Center keeps the authors as they are, so
 * saving the old roles again brings the credit lines back.
 *
 * So the Settings page's Credits form shows how many songs a change of the
 * roles would do that to, and which labels, and asks to confirm it before
 * it saves; `saveCreditsAction` checks the same against the mirror and
 * refuses without that confirmation. Pure and safe on both sides.
 */

/** Songs whose authors use exactly the same labels, and how many they are. */
export interface CreditLabelSet {
    /** The roles the authors are labelled with, as the roles setting spells them, in its order. */
    labels: string[];
    /** How many songs have exactly these labels. */
    songs: number;
}

/**
 * The label sets of `authors` (the authors of the songs that print a
 * copyright text), read with `roles`, the roles as they are saved now: only
 * an author that follows the convention has labels, and they are the roles
 * it names ("Words & Music: John Newton" names both). An author with no
 * labels, or with labels that already do not parse, has none to lose.
 * Biggest sets first.
 */
export function creditLabelSets(
    authors: readonly (string | null)[],
    roles: readonly string[]
): CreditLabelSet[] {
    const sets = new Map<string, CreditLabelSet>();
    for (const author of authors) {
        const parsed = parseCredits(author, roles);
        if (parsed.status !== "ok" || parsed.credits.length === 0) {
            continue;
        }
        const labels = parsed.credits.map(({ role }) => role);
        const key = JSON.stringify(labels);
        const set = sets.get(key);
        if (set) {
            set.songs += 1;
        } else {
            sets.set(key, { labels, songs: 1 });
        }
    }
    return [...sets.values()].sort(
        (a, b) => b.songs - a.songs || a.labels.join().localeCompare(b.labels.join())
    );
}

/** A label that would no longer be a role, and how many songs use it. */
export interface LostLabel {
    label: string;
    songs: number;
}

/** What new roles would do to the songs whose label sets are known. */
export interface CreditRolesImpact {
    /** The labels that would no longer be roles, each with the songs that use it, most first. */
    readonly labels: readonly LostLabel[];
    /** How many songs use at least one of them: the songs whose copyright text would change. */
    readonly songs: number;
}

/** No song would change. */
export const NO_ROLES_IMPACT: CreditRolesImpact = Object.freeze({
    labels: Object.freeze([]),
    songs: 0,
});

/**
 * What saving `newRoles` would do to the songs of `sets` (read with the
 * roles saved now): the labels they use that `newRoles` does not have, each
 * with its songs, and how many songs use any of them. A role is the same
 * one whatever its case or the spaces in it, as `parseCredits` matches it,
 * so typing "music" for "Music" loses nothing. A song that uses two such
 * labels counts once in `songs`, and once under each label.
 */
export function creditRolesImpact(
    sets: readonly CreditLabelSet[],
    newRoles: readonly string[]
): CreditRolesImpact {
    const kept = new Set(newRoles.map(labelKey));
    const lost = new Map<string, LostLabel>();
    let songs = 0;
    for (const set of sets) {
        const missing = set.labels.filter((label) => !kept.has(labelKey(label)));
        if (missing.length === 0) {
            continue;
        }
        songs += set.songs;
        for (const label of missing) {
            const entry = lost.get(labelKey(label));
            if (entry) {
                entry.songs += set.songs;
            } else {
                lost.set(labelKey(label), { label, songs: set.songs });
            }
        }
    }
    if (lost.size === 0) {
        return NO_ROLES_IMPACT;
    }
    const labels = [...lost.values()].sort(
        (a, b) => b.songs - a.songs || a.label.localeCompare(b.label)
    );
    return { labels, songs };
}

/**
 * A key that is the same for two impacts exactly when they name the same
 * labels with the same songs: the form's confirmation holds for the impact
 * whose key it was given, so any change to what would change asks again.
 */
export function rolesImpactKey(impact: CreditRolesImpact): string {
    return JSON.stringify(impact.labels.map(({ label, songs }) => [label, songs]));
}

/** "1 song", "40 songs". */
function songCount(count: number): string {
    return `${count} ${count === 1 ? "song" : "songs"}`;
}

/** What the notice says first: how many songs the new roles would change. */
export function rolesImpactHeadline(songs: number): string {
    return `Saving these roles changes the copyright text of ${songCount(songs)}.`;
}

/** The labels that would no longer be roles, with their songs: `"Music" (38 songs) and "Trans." (2 songs)`. */
export function describeLostLabels(labels: readonly LostLabel[]): string {
    const named = labels.map(({ label, songs }) => `"${label}" (${songCount(songs)})`);
    return named.length <= 1
        ? named.join("")
        : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** What the notice says of the labels: whose they are, and that they would no longer be roles. */
export function rolesImpactLabels(impact: CreditRolesImpact): string {
    const whose = impact.songs === 1 ? "Its author uses" : "Their authors use";
    const what =
        impact.labels.length === 1
            ? "a label that would no longer be a role"
            : "labels that would no longer be roles";
    return `${whose} ${what}: ${describeLostLabels(impact.labels)}.`;
}

/** What the notice says those songs would print, and how to bring their credit lines back. */
export const ROLES_IMPACT_EXPLANATION =
    "Each of them would print its whole author, labels and all, in place of its credit line, and be flagged on its page until its credits are saved there with the new roles. Planning Center keeps every author as it is, so saving the old roles again brings the credit lines back.";

/** The checkbox that confirms the change: "Change the copyright text of 40 songs". */
export function confirmRolesImpactLabel(songs: number): string {
    return `Change the copyright text of ${songCount(songs)}`;
}

/** What the checkbox says when Save was pressed without it ticked. */
export function rolesImpactNotConfirmedMessage(songs: number): string {
    return `Confirm that the copyright text of ${songCount(songs)} will change, or keep the labels ${songs === 1 ? "its author uses" : "their authors use"} as roles.`;
}

/**
 * What the checkbox says when the songs it confirmed are not as many as
 * the server finds now (a sync, or roles saved in another tab, changed
 * them): the notice shows them as they are, and the confirmation starts
 * again.
 */
export function rolesImpactChangedMessage(now: number, confirmed: number): string {
    return `These roles now change the copyright text of ${songCount(now)}, not the ${confirmed} you confirmed, since the songs or the saved roles changed. Check which songs, then confirm again.`;
}

/** What `checkRolesImpactConfirmed` came to. */
export type RolesImpactCheck = { ok: true } | { ok: false; message: string };

/**
 * Whether roles whose impact is `impact` may be saved, given `confirmed`:
 * how many songs the person confirmed would change (the form's checkbox
 * posts it), or null when they confirmed nothing. Always when no song
 * would change; else only when exactly that many were confirmed.
 */
export function checkRolesImpactConfirmed(
    impact: CreditRolesImpact,
    confirmed: number | null
): RolesImpactCheck {
    if (impact.songs === 0) {
        return { ok: true };
    }
    if (confirmed === null) {
        return { ok: false, message: rolesImpactNotConfirmedMessage(impact.songs) };
    }
    if (confirmed !== impact.songs) {
        return { ok: false, message: rolesImpactChangedMessage(impact.songs, confirmed) };
    }
    return { ok: true };
}

/** What the form says when it could not be checked which songs the roles would change. */
export const ROLES_IMPACT_UNCHECKED_MESSAGE =
    "Nothing was saved: it could not be checked which songs these roles would change. Try again; the server log has the details.";

/** What the form says, in place of the notice, when the songs' labels could not be read for the page. */
export const ROLES_IMPACT_UNKNOWN_NOTICE =
    "The songs' credits could not be read, so this page cannot show which songs a change of roles would change. Saving checks them first.";
