import type { Credit, SongCredits } from "./domain";
import type { CreditPhrases, CreditSettings } from "./settings";

/**
 * Songs' credits: who wrote a song's words and its music, and who arranged
 * or translated it, as Planning Center's one `author` field holds them.
 * Pure and safe on both sides.
 *
 * The convention, whose labels are the `creditRoles` setting:
 *
 *     credits := group (";" group)*
 *     group   := label ":" names
 *     names   := name ("," name)*
 *
 * as in `Words: Isaac Watts; Music: Lowell Mason; Arr.: John Doe`. A label
 * is a role, matched without regard to case, or two roles joined by "&" or
 * "and", which the names then hold both of (`Words & Music: John Newton`).
 *
 * An author with no labels at all is "legacy": it is read the way the
 * copyright text always read an author (`readLegacyAuthor`), so every song
 * whose author predates the convention keeps its copyright text, byte for
 * byte. One with labels that do not parse is "unparsed": it is flagged for
 * a person to fix, never rewritten, and its copyright text is what it
 * always was too.
 */

/** What an author reads as (see `parseCredits`). */
export type CreditsParse =
    /** It follows the convention: its credits, one per role, in the order of the roles. */
    | { status: "ok"; credits: Credit[] }
    /**
     * It has no labels: its credits as the legacy reading takes them (a
     * name may then hold a comma), and the author as given, "" for none,
     * which the copyright text prints as it always did.
     */
    | { status: "legacy"; credits: Credit[]; raw: string }
    /** It has labels that do not parse: the author as given, which the copyright text prints as it always did. */
    | { status: "unparsed"; raw: string };

/** A label or role as compared: trimmed, its runs of whitespace one space, in lower case. */
function labelKey(text: string): string {
    return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The role of `roles` that `label` names, spelled as `roles` spells it, or null. */
function findRole(label: string, roles: readonly string[]): string | null {
    const key = labelKey(label);
    return roles.find((role) => labelKey(role) === key) ?? null;
}

/** Where a label may join two roles: at "&", or at "and" between words, in any case. */
const ROLE_JOINER = /&|\band\b/gi;

/**
 * The roles a group's label names: one role, or two different roles joined
 * by "&" or "and" ("Words & Music", "words and music"), in the order of
 * `roles`. Null when it names neither.
 */
function rolesNamedBy(label: string, roles: readonly string[]): string[] | null {
    const role = findRole(label, roles);
    if (role !== null) {
        return [role];
    }
    for (const joiner of label.matchAll(ROLE_JOINER)) {
        const at = joiner.index ?? 0;
        const first = findRole(label.slice(0, at), roles);
        const second = findRole(label.slice(at + joiner[0].length), roles);
        if (first !== null && second !== null && first !== second) {
            return roles.filter((candidate) => candidate === first || candidate === second);
        }
    }
    return null;
}

/**
 * An author that has labels, read by the convention: its credits, one per
 * role named, in the order of `roles`, each role's names in the order they
 * come (a role named twice gets the names of both, each name once). Null
 * when it does not follow the convention: a group with no label, a label
 * that names no role (or more than two), an empty name, a name with a colon
 * in it, or no group at all. Empty groups (";;", a trailing ";") are
 * skipped.
 */
function readConvention(author: string, roles: readonly string[]): Credit[] | null {
    const namesByRole = new Map<string, string[]>();
    for (const part of author.split(";")) {
        const group = part.trim();
        if (group === "") {
            continue;
        }
        const colon = group.indexOf(":");
        if (colon === -1) {
            return null;
        }
        const named = rolesNamedBy(group.slice(0, colon), roles);
        if (named === null) {
            return null;
        }
        const names = group
            .slice(colon + 1)
            .split(",")
            .map((name) => name.trim());
        if (names.some((name) => name === "" || name.includes(":"))) {
            return null;
        }
        for (const role of named) {
            const held = namesByRole.get(role) ?? [];
            for (const name of names) {
                if (!held.includes(name)) {
                    held.push(name);
                }
            }
            namesByRole.set(role, held);
        }
    }
    if (namesByRole.size === 0) {
        return null;
    }
    return roles.flatMap((role) => {
        const names = namesByRole.get(role);
        return names ? [{ role, names }] : [];
    });
}

/**
 * How the copyright text has always read an author with no labels, kept
 * apart from how it prints (`renderLegacyCreditLine`) so that the credits
 * can be read from it too:
 *
 * - "three": three or more comma-separated parts; the first two wrote the
 *   words and the third the music, and any more are dropped;
 * - "one": otherwise, no " and " (lower case only): one author of both;
 * - "two": " and ": the first part wrote the words and the second the
 *   music, and any more are dropped.
 *
 * Every part is trimmed, and an empty part is kept as "" (the line prints
 * it, or "Unknown", as it always did).
 */
type LegacyReading =
    | { kind: "three"; words: [string, string]; music: string }
    | { kind: "one"; author: string }
    | { kind: "two"; words: string; music: string };

/**
 * Read an author with no labels as the copyright text always read it. The
 * splitting moved here verbatim from `formatCopyrightText`, quirks
 * included: "A, B" (two comma-separated parts) is one author, and so is
 * "A AND B" or "A & B"; three or more comma-separated parts win over
 * " and ", which is then not split.
 */
function readLegacyAuthor(author: string): LegacyReading {
    // First split by comma to check if there are three authors
    const commaAuthors = author.split(",").map((a) => a.trim());

    if (commaAuthors.length >= 3) {
        // If there are three or more authors separated by commas
        return { kind: "three", words: [commaAuthors[0], commaAuthors[1]], music: commaAuthors[2] };
    }
    // If not three authors, split by "and"
    const authors = author.split(" and ").map((a) => a.trim());
    if (authors.length === 1) {
        // Single author case
        return { kind: "one", author: authors[0] };
    }
    // Two authors case
    return { kind: "two", words: authors[0], music: authors[1] };
}

/** The phrases the legacy line prints: the words' role's, the music's, and the two together. */
interface LegacyPhrases {
    words: string;
    music: string;
    both: string;
}

/** The first two roles: the words' and the music's ("Words" and "Music" when there are fewer). */
function wordsAndMusicRoles(roles: readonly string[]): [string, string] {
    return [roles[0] ?? "Words", roles[1] ?? "Music"];
}

/** Names, each once, in order, leaving out empty ones. */
function namesOf(names: readonly string[]): string[] {
    return [...new Set(names.filter((name) => name !== ""))];
}

/**
 * An author with no labels as credits: what the legacy reading says of it,
 * the words' credit under the first role and the music's under the second.
 * Who the copyright text calls "Unknown" is credited to nobody, and a music
 * part it prints as the words' author is credited to them.
 */
function legacyCredits(author: string, roles: readonly string[]): Credit[] {
    const reading = readLegacyAuthor(author);
    const [wordsRole, musicRole] = wordsAndMusicRoles(roles);
    let words: string[];
    let music: string[];
    switch (reading.kind) {
        case "three":
            words = namesOf(reading.words);
            music = namesOf([reading.music]);
            break;
        case "one":
            words = namesOf([reading.author]);
            music = words;
            break;
        case "two":
            words = namesOf([reading.words]);
            music = namesOf([reading.music || reading.words]);
            break;
    }
    return [
        ...(words.length > 0 ? [{ role: wordsRole, names: words }] : []),
        ...(music.length > 0 ? [{ role: musicRole, names: [...music] }] : []),
    ];
}

/**
 * Read a Planning Center song's author as credits, with `roles` (the
 * `creditRoles` setting) as the labels:
 *
 * - "ok": it follows the convention;
 * - "legacy": it has no labels at all, that is no colon (an empty or
 *   missing author too), and is read the way the copyright text always
 *   read one;
 * - "unparsed": it has a colon but does not follow the convention.
 */
export function parseCredits(
    author: string | null | undefined,
    roles: readonly string[]
): CreditsParse {
    const raw = author ?? "";
    if (!raw.includes(":")) {
        return { status: "legacy", credits: legacyCredits(raw, roles), raw };
    }
    const credits = readConvention(raw, roles);
    return credits ? { status: "ok", credits } : { status: "unparsed", raw };
}

/** What a parse stores as a song's derived credits: its status, and its credits (none when unparsed). */
export function songCreditsOf(parsed: CreditsParse): SongCredits {
    return {
        status: parsed.status,
        credits: parsed.status === "unparsed" ? [] : parsed.credits,
    };
}

/** Credits with names, as written and printed: two next to each other with the same names go together. */
interface CreditGroup {
    /** One role, or two that the same names hold. */
    roles: string[];
    names: readonly string[];
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * Credits as groups, in order, skipping any with no names: a credit and the
 * one after it go together when they name the same people in the same
 * order (Words: X and Music: X are "Words & Music": X). Pairs only, from
 * the first: three credits with the same names make a pair and a single.
 */
function groupCredits(credits: readonly Credit[]): CreditGroup[] {
    const groups: CreditGroup[] = [];
    const named = credits.filter(({ names }) => names.length > 0);
    for (let i = 0; i < named.length; i++) {
        const credit = named[i];
        const next = named[i + 1];
        if (next && sameNames(credit.names, next.names)) {
            groups.push({ roles: [credit.role, next.role], names: credit.names });
            i += 1;
        } else {
            groups.push({ roles: [credit.role], names: credit.names });
        }
    }
    return groups;
}

/**
 * Credits written in the convention, for Planning Center's author field:
 * `Words: Isaac Watts; Music: Lowell Mason`, and `Words & Music: John
 * Newton` for two roles next to each other that the same people hold.
 * Credits with no names are left out; no credits at all are "". Credits
 * that `parseCredits` gave as "ok" read back as the same credits.
 */
export function renderCredits(credits: readonly Credit[]): string {
    return groupCredits(credits)
        .map(({ roles, names }) => `${roles.join(" & ")}: ${names.join(", ")}`)
        .join("; ");
}

/**
 * The phrase `phrases` gives `key`: under that key, or else under one that
 * differs only in case. Only the object's own keys count, so a role named
 * "constructor" is not Object's.
 */
function ownPhrase(phrases: CreditPhrases, key: string): string | undefined {
    if (Object.hasOwn(phrases, key)) {
        return phrases[key];
    }
    const lower = key.toLowerCase();
    const match = Object.keys(phrases).find((candidate) => candidate.toLowerCase() === lower);
    return match === undefined ? undefined : phrases[match];
}

/**
 * What the copyright text prints before the names of one role ("Words
 * by"), or of two the same people hold ("Words and Music by"): the phrase
 * the settings give it, or else "<role> by", "<role> and <role> by".
 */
function phraseFor(roles: readonly string[], phrases: CreditPhrases): string {
    return ownPhrase(phrases, roles.join(" & ")) ?? `${roles.join(" and ")} by`;
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
    return names.length <= 2
        ? names.join(" and ")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** `text` as a sentence: with a period at its end, unless it already has one. */
function sentence(text: string): string {
    return text.endsWith(".") ? text : `${text}.`;
}

/**
 * Credits as the copyright text prints them, each group a sentence: "Words
 * by A and B. Music by C. Arr. by D.", and "Words and Music by X." for two
 * roles next to each other that the same people hold. Each phrase is the
 * settings' (`phrases`), or "<role> by". A name that ends with a period
 * gets no second one. No credits print "".
 */
export function renderCreditLine(credits: readonly Credit[], phrases: CreditPhrases): string {
    return groupCredits(credits)
        .map(({ roles, names }) => sentence(`${phraseFor(roles, phrases)} ${listNames(names)}`))
        .join(" ");
}

/** The phrases the legacy line prints, for the first two roles. */
function legacyPhrases({ creditRoles, creditPhrases }: CreditSettings): LegacyPhrases {
    const [words, music] = wordsAndMusicRoles(creditRoles);
    return {
        words: phraseFor([words], creditPhrases),
        music: phraseFor([music], creditPhrases),
        both: phraseFor([words, music], creditPhrases),
    };
}

/**
 * The credit line the copyright text has always printed for an author
 * (`readLegacyAuthor`), without its final period. The printing moved here
 * verbatim from `formatCopyrightText`, quirks included: an empty author is
 * "Unknown", and so is an empty words' part, while an empty music part is
 * the words' author; the two comma-separated words' authors are joined
 * with " and " even when one is empty. The phrases are the settings' for
 * the first two roles and for both, which by default print exactly what
 * the text always printed: "Words by", "Music by", "Words and Music by".
 */
export function renderLegacyCreditLine(author: string, settings: CreditSettings): string {
    const phrases = legacyPhrases(settings);
    const reading = readLegacyAuthor(author);
    switch (reading.kind) {
        case "three": {
            const wordsAuthors = reading.words.join(" and ");
            const musicAuthor = reading.music;
            return `${phrases.words} ${wordsAuthors}. ${phrases.music} ${musicAuthor}`;
        }
        case "one":
            return `${phrases.both} ${reading.author || "Unknown"}`;
        case "two": {
            const wordsAuthor = reading.words || "Unknown";
            const musicAuthor = reading.music || wordsAuthor;
            return `${phrases.words} ${wordsAuthor}. ${phrases.music} ${musicAuthor}`;
        }
    }
}

/**
 * The credit line of a song's copyright text, after its title, for what
 * its author reads as: credits that follow the convention as
 * `renderCreditLine` prints them, and any other author (legacy, unparsed,
 * or one that names nobody) as the text always printed it
 * (`renderLegacyCreditLine`), then a period, even after one the author
 * ends with ("John Newton..").
 */
export function creditLineOf(parsed: CreditsParse, settings: CreditSettings): string {
    if (parsed.status === "ok" && parsed.credits.length > 0) {
        return renderCreditLine(parsed.credits, settings.creditPhrases);
    }
    const raw = parsed.status === "ok" ? "" : parsed.raw;
    return `${renderLegacyCreditLine(raw, settings)}.`;
}
