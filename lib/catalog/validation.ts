import type { Book } from "@/lib/domain";
import {
    readId,
    readOptionalPositiveInteger,
    readString,
    type FieldErrors,
} from "@/lib/forms";
import { normalizeTitle } from "@/lib/normalizeTitle";
import { readTuneHint, tunesNamedBy, type CatalogIndex } from "@/lib/reconcile";
import { formatCount } from "./counts";
import { parseCatalogId } from "./ids";
import { formatEntryLabel } from "./labels";

/**
 * The new-song form (`/catalog/songs/new`): its fields, what it starts with
 * (prefilled from a Planning Center song's title), and the checks on what it
 * posts that need no database. Pure and safe on both sides; the checks that
 * need the catalog (a title or name already taken, a song or number that
 * exists) are in `lib/db/catalogWrites.ts`.
 *
 * A song is one hymn to one tune. The form chooses the hymn (one in the
 * catalog, or a new title), the tune (one in the catalog, a new name, or
 * none) and, optionally, the song's first entry in a book.
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
