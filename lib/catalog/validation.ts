import type { Book, SongMarkKind } from "@/lib/domain";
import {
    readId,
    readOptionalPositiveInteger,
    readString,
    type FieldErrors,
} from "@/lib/forms";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { readTuneHint, tunesNamedBy, type CatalogIndex } from "@/lib/reconcile";
import { formatCount } from "./counts";
import { parseBookCode, parseCatalogId } from "./ids";
import { formatEntryLabel, NUMBER_PLACEHOLDER } from "./labels";
import { isSongMarkKind } from "./marks";

/**
 * The catalog's forms: their fields, and the checks on what they post that
 * need no database. Pure and safe on both sides; the checks that need the
 * catalog (a title or name already taken, a song or number that exists)
 * are in `lib/db/catalogWrites.ts` (the new-song form) and
 * `lib/db/catalogEdit.ts` (the rest).
 *
 * The new-song form (`/catalog/songs/new`) comes first, with what it starts
 * with (prefilled from a Planning Center song's title). A song is one hymn
 * to one tune. The form chooses the hymn (one in the catalog, or a new
 * title), the tune (one in the catalog, a new name, or none) and,
 * optionally, the song's first entry in a book.
 *
 * Then the forms that edit the catalog, each with its fields (`…_FIELDS`),
 * the parts that show one error each, and a reader that returns the typed
 * input or every part's problem at once (`FormCheck`): a song's marks,
 * entries, hymns and tunes and their other names, merges, books and the
 * book CSV upload. An id posted in a hidden field goes through its parser
 * (convention 19); one that does not parse is an error on the part it names.
 */

/** The fields the form posts, each as text. */
export const NEW_SONG_FIELDS = [
    /** "existing" or "new": see `HYMN_MODES`. */
    "hymn",
    "hymnId",
    "hymnTitle",
    /** "existing", "new" or "none": see `TUNE_MODES`. */
    "tune",
    "tuneId",
    "tuneName",
    /** The book of the first entry, or "" for none. */
    "bookId",
    /** "number" or "location", in a numbered book: see `PLACEMENTS`. */
    "placement",
    "number",
    "location",
] as const;

export type NewSongField = (typeof NEW_SONG_FIELDS)[number];

/** What the form posts, or starts with, by field. */
export type NewSongValues = Record<NewSongField, string>;

/** The parts of the form, each of which shows at most one error. */
export type NewSongPart = "hymn" | "tune" | "entry";

/** A hymn in the catalog, or a new title. */
export const HYMN_MODES = ["existing", "new"] as const;
export type HymnMode = (typeof HYMN_MODES)[number];

/** A tune in the catalog, a new name, or none (unknown). */
export const TUNE_MODES = ["existing", "new", "none"] as const;
export type TuneMode = (typeof TUNE_MODES)[number];

/** Where a numbered book has the song: at a number, or at a location such as the front cover. */
export const PLACEMENTS = ["number", "location"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** The longest hymn title the form takes. */
export const TITLE_MAX_LENGTH = 200;

/** The longest tune name the form takes. */
export const TUNE_NAME_MAX_LENGTH = 100;

/** The longest location ("front cover") the form takes. */
export const LOCATION_MAX_LENGTH = 50;

/** The highest number an entry may have. */
export const ENTRY_NUMBER_MAX = 99_999;

/** The new song's hymn. */
export type HymnChoice =
    | { kind: "existing"; hymnId: number }
    | { kind: "new"; title: string };

/** The new song's tune. */
export type TuneChoice =
    | { kind: "existing"; tuneId: number }
    | { kind: "new"; name: string }
    | { kind: "none" };

/**
 * Where the new song's first entry goes: at a number or a location in a
 * numbered book, or at the end of a book without numbers.
 */
export type EntryChoice =
    | { kind: "number"; bookId: number; number: number }
    | { kind: "location"; bookId: number; locationLabel: string }
    | { kind: "end"; bookId: number };

/** A new song as the form describes it, checked for everything that needs no database. */
export interface NewSongInput {
    hymn: HymnChoice;
    tune: TuneChoice;
    /** Null when the song is in no book yet. */
    entry: EntryChoice | null;
}

/** What `validateNewSong` made of the form. */
export type NewSongValidation =
    | { ok: true; input: NewSongInput }
    | { ok: false; fieldErrors: FieldErrors<NewSongPart> };

/** The books the form offers, as validation needs them. */
export type NewSongBook = Pick<Book, "id" | "name" | "numbered">;

/** Text as typed, with each run of white space made one space, and trimmed. */
export function cleanText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** A field's text as `cleanText` leaves it. */
function readText(formData: FormData, name: NewSongField): string {
    return cleanText(readString(formData, name));
}

/** A mode field's value, or null when it is not one of `modes`. */
function readMode<T extends string>(
    formData: FormData,
    name: NewSongField,
    modes: readonly T[]
): T | null {
    const value = readString(formData, name);
    return modes.find((mode) => mode === value) ?? null;
}

type PartResult<T> = { ok: true; value: T } | { ok: false; message: string };

function readHymn(formData: FormData): PartResult<HymnChoice> {
    switch (readMode(formData, "hymn", HYMN_MODES)) {
        case "existing": {
            const hymnId = readId(formData, "hymnId", parseCatalogId);
            return hymnId === null
                ? { ok: false, message: "Choose a hymn from the list." }
                : { ok: true, value: { kind: "existing", hymnId } };
        }
        case "new": {
            const title = readText(formData, "hymnTitle");
            if (title === "") {
                return { ok: false, message: "Type the new hymn's title." };
            }
            if (title.length > TITLE_MAX_LENGTH) {
                return {
                    ok: false,
                    message: `A title has at most ${TITLE_MAX_LENGTH} characters.`,
                };
            }
            if (normalizeTitle(title) === "") {
                return { ok: false, message: "A title needs letters or numbers." };
            }
            return { ok: true, value: { kind: "new", title } };
        }
        case null:
            return {
                ok: false,
                message: "Choose a hymn from the list, or type a new title.",
            };
    }
}

function readTune(formData: FormData): PartResult<TuneChoice> {
    switch (readMode(formData, "tune", TUNE_MODES)) {
        case "existing": {
            const tuneId = readId(formData, "tuneId", parseCatalogId);
            return tuneId === null
                ? { ok: false, message: "Choose a tune from the list." }
                : { ok: true, value: { kind: "existing", tuneId } };
        }
        case "new": {
            const name = readText(formData, "tuneName");
            if (name === "") {
                return { ok: false, message: "Type the new tune's name." };
            }
            if (name.length > TUNE_NAME_MAX_LENGTH) {
                return {
                    ok: false,
                    message: `A tune's name has at most ${TUNE_NAME_MAX_LENGTH} characters.`,
                };
            }
            return { ok: true, value: { kind: "new", name } };
        }
        case "none":
            return { ok: true, value: { kind: "none" } };
        case null:
            return {
                ok: false,
                message: "Choose a tune from the list, type a new one, or choose None.",
            };
    }
}

function readEntry(
    formData: FormData,
    books: readonly NewSongBook[]
): PartResult<EntryChoice | null> {
    if (readString(formData, "bookId") === "") {
        return { ok: true, value: null };
    }
    const bookId = readId(formData, "bookId", parseCatalogId);
    const book = books.find(({ id }) => id === bookId);
    if (bookId === null || !book) {
        return { ok: false, message: "Choose a book from the list, or No book." };
    }
    if (!book.numbered) {
        return { ok: true, value: { kind: "end", bookId } };
    }
    switch (readMode(formData, "placement", PLACEMENTS)) {
        case "number": {
            const number = readOptionalPositiveInteger(formData, "number", {
                max: ENTRY_NUMBER_MAX,
            });
            if (!number.ok) {
                return {
                    ok: false,
                    message: `A number is a whole number from 1 to ${formatCount(ENTRY_NUMBER_MAX)}.`,
                };
            }
            return number.value === null
                ? { ok: false, message: `Type the song's number in ${book.name}.` }
                : { ok: true, value: { kind: "number", bookId, number: number.value } };
        }
        case "location": {
            const locationLabel = readText(formData, "location");
            if (locationLabel === "") {
                return {
                    ok: false,
                    message: `Type where ${book.name} has the song, such as front cover.`,
                };
            }
            if (locationLabel.length > LOCATION_MAX_LENGTH) {
                return {
                    ok: false,
                    message: `A location has at most ${LOCATION_MAX_LENGTH} characters.`,
                };
            }
            return { ok: true, value: { kind: "location", bookId, locationLabel } };
        }
        case null:
            return { ok: false, message: "Choose a number or a location." };
    }
}

/**
 * Check what the form posted, without the database: each part must say
 * what it is (a mode the form offers) and give what that mode needs, typed
 * text cleaned with `cleanText`, ids through `parseCatalogId`. `books` are
 * the catalog's books: the entry's must be one of them, and decides whether
 * the entry takes a number or location (a numbered book) or goes at the end
 * (a book without numbers, whose number and location fields are ignored).
 * Every part with a problem gets its error, so the form shows them all at
 * once.
 */
export function validateNewSong(
    formData: FormData,
    books: readonly NewSongBook[]
): NewSongValidation {
    const hymn = readHymn(formData);
    const tune = readTune(formData);
    const entry = readEntry(formData, books);
    if (hymn.ok && tune.ok && entry.ok) {
        return {
            ok: true,
            input: { hymn: hymn.value, tune: tune.value, entry: entry.value },
        };
    }
    const fieldErrors: FieldErrors<NewSongPart> = {};
    if (!hymn.ok) {
        fieldErrors.hymn = { message: hymn.message };
    }
    if (!tune.ok) {
        fieldErrors.tune = { message: tune.message };
    }
    if (!entry.ok) {
        fieldErrors.entry = { message: entry.message };
    }
    return { ok: false, fieldErrors };
}

/**
 * The label the form's entry will have in `book`, as it shows it under the
 * fields while they are typed in: "R-396" for a number, "G-Front Cover" for
 * a location, the short name of a book without numbers; null while what is
 * typed makes none (no number yet, or one that is not a number).
 */
export function previewEntryLabel(
    book: Pick<Book, "numbered" | "labelFormat">,
    { placement, number, location }: Pick<NewSongValues, "placement" | "number" | "location">
): string | null {
    if (!book.numbered) {
        return formatEntryLabel(book, { number: null, locationLabel: null });
    }
    if (placement === "location") {
        const locationLabel = cleanText(location);
        return locationLabel === "" ? null : formatEntryLabel(book, { number: null, locationLabel });
    }
    const digits = number.trim();
    return /^[0-9]+$/.test(digits) && Number(digits) >= 1 && Number(digits) <= ENTRY_NUMBER_MAX
        ? formatEntryLabel(book, { number: Number(digits), locationLabel: null })
        : null;
}

/** What the form starts with: the values it would post, and the text in its two searches. */
export interface NewSongDraft {
    values: NewSongValues;
    /** What the hymn picker's search holds, when no hymn is chosen. */
    hymnSearch: string;
    /** What the tune picker's search holds, when no tune is chosen. */
    tuneSearch: string;
}

/** The form with nothing chosen: a new hymn, no tune, no entry. */
export const EMPTY_NEW_SONG: NewSongDraft = {
    values: {
        hymn: "new",
        hymnId: "",
        hymnTitle: "",
        tune: "none",
        tuneId: "",
        tuneName: "",
        bookId: "",
        placement: "number",
        number: "",
        location: "",
    },
    hymnSearch: "",
    tuneSearch: "",
};

/**
 * Whether a parenthetical reads as a tune's name: hymnals print tune names
 * in capitals (SLANE, ST. ANNE), so it has a letter and no lower-case one.
 * "(Descant)" and "(A Round)" do not.
 */
function looksLikeTuneName(text: string): boolean {
    return /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);
}

/** The hymns whose title, or one of whose other titles, is `text`, by id, once each. */
function hymnsTitled(text: string, index: CatalogIndex): number[] {
    const key = normalizeTitle(text);
    const songIds = [...(index.titles.get(key) ?? []), ...(index.aliases.get(key) ?? [])];
    const hymnIds = songIds.flatMap((songId) => {
        const song = index.songs.get(songId);
        return song ? [song.hymnId] : [];
    });
    return [...new Set(hymnIds)];
}

/**
 * The form prefilled for a Planning Center song, from its title: a
 * trailing parenthetical that names a tune (`readTuneHint`) fills the tune,
 * and the title, or the title before that parenthetical, picks the hymn.
 *
 * - The hymn: the one the whole title names (by its title or another
 *   title), or else the one the title before the parenthetical names. When
 *   that is several hymns, the hymn picker starts searching for the title
 *   instead; when none, a new hymn takes the title, without a parenthetical
 *   that names a tune.
 * - The tune: the one the parenthetical names, by name or other name; when
 *   it names several, the tune picker starts searching for it. A
 *   parenthetical in capitals that names no tune in the catalog becomes a
 *   new tune's name ("(SLANE)"); anything else ("(Descant)") leaves the tune
 *   at None.
 * - No entry.
 */
export function draftFromPcoTitle(pcoTitle: string, index: CatalogIndex): NewSongDraft {
    const title = cleanText(pcoTitle);
    const hint = readTuneHint(title);
    const hintName = hint?.names.at(-1) ?? "";
    const tuneIds = [...tunesNamedBy(hint, index)];
    const namesTune = hint !== null && (tuneIds.length > 0 || looksLikeTuneName(hintName));
    const values: NewSongValues = { ...EMPTY_NEW_SONG.values };

    let hymnText = title;
    let hymnIds = hymnsTitled(title, index);
    if (hymnIds.length === 0 && hint !== null) {
        const base = cleanText(hint.base);
        const baseIds = hymnsTitled(base, index);
        if (baseIds.length > 0 || namesTune) {
            hymnText = base;
            hymnIds = baseIds;
        }
    }
    if (hymnIds.length === 0) {
        values.hymn = "new";
        values.hymnTitle = hymnText;
    } else {
        values.hymn = "existing";
        values.hymnId = hymnIds.length === 1 ? String(hymnIds[0]) : "";
    }

    if (tuneIds.length > 0) {
        values.tune = "existing";
        values.tuneId = tuneIds.length === 1 ? String(tuneIds[0]) : "";
    } else if (namesTune) {
        values.tune = "new";
        values.tuneName = cleanText(hintName);
    }

    return {
        values,
        hymnSearch: values.hymn === "existing" && values.hymnId === "" ? hymnText : "",
        tuneSearch:
            values.tune === "existing" && values.tuneId === "" ? cleanText(hintName) : "",
    };
}

// ---------------------------------------------------------------------------
// The forms that edit the catalog
// ---------------------------------------------------------------------------

/** What a form's reader made of it: the typed input, or every part's problem at once. */
export type FormCheck<T, P extends string> =
    | { ok: true; input: T }
    | { ok: false; fieldErrors: FieldErrors<P> };

/** One part's reading: its value, or the message for its error. */
type PartRead<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * A form's check from its parts' readings: the input `build` makes of their
 * values when every part read, else each failed part's message.
 */
function checkParts<R extends Record<string, PartRead<unknown>>, T>(
    parts: R,
    build: (values: { [K in keyof R]: R[K] extends PartRead<infer V> ? V : never }) => T
): FormCheck<T, keyof R & string> {
    const fieldErrors: FieldErrors<keyof R & string> = {};
    const values = {} as Record<string, unknown>;
    for (const [part, read] of Object.entries(parts) as [keyof R & string, PartRead<unknown>][]) {
        if (read.ok) {
            values[part] = read.value;
        } else {
            fieldErrors[part] = { message: read.message };
        }
    }
    return Object.keys(fieldErrors).length > 0
        ? { ok: false, fieldErrors }
        : { ok: true, input: build(values as Parameters<typeof build>[0]) };
}

/** An id from a (usually hidden) field, or `message` when it does not parse. */
function readCatalogId(formData: FormData, name: string, message: string): PartRead<number> {
    const id = readId(formData, name, parseCatalogId);
    return id === null ? { ok: false, message } : { ok: true, value: id };
}

/**
 * Optional one-line text: cleaned with `cleanText`, null when blank, and
 * refused past `max` characters with a message about `what`.
 */
function readOptionalLine(
    formData: FormData,
    name: string,
    max: number,
    what: string
): PartRead<string | null> {
    const text = cleanText(readString(formData, name));
    if (text.length > max) {
        return { ok: false, message: `${what} has at most ${formatCount(max)} characters.` };
    }
    return { ok: true, value: text === "" ? null : text };
}

// Marks ----------------------------------------------------------------------

/** The longest note on a mark. */
export const MARK_NOTE_MAX_LENGTH = 200;

/** The fields the song page's Mark and Unmark post: the song and the mark (hidden), and Mark's note. */
export const SONG_MARK_FIELDS = ["songId", "mark", "note"] as const;

/** The parts of the mark forms, each of which shows at most one error. */
export type SongMarkPart = "song" | "mark" | "note";

/** A mark to put on a song, or take off it (Unmark ignores the note). */
export interface SongMarkInput {
    songId: number;
    mark: SongMarkKind;
    /** Null when left blank. */
    note: string | null;
}

/**
 * Read the song page's Mark or Unmark form: the song's id, the mark (one
 * this build knows: "to-learn") and an optional note of at most
 * `MARK_NOTE_MAX_LENGTH` characters, cleaned with `cleanText`.
 */
export function validateSongMark(formData: FormData): FormCheck<SongMarkInput, SongMarkPart> {
    const mark = readString(formData, "mark");
    return checkParts(
        {
            song: readCatalogId(formData, "songId", "That song is not in the catalog."),
            mark: isSongMarkKind(mark)
                ? { ok: true, value: mark }
                : { ok: false, message: "That is not a mark the catalog knows." },
            note: readOptionalLine(formData, "note", MARK_NOTE_MAX_LENGTH, "A note"),
        },
        ({ song, mark, note }) => ({ songId: song, mark, note })
    );
}

// Entries ----------------------------------------------------------------------

/** The longest variant note ("Descant - last stanza only") an entry takes. */
export const VARIANT_NOTE_MAX_LENGTH = 100;

/** The highest position an entry of an unnumbered book may be given. */
export const ENTRY_POSITION_MAX = 99_999;

/**
 * Where an entry goes in its book:
 *
 * - "number" and "location": a numbered book's number (R-396), or a place
 *   without one, such as the front cover;
 * - "end" and "position": an unnumbered book's order, at its end or at a
 *   position (1 is first), which moves the entries from there on down. A
 *   position past the end is the end.
 */
export type EntryPlacement =
    | { kind: "number"; number: number }
    | { kind: "location"; locationLabel: string }
    | { kind: "end" }
    | { kind: "position"; position: number };

/** The placements the entry forms post. */
export const ENTRY_PLACEMENTS = ["number", "location", "end", "position"] as const;

/** A new entry of a song in a book. */
export interface NewEntryInput {
    songId: number;
    bookId: number;
    placement: EntryPlacement;
    /** Null for a plain entry. */
    variantNote: string | null;
}

/** An entry changed in place: in the same book, for the same song. */
export interface EntryEditInput {
    entryId: number;
    placement: EntryPlacement;
    /** Null for a plain entry. */
    variantNote: string | null;
}

/**
 * The fields the song page's entry forms post. Adding posts the song and
 * the book; editing posts the entry. Each posts the placement, the field
 * it needs (`number`, `location` or `position`) and the variant note.
 */
export const ENTRY_FIELDS = [
    "songId",
    "entryId",
    "bookId",
    /** One of `ENTRY_PLACEMENTS`. */
    "placement",
    "number",
    "location",
    "position",
    "variantNote",
] as const;

/** The parts of the entry forms, each of which shows at most one error. */
export type EntryPart = "song" | "entry" | "book" | "placement" | "variantNote";

/**
 * The placement a form posts, with the field it needs: a number of 1 to
 * `ENTRY_NUMBER_MAX`, a location of at most `LOCATION_MAX_LENGTH`
 * characters, or a position of 1 to `ENTRY_POSITION_MAX`. Whether the book
 * takes it (numbers in a numbered book, the order in one without) is for
 * the database to say: the form names an entry or a book by id only.
 */
function readEntryPlacement(formData: FormData): PartRead<EntryPlacement> {
    const placement = readString(formData, "placement");
    switch (ENTRY_PLACEMENTS.find((kind) => kind === placement)) {
        case "number": {
            const number = readOptionalPositiveInteger(formData, "number", { max: ENTRY_NUMBER_MAX });
            if (!number.ok || number.value === null) {
                return {
                    ok: false,
                    message: `Type the song's number, a whole number from 1 to ${formatCount(ENTRY_NUMBER_MAX)}.`,
                };
            }
            return { ok: true, value: { kind: "number", number: number.value } };
        }
        case "location": {
            const locationLabel = cleanText(readString(formData, "location"));
            if (locationLabel === "") {
                return { ok: false, message: "Type where the book has the song, such as front cover." };
            }
            if (locationLabel.length > LOCATION_MAX_LENGTH) {
                return {
                    ok: false,
                    message: `A location has at most ${LOCATION_MAX_LENGTH} characters.`,
                };
            }
            return { ok: true, value: { kind: "location", locationLabel } };
        }
        case "end":
            return { ok: true, value: { kind: "end" } };
        case "position": {
            const position = readOptionalPositiveInteger(formData, "position", {
                max: ENTRY_POSITION_MAX,
            });
            if (!position.ok || position.value === null) {
                return {
                    ok: false,
                    message: `Type the song's position in the book, a whole number from 1 to ${formatCount(ENTRY_POSITION_MAX)}.`,
                };
            }
            return { ok: true, value: { kind: "position", position: position.value } };
        }
        case undefined:
            return { ok: false, message: "Choose where the book has the song." };
    }
}

/** A variant note, cleaned: null when blank. */
function readVariantNote(formData: FormData): PartRead<string | null> {
    return readOptionalLine(formData, "variantNote", VARIANT_NOTE_MAX_LENGTH, "A variant note");
}

/** Read the song page's Add entry form: the song, the book, the placement and the variant note. */
export function validateNewEntry(formData: FormData): FormCheck<NewEntryInput, EntryPart> {
    return checkParts(
        {
            song: readCatalogId(formData, "songId", "That song is not in the catalog."),
            book: readCatalogId(formData, "bookId", "Choose a book from the list."),
            placement: readEntryPlacement(formData),
            variantNote: readVariantNote(formData),
        },
        ({ song, book, placement, variantNote }) => ({
            songId: song,
            bookId: book,
            placement,
            variantNote,
        })
    );
}

/** Read an entry's Edit form: the entry, its placement and its variant note. */
export function validateEntryEdit(formData: FormData): FormCheck<EntryEditInput, EntryPart> {
    return checkParts(
        {
            entry: readCatalogId(formData, "entryId", "That entry is not in the catalog."),
            placement: readEntryPlacement(formData),
            variantNote: readVariantNote(formData),
        },
        ({ entry, placement, variantNote }) => ({ entryId: entry, placement, variantNote })
    );
}

/** Read an entry's Delete form: the entry. */
export function validateEntryDelete(formData: FormData): FormCheck<{ entryId: number }, "entry"> {
    return checkParts(
        { entry: readCatalogId(formData, "entryId", "That entry is not in the catalog.") },
        ({ entry }) => ({ entryId: entry })
    );
}

/** Which way Move up and Move down take an entry, or a book. */
export const MOVE_DIRECTIONS = ["up", "down"] as const;

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/** A direction a form posted, or the message for one it did not. */
function readDirection(formData: FormData): PartRead<MoveDirection> {
    const direction = readString(formData, "direction");
    const known = MOVE_DIRECTIONS.find((value) => value === direction);
    return known === undefined
        ? { ok: false, message: "Choose Move up or Move down." }
        : { ok: true, value: known };
}

/** Read an entry's Move up or Move down form (an unnumbered book's): the entry and the direction. */
export function validateEntryMove(
    formData: FormData
): FormCheck<{ entryId: number; direction: MoveDirection }, "entry" | "direction"> {
    return checkParts(
        {
            entry: readCatalogId(formData, "entryId", "That entry is not in the catalog."),
            direction: readDirection(formData),
        },
        ({ entry, direction }) => ({ entryId: entry, direction })
    );
}

// Hymns, tunes and their other names --------------------------------------------

/** The longest first line a hymn takes. */
export const FIRST_LINE_MAX_LENGTH = 200;

/** The longest meter ("8.7.8.7.D", "C.M.") a tune takes. */
export const METER_MAX_LENGTH = 50;

/** The longest notes a hymn or tune takes. */
export const NOTES_MAX_LENGTH = 2_000;

/**
 * Optional notes, which may run over several lines: line breaks made "\n",
 * spaces at the ends of each line and blank lines at either end dropped,
 * null when nothing is left, and refused past `NOTES_MAX_LENGTH` characters.
 */
function readNotes(formData: FormData, name: string): PartRead<string | null> {
    const text = readString(formData, name)
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .trim();
    if (text.length > NOTES_MAX_LENGTH) {
        return { ok: false, message: `Notes have at most ${formatCount(NOTES_MAX_LENGTH)} characters.` };
    }
    return { ok: true, value: text === "" ? null : text };
}

/** A hymn's title as typed: cleaned, and refused when blank, too long or without letters or digits. */
function readTitle(formData: FormData, name: string, blank: string): PartRead<string> {
    const title = cleanText(readString(formData, name));
    if (title === "") {
        return { ok: false, message: blank };
    }
    if (title.length > TITLE_MAX_LENGTH) {
        return { ok: false, message: `A title has at most ${TITLE_MAX_LENGTH} characters.` };
    }
    if (normalizeTitle(title) === "") {
        return { ok: false, message: "A title needs letters or numbers." };
    }
    return { ok: true, value: title };
}

/** A tune's name as typed: cleaned, and refused when blank or too long. */
function readTuneName(formData: FormData, name: string, blank: string): PartRead<string> {
    const text = cleanText(readString(formData, name));
    if (text === "") {
        return { ok: false, message: blank };
    }
    if (text.length > TUNE_NAME_MAX_LENGTH) {
        return {
            ok: false,
            message: `A tune's name has at most ${TUNE_NAME_MAX_LENGTH} characters.`,
        };
    }
    return { ok: true, value: text };
}

/** A hymn's title, first line and notes, as its Edit form gives them. */
export interface HymnEditInput {
    hymnId: number;
    title: string;
    firstLine: string | null;
    notes: string | null;
}

/** The fields the song page's hymn Edit form posts. */
export const HYMN_FIELDS = ["hymnId", "title", "firstLine", "notes"] as const;

/** The parts of the hymn Edit form, each of which shows at most one error. */
export type HymnPart = "hymn" | "title" | "firstLine" | "notes";

/** Read the hymn Edit form: the hymn, its title, its first line and its notes. */
export function validateHymnEdit(formData: FormData): FormCheck<HymnEditInput, HymnPart> {
    return checkParts(
        {
            hymn: readCatalogId(formData, "hymnId", "That hymn is not in the catalog."),
            title: readTitle(formData, "title", "Type the hymn's title."),
            firstLine: readOptionalLine(formData, "firstLine", FIRST_LINE_MAX_LENGTH, "A first line"),
            notes: readNotes(formData, "notes"),
        },
        ({ hymn, title, firstLine, notes }) => ({ hymnId: hymn, title, firstLine, notes })
    );
}

/** A tune's name, meter and notes, as its Edit form gives them. */
export interface TuneEditInput {
    tuneId: number;
    name: string;
    meter: string | null;
    notes: string | null;
}

/** The fields the tune page's Edit form posts. */
export const TUNE_FIELDS = ["tuneId", "name", "meter", "notes"] as const;

/** The parts of the tune Edit form, each of which shows at most one error. */
export type TunePart = "tune" | "name" | "meter" | "notes";

/** Read the tune Edit form: the tune, its name, its meter and its notes. */
export function validateTuneEdit(formData: FormData): FormCheck<TuneEditInput, TunePart> {
    return checkParts(
        {
            tune: readCatalogId(formData, "tuneId", "That tune is not in the catalog."),
            name: readTuneName(formData, "name", "Type the tune's name."),
            meter: readOptionalLine(formData, "meter", METER_MAX_LENGTH, "A meter"),
            notes: readNotes(formData, "notes"),
        },
        ({ tune, name, meter, notes }) => ({ tuneId: tune, name, meter, notes })
    );
}

/** The fields a hymn's Add and Remove other title forms post. */
export const HYMN_ALIAS_FIELDS = ["hymnId", "alias"] as const;

/** The fields a tune's Add and Remove other name forms post. */
export const TUNE_ALIAS_FIELDS = ["tuneId", "alias"] as const;

/** Another title of a hymn, to add or remove. */
export interface HymnAliasInput {
    hymnId: number;
    alias: string;
}

/** Another name of a tune, to add or remove. */
export interface TuneAliasInput {
    tuneId: number;
    alias: string;
}

/** Read a hymn's Add (or Remove) other title form: the hymn, and the title, as `validateHymnEdit` reads one. */
export function validateHymnAlias(formData: FormData): FormCheck<HymnAliasInput, "hymn" | "alias"> {
    return checkParts(
        {
            hymn: readCatalogId(formData, "hymnId", "That hymn is not in the catalog."),
            alias: readTitle(formData, "alias", "Type the other title."),
        },
        ({ hymn, alias }) => ({ hymnId: hymn, alias })
    );
}

/** Read a tune's Add (or Remove) other name form: the tune, and the name, as `validateTuneEdit` reads one. */
export function validateTuneAlias(formData: FormData): FormCheck<TuneAliasInput, "tune" | "alias"> {
    return checkParts(
        {
            tune: readCatalogId(formData, "tuneId", "That tune is not in the catalog."),
            alias: readTuneName(formData, "alias", "Type the other name."),
        },
        ({ tune, alias }) => ({ tuneId: tune, alias })
    );
}

// Merges -----------------------------------------------------------------------

/**
 * The fields a merge form posts: the hymn (or tune) to merge, from the page
 * it is on, and the one to merge it into, chosen from a picker. Both
 * Preview and Merge post them.
 */
export const MERGE_FIELDS = ["sourceId", "targetId"] as const;

/** The parts of a merge form, each of which shows at most one error. */
export type MergePart = "source" | "target";

/** Two hymns, or two tunes, to merge: the source into the target. */
export interface MergeInput {
    sourceId: number;
    targetId: number;
}

/**
 * Read a merge form of `kind` ("hymn" or "tune"): the source's id and the
 * target's. Merging one into itself is for the merge to refuse, with the
 * rest of its plan.
 */
export function validateMerge(formData: FormData, kind: "hymn" | "tune"): FormCheck<MergeInput, MergePart> {
    return checkParts(
        {
            source: readCatalogId(formData, "sourceId", `That ${kind} is not in the catalog.`),
            target: readCatalogId(formData, "targetId", `Choose the ${kind} to merge it into.`),
        },
        ({ source, target }) => ({ sourceId: source, targetId: target })
    );
}

// Books ------------------------------------------------------------------------

/** The longest name a book takes ("Great Hymns of the Faith"). */
export const BOOK_NAME_MAX_LENGTH = 100;

/** The longest short name ("Great Hymns") or label format ("R-{n}") a book takes. */
export const BOOK_LABEL_MAX_LENGTH = 40;

/** What a yes-or-no field of the book forms posts. */
export const BOOK_YES = "yes";
export const BOOK_NO = "no";

/**
 * A book's label format when none is given: `CODE-{n}` for a numbered book
 * ("CB-{n}"), and its short name for one without numbers, whose entries are
 * all labelled alike ("Chorus Book").
 */
export function defaultLabelFormat(code: string, numbered: boolean, shortName: string): string {
    return numbered ? `${code}-${NUMBER_PLACEHOLDER}` : shortName;
}

/**
 * What is wrong with a label format for a book that is, or is not,
 * numbered, or null when nothing is: a numbered book's must say where the
 * number goes (`{n}`), and an unnumbered book's must not.
 */
export function labelFormatProblem(labelFormat: string, numbered: boolean): string | null {
    const placeholder = labelFormat.includes(NUMBER_PLACEHOLDER);
    if (numbered && !placeholder) {
        return `A numbered book's label needs ${NUMBER_PLACEHOLDER} where the number goes, such as R-${NUMBER_PLACEHOLDER}.`;
    }
    if (!numbered && placeholder) {
        return `A book without numbers labels every entry alike, so its label has no ${NUMBER_PLACEHOLDER}: its short name, such as Chorus Book.`;
    }
    return null;
}

/** A new book, as the Add book form describes it, with the defaults filled in. */
export interface NewBookInput {
    /** As `parseBookCode` accepts it: a letter, then up to 7 letters, digits, "_" or "-". */
    code: string;
    name: string;
    shortName: string;
    numbered: boolean;
    labelFormat: string;
}

/** A book's name, short name, label format and whether it is active, as its Edit form gives them. */
export interface BookEditInput {
    bookId: number;
    name: string;
    /** Null when left blank: the book's name. */
    shortName: string | null;
    /** Null when left blank: the book's default (`defaultLabelFormat`). */
    labelFormat: string | null;
    active: boolean;
}

/** The fields the Add book form posts. */
export const NEW_BOOK_FIELDS = ["code", "name", "shortName", "numbered", "labelFormat"] as const;

/** The fields a book's Edit form posts. */
export const BOOK_FIELDS = ["bookId", "name", "shortName", "labelFormat", "active"] as const;

/** The parts of the book forms, each of which shows at most one error. */
export type BookPart = "book" | "code" | "name" | "shortName" | "numbered" | "labelFormat" | "active";

/** A yes-or-no field: "yes" or "no", or `message` for anything else. */
function readYesNo(formData: FormData, name: string, message: string): PartRead<boolean> {
    const value = readString(formData, name);
    if (value === BOOK_YES || value === BOOK_NO) {
        return { ok: true, value: value === BOOK_YES };
    }
    return { ok: false, message };
}

/** A required one-line text field: cleaned, and refused when blank or past `max` characters. */
function readLine(formData: FormData, name: string, max: number, blank: string, what: string): PartRead<string> {
    const text = cleanText(readString(formData, name));
    if (text === "") {
        return { ok: false, message: blank };
    }
    if (text.length > max) {
        return { ok: false, message: `${what} has at most ${formatCount(max)} characters.` };
    }
    return { ok: true, value: text };
}

/**
 * Read the Add book form: a code `parseBookCode` accepts (unique without
 * regard to case: the database says whether it is taken), a name, a short
 * name (the name when left blank), numbered or not, and a label format
 * (`defaultLabelFormat` when left blank) that suits it (`labelFormatProblem`).
 */
export function validateNewBook(formData: FormData): FormCheck<NewBookInput, BookPart> {
    const code = parseBookCode(readString(formData, "code"));
    const name = readLine(formData, "name", BOOK_NAME_MAX_LENGTH, "Type the book's name.", "A book's name");
    const shortName = readOptionalLine(formData, "shortName", BOOK_LABEL_MAX_LENGTH, "A short name");
    const numbered = readYesNo(formData, "numbered", "Choose whether the book numbers its songs.");
    const labelFormat = readOptionalLine(formData, "labelFormat", BOOK_LABEL_MAX_LENGTH, "A label");
    const problem =
        labelFormat.ok && labelFormat.value !== null && numbered.ok
            ? labelFormatProblem(labelFormat.value, numbered.value)
            : null;
    return checkParts(
        {
            code:
                code === null
                    ? {
                          ok: false,
                          message:
                              "A code is a letter, then up to 7 letters, digits, - or _, such as CB.",
                      }
                    : { ok: true, value: code },
            name,
            shortName,
            numbered,
            labelFormat: problem === null ? labelFormat : { ok: false, message: problem },
        },
        ({ code, name, shortName, numbered, labelFormat }) => {
            const short = shortName ?? name;
            return {
                code,
                name,
                shortName: short,
                numbered,
                labelFormat: labelFormat ?? defaultLabelFormat(code, numbered, short),
            };
        }
    );
}

/**
 * Read a book's Edit form: the book, its name, its short name and label
 * format (each null when left blank, for the defaults), and whether it is
 * active. Whether the label format suits the book is for the database to
 * say: the form names the book by id only.
 */
export function validateBookEdit(formData: FormData): FormCheck<BookEditInput, BookPart> {
    return checkParts(
        {
            book: readCatalogId(formData, "bookId", "That book is not in the catalog."),
            name: readLine(formData, "name", BOOK_NAME_MAX_LENGTH, "Type the book's name.", "A book's name"),
            shortName: readOptionalLine(formData, "shortName", BOOK_LABEL_MAX_LENGTH, "A short name"),
            labelFormat: readOptionalLine(formData, "labelFormat", BOOK_LABEL_MAX_LENGTH, "A label"),
            active: readYesNo(formData, "active", "Choose whether the book is in use."),
        },
        ({ book, name, shortName, labelFormat, active }) => ({
            bookId: book,
            name,
            shortName,
            labelFormat,
            active,
        })
    );
}

/** Read a book's Move up or Move down form: the book and the direction. */
export function validateBookMove(
    formData: FormData
): FormCheck<{ bookId: number; direction: MoveDirection }, "book" | "direction"> {
    return checkParts(
        {
            book: readCatalogId(formData, "bookId", "That book is not in the catalog."),
            direction: readDirection(formData),
        },
        ({ book, direction }) => ({ bookId: book, direction })
    );
}

// A book's CSV file -------------------------------------------------------------

/** The largest CSV file a book import takes: 1 MB, ample for a hymnal of thousands of songs. */
export const BOOK_CSV_MAX_BYTES = 1024 * 1024;

/** The longest file name an import run keeps. */
export const SOURCE_NAME_MAX_LENGTH = 200;

/** The fields the Import a book from CSV form posts: the book, and the file. */
export const BOOK_CSV_FIELDS = ["bookId", "file"] as const;

/** The parts of the CSV upload form, each of which shows at most one error. */
export type BookCsvPart = "book" | "file";

/** A CSV file to preview for a book, as the form posts it. */
export interface BookCsvUploadInput {
    bookId: number;
    /** The file as the browser sent it; the action reads its text. */
    file: File;
    /** Its name, cleaned and shortened, or "upload.csv" for none. */
    sourceName: string;
}

/** A file's name as an import run keeps it: cleaned, at most `SOURCE_NAME_MAX_LENGTH` characters, "upload.csv" for none. */
export function cleanSourceName(name: string): string {
    return cleanText(name).slice(0, SOURCE_NAME_MAX_LENGTH) || "upload.csv";
}

/**
 * Read the Import a book from CSV form: the book's id, and a file that is
 * not empty and at most `BOOK_CSV_MAX_BYTES` long. Whether its text is CSV
 * that fits the book is for the preview's report to say.
 */
export function validateBookCsvUpload(formData: FormData): FormCheck<BookCsvUploadInput, BookCsvPart> {
    const file = formData.get("file");
    let read: PartRead<File>;
    if (!(file instanceof File) || (file.size === 0 && file.name === "")) {
        read = { ok: false, message: "Choose a CSV file." };
    } else if (file.size === 0) {
        read = { ok: false, message: `${cleanSourceName(file.name)} is empty.` };
    } else if (file.size > BOOK_CSV_MAX_BYTES) {
        read = { ok: false, message: "The file is larger than 1 MB. A book's CSV file is much smaller: is it the right file?" };
    } else {
        read = { ok: true, value: file };
    }
    return checkParts(
        {
            book: readCatalogId(formData, "bookId", "Choose the book to import into."),
            file: read,
        },
        ({ book, file }) => ({ bookId: book, file, sourceName: cleanSourceName(file.name) })
    );
}
