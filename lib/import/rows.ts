/**
 * The rows an import plans to add to the catalog: what a preview stores in
 * `import_runs.rows` and applying it inserts, so apply writes exactly what
 * was previewed. Rows refer to each other by key, not by id (ids exist only
 * once apply inserts them): a hymn by its `normalizeTitle` key, a tune by its
 * `normalizeTuneName` key, a song by its hymn and tune keys, a book by code.
 * Pure and safe on both sides.
 */

/** A book to create. */
export interface PlannedBook {
    code: string;
    name: string;
    shortName: string;
    numbered: boolean;
    labelFormat: string;
    sortOrder: number;
}

/** Another spelling of a hymn or tune, with the form it is matched by. */
export interface PlannedAlias {
    alias: string;
    normalized: string;
}

/** A hymn to create, known by `key` (its title's `normalizeTitle` form). */
export interface PlannedHymn {
    key: string;
    title: string;
    aliases: PlannedAlias[];
}

/** A tune to create, known by `key` (its name's `normalizeTuneName` form). */
export interface PlannedTune {
    key: string;
    name: string;
    aliases: PlannedAlias[];
}

/** A song to create: a hymn to a tune, or to no known tune (`tuneKey` null). */
export interface PlannedSong {
    hymnKey: string;
    tuneKey: string | null;
}

/** An entry to create, for the song of `hymnKey` and `tuneKey`, in the book of `bookCode`. */
export interface PlannedEntry {
    bookCode: string;
    hymnKey: string;
    tuneKey: string | null;
    number: number | null;
    position: number | null;
    locationLabel: string | null;
    variantNote: string | null;
}

/** Everything an import adds, in the order apply inserts it. */
export interface PlannedCatalogRows {
    books: PlannedBook[];
    hymns: PlannedHymn[];
    tunes: PlannedTune[];
    songs: PlannedSong[];
    entries: PlannedEntry[];
}

/** Thrown by `parsePlannedRows` for stored rows of the wrong shape. */
export class InvalidPlannedRowsError extends Error {
    constructor(path: string) {
        super(`The planned rows are not valid at ${path}`);
        this.name = "InvalidPlannedRowsError";
    }
}

type Check<T> = (value: unknown, path: string) => T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function checked<T>(ok: (value: unknown) => boolean): Check<T> {
    return (value, path) => {
        if (!ok(value)) {
            throw new InvalidPlannedRowsError(path);
        }
        return value as T;
    };
}

const text = checked<string>((value) => typeof value === "string");
const nullableText = checked<string | null>(
    (value) => value === null || typeof value === "string"
);
const integer = checked<number>((value) => Number.isSafeInteger(value));
const nullableInteger = checked<number | null>(
    (value) => value === null || Number.isSafeInteger(value)
);
const boolean = checked<boolean>((value) => typeof value === "boolean");

function list<T>(item: Check<T>): Check<T[]> {
    return (value, path) => {
        if (!Array.isArray(value)) {
            throw new InvalidPlannedRowsError(path);
        }
        return value.map((element, index) => item(element, `${path}[${index}]`));
    };
}

/** A check of an object with exactly these fields, each checked. */
function shape<T>(fields: { [K in keyof T]: Check<T[K]> }): Check<T> {
    return (value, path) => {
        if (!isRecord(value)) {
            throw new InvalidPlannedRowsError(path);
        }
        const result = {} as T;
        for (const key of Object.keys(fields) as (keyof T & string)[]) {
            result[key] = fields[key](value[key], `${path}.${key}`);
        }
        return result;
    };
}

const alias = shape<PlannedAlias>({ alias: text, normalized: text });

const plannedRows = shape<PlannedCatalogRows>({
    books: list(
        shape<PlannedBook>({
            code: text,
            name: text,
            shortName: text,
            numbered: boolean,
            labelFormat: text,
            sortOrder: integer,
        })
    ),
    hymns: list(shape<PlannedHymn>({ key: text, title: text, aliases: list(alias) })),
    tunes: list(shape<PlannedTune>({ key: text, name: text, aliases: list(alias) })),
    songs: list(shape<PlannedSong>({ hymnKey: text, tuneKey: nullableText })),
    entries: list(
        shape<PlannedEntry>({
            bookCode: text,
            hymnKey: text,
            tuneKey: nullableText,
            number: nullableInteger,
            position: nullableInteger,
            locationLabel: nullableText,
            variantNote: nullableText,
        })
    ),
});

/**
 * Check that a value (parsed from `import_runs.rows`) has the shape of
 * `PlannedCatalogRows`, and return it with only the known fields. Throws
 * `InvalidPlannedRowsError`, naming the first bad path, otherwise. It checks
 * the shape only: whether the keys refer to each other is apply's concern.
 */
export function parsePlannedRows(value: unknown): PlannedCatalogRows {
    return plannedRows(value, "rows");
}
