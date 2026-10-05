import { formatCount } from "@/lib/catalog/counts";
import { formatEntryLabel } from "@/lib/catalog/labels";
import { normalizeTuneName } from "@/lib/catalog/normalize";
import {
    ENTRY_NUMBER_MAX,
    TITLE_MAX_LENGTH,
    TUNE_NAME_MAX_LENGTH,
    VARIANT_NOTE_MAX_LENGTH,
    cleanText,
} from "@/lib/catalog/validation";
import { parseCsv, type CsvRecord } from "@/lib/csv";
import type {
    BookCsvMatch,
    BookCsvProblem,
    BookCsvProblemReason,
    BookCsvReport,
    BookCsvRow,
    BookCsvWarning,
    BookCsvWarningReason,
    ImportCounts,
} from "@/lib/domain";
import { normalizeTitle } from "@/lib/normalizeTitle";

/**
 * Importing one book from a CSV file: each row planned against the catalog,
 * and a report for review. Pure: lib/db/catalogImport.ts reads the catalog
 * and stores the run, and applying it plans again from the stored rows, so
 * it writes only what the preview showed, or refuses when the catalog has
 * changed since.
 *
 * - **Columns.** A header row, then a row per entry: `number,title,tune,variant`
 *   for a numbered book, `position,title,tune,variant` for one without
 *   numbers, in any order and any case; tune and variant may be left out.
 * - **Matching.** A row's hymn is the one whose title, or another title, is
 *   the row's (by `normalizeTitle`), else a new one; its tune the one whose
 *   name, or another name, is the row's (by `normalizeTuneName`), else a new
 *   one; its song that hymn to that tune, else a new one. A row with no tune
 *   goes with its hymn's only song, whatever its tune, so a book imported as
 *   `number,title` joins the songs the catalog has and makes no twins of
 *   them; a hymn with no song gets a new one, with no tune. Rows of one new
 *   title share one new hymn, and the same for tunes and songs.
 * - **Places.** A numbered book's rows take their numbers. A book without
 *   numbers keeps its entries and takes the rows after them, in the order of
 *   their positions, so its positions stay 1, 2, 3, ….
 * - **Blocking problems**, each with its lines, refuse the import: a file
 *   that is not CSV, is empty, or whose header does not fit the book; a row
 *   with extra fields, no title, a field too long, or a number (or position)
 *   that does not read; a number (or position) on two rows; a number the
 *   book already has for another song; a row with no tune for a hymn that
 *   has several songs, which needs its tune named; and one song in the book
 *   twice with the same variant note, or none, from two rows or a row and
 *   the book.
 * - **Warnings** need a look but do not block: a title (or tune name)
 *   several hymns (or tunes) have, where the row goes with one of them; a
 *   row the book already has, which is left out; and where a book without
 *   numbers puts the rows.
 */

/** The book a file is imported into. */
export interface BookCsvBook {
    id: number;
    code: string;
    name: string;
    numbered: boolean;
    labelFormat: string;
}

/** What the plan needs of the catalog: every hymn, tune and song, and the book's entries. */
export interface BookCsvCatalog {
    hymns: readonly { id: number; title: string; aliases: readonly string[] }[];
    tunes: readonly { id: number; name: string; aliases: readonly string[] }[];
    songs: readonly { id: number; hymnId: number; tuneId: number | null }[];
    /** The book's entries now. */
    entries: readonly {
        songId: number;
        number: number | null;
        position: number | null;
        variantNote: string | null;
    }[];
}

/** A hymn or tune the plan uses: one of the catalog's, by id, or a new one, by its normalized name. */
export type BookCsvRef = { id: number } | { key: string };

/** A new song: a hymn to a tune (or to none). */
export interface PlannedBookSong {
    hymn: BookCsvRef;
    tune: BookCsvRef | null;
}

/** An entry to add, for the song of `hymn` and `tune`, from the row on `line`. */
export interface PlannedBookEntry {
    line: number;
    hymn: BookCsvRef;
    tune: BookCsvRef | null;
    /** A numbered book's entry's number; null in a book without numbers. */
    number: number | null;
    /** A book without numbers' entry's position (after the entries it has); null in a numbered book. */
    position: number | null;
    variantNote: string | null;
}

/** Everything the import adds, in the order apply inserts it. */
export interface PlannedBookRows {
    bookId: number;
    hymns: { key: string; title: string }[];
    tunes: { key: string; name: string }[];
    songs: PlannedBookSong[];
    entries: PlannedBookEntry[];
}

/** A book file's plan, and its report. */
export interface BookCsvImport {
    report: BookCsvReport;
    rows: PlannedBookRows;
}

/** A numbered book's columns, or a book without numbers', in the order a template names them. */
export function bookCsvColumns(numbered: boolean): string[] {
    return [numbered ? "number" : "position", "title", "tune", "variant"];
}

/** "a", "a and b", "a, b and c". */
function joinWithAnd(items: readonly string[]): string {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "line 4", "lines 4 and 9". */
function linesText(lines: readonly number[]): string {
    return `${lines.length === 1 ? "line" : "lines"} ${joinWithAnd(lines.map(String))}`;
}

/** A song's label: "Amazing Grace (NEW BRITAIN)", or the title alone with no tune. */
function songLabel(title: string, tuneName: string | null): string {
    return tuneName === null ? title : `${title} (${tuneName})`;
}

/** The header's columns, read: the index of each column the book takes, or the problem with it. */
type HeaderRead =
    | { ok: true; columns: Record<string, number> }
    | { ok: false; problem: BookCsvProblem };

function readHeader(header: CsvRecord, book: BookCsvBook): HeaderRead {
    const names = header.fields.map((field) => field.trim().toLowerCase());
    const known = bookCsvColumns(book.numbered);
    const [placement] = known;
    const columns: Record<string, number> = {};
    const unknown: string[] = [];
    const twice: string[] = [];
    names.forEach((name, index) => {
        if (name === "" && index === names.length - 1 && index > 0) {
            return; // A trailing comma after the last column.
        }
        if (!known.includes(name)) {
            unknown.push(name === "" ? "a column with no name" : name);
        } else if (name in columns) {
            twice.push(name);
        } else {
            columns[name] = index;
        }
    });
    const missing = [placement, "title"].filter((name) => !(name in columns));
    if (missing.length === 0 && unknown.length === 0 && twice.length === 0) {
        return { ok: true, columns };
    }
    const kind = book.numbered ? "numbers its songs" : "has no numbers";
    const faults = [
        missing.length > 0 ? `it has no ${joinWithAnd(missing)} column` : null,
        unknown.length > 0 ? `${joinWithAnd(unknown)} ${unknown.length === 1 ? "is not a column" : "are not columns"} it takes` : null,
        twice.length > 0 ? `it names ${joinWithAnd(twice)} twice` : null,
    ].filter((fault) => fault !== null);
    return {
        ok: false,
        problem: {
            reason: "header",
            line: header.line,
            lines: [header.line],
            message: `The header does not fit ${book.name}, which ${kind}: ${joinWithAnd(faults)}. Its first row must name the columns ${known.join(", ")}, in any order (tune and variant may be left out).`,
        },
    };
}

/** A whole number from 1 to `ENTRY_NUMBER_MAX`, or null when the text is not one. */
function readWholeNumber(text: string): number | null {
    const digits = text.trim();
    if (!/^[0-9]+$/.test(digits)) {
        return null;
    }
    const value = Number(digits);
    return value >= 1 && value <= ENTRY_NUMBER_MAX ? value : null;
}

/** A row read from the file: what it says, cleaned, and the problems it has on its own. */
interface ReadRow {
    line: number;
    /** Its number or position, or null when it does not read. */
    place: number | null;
    title: string;
    tune: string | null;
    variantNote: string | null;
    problems: BookCsvProblem[];
}

function readRow(record: CsvRecord, columns: Record<string, number>, book: BookCsvBook): ReadRow {
    const { line, fields } = record;
    const get = (name: string) => (name in columns ? (fields[columns[name]] ?? "") : "");
    const problems: BookCsvProblem[] = [];
    const add = (reason: BookCsvProblemReason, message: string) =>
        problems.push({ reason, line, lines: [line], message });

    const width = Math.max(...Object.values(columns)) + 1;
    if (fields.slice(width).some((field) => field.trim() !== "")) {
        add(
            "extra-fields",
            `Line ${line} has ${fields.length} fields, but the header names ${width}. Put a field with a comma in it in double quotes.`
        );
    }

    const placeColumn = book.numbered ? "number" : "position";
    const rawPlace = get(placeColumn).trim();
    const place = readWholeNumber(rawPlace);
    if (place === null) {
        add(
            book.numbered ? "bad-number" : "bad-position",
            rawPlace === ""
                ? `Line ${line} has no ${placeColumn}.`
                : `Line ${line}: "${rawPlace}" is not a ${placeColumn}, a whole number from 1 to ${formatCount(ENTRY_NUMBER_MAX)}.`
        );
    }

    const title = cleanText(get("title"));
    if (normalizeTitle(title) === "") {
        add("blank-title", `Line ${line} has no title.`);
    } else if (title.length > TITLE_MAX_LENGTH) {
        add("too-long", `Line ${line}: the title has more than ${TITLE_MAX_LENGTH} characters.`);
    }
    const tune = cleanText(get("tune"));
    if (tune.length > TUNE_NAME_MAX_LENGTH) {
        add("too-long", `Line ${line}: the tune's name has more than ${TUNE_NAME_MAX_LENGTH} characters.`);
    }
    const variantNote = cleanText(get("variant"));
    if (variantNote.length > VARIANT_NOTE_MAX_LENGTH) {
        add("too-long", `Line ${line}: the variant note has more than ${VARIANT_NOTE_MAX_LENGTH} characters.`);
    }
    return {
        line,
        place,
        title,
        tune: tune === "" ? null : tune,
        variantNote: variantNote === "" ? null : variantNote,
        problems,
    };
}

/** Ids by normalized name, each list in id order; other names are unique, so one id each. */
interface NameIndex {
    names: Map<string, number[]>;
    aliases: Map<string, number>;
    /** Each row's own name, by id. */
    byId: Map<number, string>;
}

function indexNames(
    rows: readonly { id: number; name: string; aliases: readonly string[] }[],
    normalize: (text: string) => string
): NameIndex {
    const index: NameIndex = { names: new Map(), aliases: new Map(), byId: new Map() };
    for (const row of [...rows].sort((a, b) => a.id - b.id)) {
        index.byId.set(row.id, row.name);
        const key = normalize(row.name);
        index.names.set(key, [...(index.names.get(key) ?? []), row.id]);
        for (const alias of row.aliases) {
            index.aliases.set(normalize(alias), row.id);
        }
    }
    return index;
}

/** A row matched to the catalog. */
interface Matched {
    hymn: BookCsvRef;
    tune: BookCsvRef | null;
    hymnMatch: BookCsvMatch;
    tuneMatch: BookCsvMatch;
    /** The catalog's song for the hymn and tune, or null for a new one. */
    songId: number | null;
    /** The song's label, for messages. */
    label: string;
    /** What blocks the row: it has no tune, and its hymn has several songs. */
    problems: BookCsvProblem[];
    warnings: BookCsvWarning[];
}

/** The key a song is known by in the plan: its hymn's ref and its tune's. */
function songKey(hymn: BookCsvRef, tune: BookCsvRef | null): string {
    return JSON.stringify([hymn, tune]);
}

function refOf(match: BookCsvMatch, key: string): BookCsvRef | null {
    return match.kind === "existing" ? { id: match.id } : match.kind === "new" ? { key } : null;
}

/**
 * Plan importing a book's CSV file, already parsed into records (the first
 * is the header), against the catalog (see the module's comment). Pure and
 * deterministic: the same book, records and catalog give the same plan, so
 * apply can tell whether the catalog changed since the preview.
 */
export function planBookCsvImport(
    book: BookCsvBook,
    records: readonly CsvRecord[],
    catalog: BookCsvCatalog
): BookCsvImport {
    const problems: BookCsvProblem[] = [];
    const warnings: BookCsvWarning[] = [];
    const rows: BookCsvRow[] = [];
    const planned: PlannedBookRows = { bookId: book.id, hymns: [], tunes: [], songs: [], entries: [] };
    const report = (columns: string[], dataRows: number, blankRows: number): BookCsvImport => ({
        report: {
            book: { id: book.id, code: book.code, name: book.name, numbered: book.numbered },
            input: { rows: dataRows, blankRows, columns },
            planned: countsOf(planned),
            problems,
            warnings,
            rows,
        },
        rows: planned,
    });

    const [header, ...data] = records;
    if (!header) {
        problems.push({
            reason: "empty",
            line: null,
            lines: [],
            message: "The file is empty. It needs a header row, then a row for each song.",
        });
        return report([], 0, 0);
    }
    const columns = header.fields.map((field) => field.trim());
    const headerRead = readHeader(header, book);
    if (!headerRead.ok) {
        problems.push(headerRead.problem);
        return report(columns, data.length, 0);
    }

    const filled = data.filter((record) => record.fields.some((field) => field.trim() !== ""));
    const blankRows = data.length - filled.length;
    if (filled.length === 0) {
        problems.push({
            reason: "empty",
            line: null,
            lines: [],
            message: "The file has no rows below its header.",
        });
        return report(columns, data.length, blankRows);
    }

    const hymns = indexNames(
        catalog.hymns.map(({ id, title, aliases }) => ({ id, name: title, aliases })),
        normalizeTitle
    );
    const tunes = indexNames(catalog.tunes, normalizeTuneName);
    const songsByKey = new Map(
        catalog.songs.map((song) => [songKey({ id: song.hymnId }, song.tuneId === null ? null : { id: song.tuneId }), song])
    );
    const hasSong = (hymnId: number, tuneId: number | null) =>
        songsByKey.has(songKey({ id: hymnId }, tuneId === null ? null : { id: tuneId }));
    const songsByHymn = new Map<number, BookCsvCatalog["songs"][number][]>();
    for (const song of [...catalog.songs].sort((a, b) => a.id - b.id)) {
        songsByHymn.set(song.hymnId, [...(songsByHymn.get(song.hymnId) ?? []), song]);
    }
    /** A hymn's songs, in id order. */
    const songsOf = (hymnId: number) => songsByHymn.get(hymnId) ?? [];
    /** A hymn's only song, or undefined when it has none or several. */
    const onlySongOf = (hymnId: number) => {
        const songs = songsOf(hymnId);
        return songs.length === 1 ? songs[0] : undefined;
    };
    const existingLabel = (songId: number) => {
        const song = catalog.songs.find(({ id }) => id === songId);
        return song
            ? songLabel(hymns.byId.get(song.hymnId) ?? "", song.tuneId === null ? null : (tunes.byId.get(song.tuneId) ?? null))
            : `song ${songId}`;
    };
    const labelOf = (number: number | null) =>
        formatEntryLabel(book, { number: book.numbered ? number : null, locationLabel: null });

    /** Match a row's hymn, tune and song (see the module's comment). */
    const match = (row: ReadRow): Matched => {
        const rowProblems: BookCsvProblem[] = [];
        const rowWarnings: BookCsvWarning[] = [];
        const warn = (reason: BookCsvWarningReason, message: string) =>
            rowWarnings.push({ reason, line: row.line, lines: [row.line], message });
        const hymnKey = normalizeTitle(row.title);
        const tuneKey = row.tune === null ? null : normalizeTuneName(row.tune);
        const tuneIds =
            tuneKey === null
                ? []
                : (tunes.names.get(tuneKey) ?? (tunes.aliases.has(tuneKey) ? [tunes.aliases.get(tuneKey)!] : []));

        let hymnMatch: BookCsvMatch;
        const titled = hymns.names.get(hymnKey) ?? [];
        if (titled.length > 0) {
            // The hymn that suits the row: one sung to its tune, or, for a row
            // with no tune, one with a single song, best a song with no tune.
            const suited =
                tuneKey === null
                    ? (titled.find((hymnId) => onlySongOf(hymnId)?.tuneId === null) ??
                      titled.find((hymnId) => onlySongOf(hymnId) !== undefined))
                    : titled.find((hymnId) => tuneIds.some((tuneId) => hasSong(hymnId, tuneId)));
            const id = suited ?? titled[0];
            hymnMatch = { kind: "existing", id, name: hymns.byId.get(id)!, by: "name" };
            if (titled.length > 1) {
                const goesWith =
                    suited === undefined ? "first added" : tuneKey === null ? "that has a single song" : "sung to its tune";
                warn(
                    "ambiguous-hymn",
                    `Line ${row.line}: ${formatCount(titled.length)} hymns are titled "${row.title}"; the row goes with the one ${goesWith}. Merge them, or retitle one, if they are one hymn.`
                );
            }
        } else if (hymns.aliases.has(hymnKey)) {
            const id = hymns.aliases.get(hymnKey)!;
            hymnMatch = { kind: "existing", id, name: hymns.byId.get(id)!, by: "alias" };
        } else {
            hymnMatch = { kind: "new" };
        }

        let tuneMatch: BookCsvMatch;
        if (tuneKey === null) {
            // No tune: the hymn's only song, whatever its tune. With several
            // songs the row cannot say which, and the file needs a tune.
            const songs = hymnMatch.kind === "existing" ? songsOf(hymnMatch.id) : [];
            const only = songs.length === 1 ? songs[0] : undefined;
            tuneMatch =
                only === undefined || only.tuneId === null
                    ? { kind: "none" }
                    : { kind: "existing", id: only.tuneId, name: tunes.byId.get(only.tuneId)!, by: "song" };
            if (hymnMatch.kind === "existing" && songs.length > 1) {
                const sungTo = songs.map(({ tuneId }) =>
                    tuneId === null ? "no tune" : (tunes.byId.get(tuneId) ?? `tune ${tuneId}`)
                );
                rowProblems.push({
                    reason: "tune-needed",
                    line: row.line,
                    lines: [row.line],
                    message: `Line ${row.line}: "${hymnMatch.name}" has ${formatCount(songs.length)} songs, sung to ${joinWithAnd(sungTo)}, so a row with no tune cannot say which one it is. Name the tune in the row's tune column (add the column if the file has none).`,
                });
            }
        } else {
            const named = tunes.names.get(tuneKey) ?? [];
            if (named.length > 0) {
                const hymnId = hymnMatch.kind === "existing" ? hymnMatch.id : null;
                const id = named.find((tuneId) => hymnId !== null && hasSong(hymnId, tuneId)) ?? named[0];
                tuneMatch = { kind: "existing", id, name: tunes.byId.get(id)!, by: "name" };
                if (named.length > 1) {
                    warn(
                        "ambiguous-tune",
                        `Line ${row.line}: ${formatCount(named.length)} tunes are named ${row.tune}; the row goes with the one ${hymnId !== null && hasSong(hymnId, id) ? "its hymn is sung to" : "first added"}. Merge them if they are one tune.`
                    );
                }
            } else if (tunes.aliases.has(tuneKey)) {
                const id = tunes.aliases.get(tuneKey)!;
                tuneMatch = { kind: "existing", id, name: tunes.byId.get(id)!, by: "alias" };
            } else {
                tuneMatch = { kind: "new" };
            }
        }

        const hymn = refOf(hymnMatch, hymnKey)!;
        const tune = refOf(tuneMatch, tuneKey ?? "");
        const existing = songsByKey.get(songKey(hymn, tune));
        const title = hymnMatch.kind === "existing" ? hymnMatch.name : row.title;
        const tuneName = tuneMatch.kind === "existing" ? tuneMatch.name : row.tune;
        return {
            hymn,
            tune,
            hymnMatch,
            tuneMatch,
            songId: existing?.id ?? null,
            label: songLabel(title, tuneName),
            problems: rowProblems,
            warnings: rowWarnings,
        };
    };

    const read = filled.map((record) => readRow(record, headerRead.columns, book));
    const matched = new Map<ReadRow, Matched>();
    const blocked = new Set<ReadRow>(read.filter((row) => row.problems.length > 0));
    const skipped = new Set<ReadRow>();
    const block = (row: ReadRow) => blocked.add(row);
    for (const row of read) {
        problems.push(...row.problems);
        if (!row.problems.some(({ reason }) => reason === "blank-title" || reason === "too-long")) {
            const result = match(row);
            matched.set(row, result);
            problems.push(...result.problems);
            warnings.push(...result.warnings);
            if (result.problems.length > 0) {
                block(row);
            }
        }
    }

    // A number (or position) on several rows.
    const byPlace = new Map<number, ReadRow[]>();
    for (const row of read) {
        if (row.place !== null) {
            byPlace.set(row.place, [...(byPlace.get(row.place) ?? []), row]);
        }
    }
    for (const [place, same] of byPlace) {
        if (same.length > 1) {
            const lines = same.map(({ line }) => line);
            problems.push({
                reason: book.numbered ? "number-duplicated" : "position-duplicated",
                line: lines[0],
                lines,
                message: book.numbered
                    ? `${labelOf(place)} is on ${linesText(lines)}. A number is in a book once.`
                    : `Position ${place} is on ${linesText(lines)}, so their order is not clear.`,
            });
            same.forEach(block);
        }
    }

    // What the book has already: a number another entry has, or the very entry.
    const existingByNumber = new Map(
        catalog.entries.flatMap((entry) => (entry.number === null ? [] : [[entry.number, entry] as const]))
    );
    const inBook = (songId: number, variantNote: string | null) =>
        catalog.entries.find((entry) => entry.songId === songId && entry.variantNote === variantNote);
    for (const row of read) {
        const result = matched.get(row);
        if (!result || blocked.has(row) || row.place === null) {
            continue;
        }
        const there = result.songId === null ? undefined : inBook(result.songId, row.variantNote);
        if (book.numbered) {
            const holder = existingByNumber.get(row.place);
            if (holder && holder === there) {
                skipped.add(row);
                continue;
            }
            if (holder) {
                problems.push({
                    reason: "number-taken",
                    line: row.line,
                    lines: [row.line],
                    message: `Line ${row.line}: ${labelOf(row.place)} is taken by "${existingLabel(holder.songId)}".`,
                });
                block(row);
                continue;
            }
            if (there) {
                const variant =
                    row.variantNote === null ? "with no variant note" : `with the variant note "${row.variantNote}"`;
                problems.push({
                    reason: "song-twice",
                    line: row.line,
                    lines: [row.line],
                    message: `Line ${row.line}: "${result.label}" is already in ${book.name} as ${labelOf(there.number)}, ${variant}. Give the row a variant note, or leave it out.`,
                });
                block(row);
            }
        } else if (there) {
            skipped.add(row);
        }
    }
    for (const row of skipped) {
        warnings.push({
            reason: "already-in-book",
            line: row.line,
            lines: [row.line],
            message: `Line ${row.line}: "${matched.get(row)!.label}" is in ${book.name} already${book.numbered ? ` as ${labelOf(row.place)}` : ""}, so the row is left out.`,
        });
    }

    // One song in the book twice, from two rows.
    const bySongAndNote = new Map<string, ReadRow[]>();
    for (const row of read) {
        const result = matched.get(row);
        if (result && !blocked.has(row) && !skipped.has(row)) {
            const key = JSON.stringify([songKey(result.hymn, result.tune), row.variantNote]);
            bySongAndNote.set(key, [...(bySongAndNote.get(key) ?? []), row]);
        }
    }
    for (const same of bySongAndNote.values()) {
        if (same.length > 1) {
            const lines = same.map(({ line }) => line);
            const note = same[0].variantNote;
            problems.push({
                reason: "song-twice",
                line: lines[1],
                lines,
                message: `${linesText(lines).replace(/^l/, "L")} put "${matched.get(same[0])!.label}" in ${book.name} ${formatCount(same.length)} times, ${note === null ? "with no variant note" : `with the variant note "${note}"`}. Give each a variant note of its own, or keep one.`,
            });
            same.slice(1).forEach(block);
        }
    }

    // The plan: the rows that add an entry, in file order; new hymns, tunes
    // and songs as rows first need them.
    const adding = read.filter((row) => matched.has(row) && !blocked.has(row) && !skipped.has(row));
    const newHymns = new Set<string>();
    const newTunes = new Set<string>();
    const newSongs = new Set<string>();
    const positions = new Map<ReadRow, number>();
    if (!book.numbered) {
        // After the book's last position (its entries are 1 to n, unless an
        // older row left a gap), in the order of the rows' positions.
        const count = catalog.entries.length;
        const start = Math.max(count, ...catalog.entries.map(({ position }) => position ?? 0));
        [...adding]
            .sort((a, b) => a.place! - b.place! || a.line - b.line)
            .forEach((row, index) => positions.set(row, start + index + 1));
        const places = adding.map(({ place }) => place!).sort((a, b) => a - b);
        const dense = places.every((place, index) => place === index + 1);
        if (adding.length > 0 && (count > 0 || !dense)) {
            warnings.push({
                reason: "positions",
                line: null,
                lines: [],
                message:
                    count > 0
                        ? `${book.name} has ${formatCount(count)} ${count === 1 ? "entry" : "entries"} already, so the rows go after them, in the order of their positions: at ${start + 1} to ${start + adding.length}.`
                        : `The rows go in the order of their positions, at 1 to ${adding.length}.`,
            });
        }
    }
    for (const row of adding) {
        const result = matched.get(row)!;
        if ("key" in result.hymn && !newHymns.has(result.hymn.key)) {
            newHymns.add(result.hymn.key);
            planned.hymns.push({ key: result.hymn.key, title: row.title });
        }
        if (result.tune !== null && "key" in result.tune && !newTunes.has(result.tune.key)) {
            newTunes.add(result.tune.key);
            planned.tunes.push({ key: result.tune.key, name: row.tune! });
        }
        const key = songKey(result.hymn, result.tune);
        if (result.songId === null && !newSongs.has(key)) {
            newSongs.add(key);
            planned.songs.push({ hymn: result.hymn, tune: result.tune });
        }
        planned.entries.push({
            line: row.line,
            hymn: result.hymn,
            tune: result.tune,
            number: book.numbered ? row.place : null,
            position: book.numbered ? null : positions.get(row)!,
            variantNote: row.variantNote,
        });
    }

    for (const row of read) {
        const result = matched.get(row);
        rows.push({
            line: row.line,
            number: book.numbered ? row.place : null,
            position: book.numbered ? null : row.place,
            label: row.place === null ? null : labelOf(row.place),
            title: row.title,
            tune: row.tune,
            variantNote: row.variantNote,
            hymn: result?.hymnMatch ?? { kind: "none" },
            tuneMatch: result?.tuneMatch ?? { kind: "none" },
            // A row that has no tune for a hymn with several songs matches none.
            song: result && result.problems.length === 0 ? (result.songId === null ? "new" : "existing") : null,
            outcome: blocked.has(row) ? "blocked" : skipped.has(row) ? "skip" : "add",
        });
    }
    problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    warnings.sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
    return report(columns, data.length, blankRows);
}

/** How many rows of each kind the plan adds. */
function countsOf(rows: PlannedBookRows): ImportCounts {
    return {
        books: 0,
        hymns: rows.hymns.length,
        hymnAliases: 0,
        tunes: rows.tunes.length,
        tuneAliases: 0,
        songs: rows.songs.length,
        songsWithoutTune: rows.songs.filter(({ tune }) => tune === null).length,
        entries: rows.entries.length,
    };
}

/** What a book import stores in `import_runs.rows`: the file's records, to plan again at apply, and the plan. */
export interface StoredBookCsvRows {
    records: CsvRecord[];
    planned: PlannedBookRows;
}

/**
 * Plan importing a book's CSV text: parse it (`parseCsv`), then plan it
 * (`planBookCsvImport`). Text that is not CSV is a report with that one
 * problem, which blocks the import. Returns the plan and what to store.
 */
export function planBookCsvText(
    book: BookCsvBook,
    text: string,
    catalog: BookCsvCatalog
): BookCsvImport & { stored: StoredBookCsvRows } {
    const parsed = parseCsv(text);
    if (!parsed.ok) {
        const plan = planBookCsvImport(book, [], catalog);
        plan.report.problems = [
            { reason: "malformed", line: parsed.line, lines: [parsed.line], message: parsed.message },
        ];
        return { ...plan, stored: { records: [], planned: plan.rows } };
    }
    const plan = planBookCsvImport(book, parsed.records, catalog);
    return { ...plan, stored: { records: parsed.records, planned: plan.rows } };
}

/** Thrown by `parseStoredBookCsvRows` for stored rows that are damaged. */
export class InvalidStoredBookCsvRowsError extends Error {
    constructor(problem: string) {
        super(`The stored book import is not valid: ${problem}`);
        this.name = "InvalidStoredBookCsvRowsError";
    }
}

/**
 * Check a value parsed from `import_runs.rows` for a book import: its
 * records must be `{ line, fields }` with a whole line number and text
 * fields. The plan is not checked here: apply plans again from the records
 * and compares, so a damaged plan reads as a changed one.
 */
export function parseStoredBookCsvRows(value: unknown): StoredBookCsvRows {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new InvalidStoredBookCsvRowsError("not an object");
    }
    const { records, planned } = value as Record<string, unknown>;
    if (!Array.isArray(records)) {
        throw new InvalidStoredBookCsvRowsError("no records");
    }
    const checked = records.map((record, index): CsvRecord => {
        const { line, fields } = (record ?? {}) as Record<string, unknown>;
        if (
            !Number.isSafeInteger(line) ||
            !Array.isArray(fields) ||
            !fields.every((field) => typeof field === "string")
        ) {
            throw new InvalidStoredBookCsvRowsError(`record ${index} is not a line and its fields`);
        }
        return { line: line as number, fields: fields as string[] };
    });
    return { records: checked, planned: planned as PlannedBookRows };
}
