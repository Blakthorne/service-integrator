/**
 * The form a tune name or tune alias is matched by, and stored in
 * `tune_aliases.normalized`: upper-cased, with each run of white space made
 * one space, and trimmed. "Darwal", " DARWAL " and "DARWAL" are one name.
 * (Hymn titles and aliases are matched by `normalizeTitle`.)
 */
export function normalizeTuneName(name: string): string {
    return name.toUpperCase().replace(/\s+/g, " ").trim();
}
