import { describe, expect, test } from "vitest";
import { hymnCatalog } from "@/lib/hymnCatalog";
import { buildHymnIndex, matchHymns } from "./hymnMatch";
import type { RawHymn } from "./unusedHymns";

// Characterization tests: they pin what /api/hymns does today, quirks included.
// Tests prefixed "quirk (pinned)" record behavior that a later commit changes on
// purpose (a normalized hymn lookup); flip their assertions in that commit.
//
// Examples are found in the real catalog instead of being hard-coded, so these
// keep working when hymns.json is edited.

const index = buildHymnIndex(hymnCatalog);

/** Fails loudly (instead of silently skipping a case) when the catalog has no example. */
function required<T>(value: T | undefined, what: string): T {
    if (value === undefined) {
        throw new Error(`hymns.json has no ${what}; this test needs an example`);
    }
    return value;
}

/** Catalog records whose title equals `title` ignoring case, in catalog order. */
function recordsFor(title: string): RawHymn[] {
    return hymnCatalog.filter(
        (hymn) => hymn.song_title.toLowerCase() === title.toLowerCase()
    );
}

const hasMissingBook = (hymn: RawHymn): boolean =>
    hymn.rejoice_hymns === -1 || hymn.great_hymns_of_the_faith === -1;

/** Every distinct catalog title (exact casing), in catalog order. */
const catalogTitles = [...new Set(hymnCatalog.map((hymn) => hymn.song_title))];

const singleTuneTitle = required(
    catalogTitles.find((title) => recordsFor(title).length === 1),
    "title with exactly one record"
);
const multiTuneTitles = catalogTitles.filter(
    (title) => recordsFor(title).length > 1
);
const multiTuneTitle = required(
    multiTuneTitles.find((title) => recordsFor(title).some(hasMissingBook)),
    "multi-tune title with a missing book number"
);

const UNKNOWN_TITLE = "Definitely Not A Hymn Title 12345";

const trailingPunctuation = /[.,!?;:]+$/;
const withoutTrailingPunctuation = (title: string): string =>
    title.replace(trailingPunctuation, "");

// U+2018 / U+2019 curly single quotes and U+201C / U+201D curly double quotes.
const curlyQuote = /[‘’“”]/;
const toStraightQuotes = (title: string): string =>
    title.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const toCurlyApostrophe = (title: string): string =>
    title.replace(/'/g, "’");

describe("real catalog examples", () => {
    test("the catalog has the shapes the other tests rely on", () => {
        expect(hymnCatalog.length).toBeGreaterThan(0);
        expect(recordsFor(singleTuneTitle)).toHaveLength(1);
        expect(recordsFor(multiTuneTitle).length).toBeGreaterThan(1);
        expect(recordsFor(UNKNOWN_TITLE)).toEqual([]);
    });
});

describe("buildHymnIndex", () => {
    test("groups the real catalog by lowercased title, keeping catalog order", () => {
        const lowerCaseTitles = new Set(
            hymnCatalog.map((hymn) => hymn.song_title.toLowerCase())
        );
        expect(index.size).toBe(lowerCaseTitles.size);

        let indexed = 0;
        for (const [key, group] of index) {
            expect(key).toBe(key.toLowerCase());
            expect(group).toEqual(
                hymnCatalog.filter(
                    (hymn) => hymn.song_title.toLowerCase() === key
                )
            );
            indexed += group.length;
        }
        // Every catalog record lands in exactly one group.
        expect(indexed).toBe(hymnCatalog.length);
    });

    test("merges records whose titles differ only by case (synthetic: the real catalog has none)", () => {
        const first: RawHymn = {
            song_title: "Amazing Grace",
            tune_name: "NEW BRITAIN",
            rejoice_hymns: 1,
            great_hymns_of_the_faith: -1,
        };
        const second: RawHymn = {
            song_title: "AMAZING GRACE",
            tune_name: "ARLINGTON",
            rejoice_hymns: 2,
            great_hymns_of_the_faith: -1,
        };
        const result = buildHymnIndex([first, second]);
        expect([...result.keys()]).toEqual(["amazing grace"]);
        expect(result.get("amazing grace")).toEqual([first, second]);
    });

    test("an empty catalog gives an empty index", () => {
        expect(buildHymnIndex([]).size).toBe(0);
    });
});

describe("matchHymns", () => {
    describe("request handling", () => {
        test.each([
            undefined,
            null,
            "Amazing Grace",
            42,
            {},
            { 0: "Amazing Grace", length: 1 },
        ])("returns [] when titles is not an array (%o)", (titles) => {
            expect(matchHymns(index, titles)).toEqual([]);
        });

        test("returns [] for an empty array", () => {
            expect(matchHymns(index, [])).toEqual([]);
        });

        test("drops titles that are not in the catalog", () => {
            expect(matchHymns(index, [UNKNOWN_TITLE])).toEqual([]);
        });

        test("keeps matches, in request order, around dropped titles", () => {
            const other = required(
                catalogTitles.find((title) => title !== singleTuneTitle),
                "second title"
            );
            const result = matchHymns(index, [
                UNKNOWN_TITLE,
                other,
                "also not a hymn",
                singleTuneTitle,
            ]);
            expect(result.map((entry) => entry.song_title)).toEqual([
                other,
                singleTuneTitle,
            ]);
        });

        test("every exact catalog title finds all of its own records", () => {
            const results = matchHymns(index, catalogTitles);
            expect(results).toHaveLength(catalogTitles.length);
            results.forEach((result, i) => {
                expect(result.song_title).toBe(catalogTitles[i]);
                expect(result.versions).toHaveLength(
                    recordsFor(catalogTitles[i]).length
                );
            });
        });

        test("duplicate titles in the request produce duplicate entries", () => {
            const result = matchHymns(index, [
                singleTuneTitle,
                singleTuneTitle,
            ]);
            expect(result).toHaveLength(2);
            expect(result[1]).toEqual(result[0]);
        });

        test("titles that differ only by case are separate entries, each echoing its own request", () => {
            const lower = singleTuneTitle.toLowerCase();
            const result = matchHymns(index, [singleTuneTitle, lower]);
            expect(result.map((entry) => entry.song_title)).toEqual([
                singleTuneTitle,
                lower,
            ]);
            expect(result[1].versions).toEqual(result[0].versions);
        });

        test("a non-string entry throws a TypeError (the route's try/catch turns it into a 500)", () => {
            expect(() => matchHymns(index, [singleTuneTitle, 42])).toThrow(
                TypeError
            );
            expect(() => matchHymns(index, [null])).toThrow(TypeError);
        });
    });

    describe("title matching", () => {
        test("is case-insensitive and echoes the requested title as song_title", () => {
            const [record] = recordsFor(singleTuneTitle);
            const lower = singleTuneTitle.toLowerCase();
            expect(matchHymns(index, [lower])).toEqual([
                {
                    song_title: lower,
                    versions: [
                        {
                            id: `${record.song_title}-0`,
                            tune_name: record.tune_name,
                            rejoice_hymns_number: String(record.rejoice_hymns),
                            great_hymns_number: String(
                                record.great_hymns_of_the_faith
                            ),
                            selected: true,
                        },
                    ],
                },
            ]);

            const swappedCase = [...singleTuneTitle]
                .map((ch) =>
                    ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()
                )
                .join("");
            for (const variant of [singleTuneTitle.toUpperCase(), swappedCase]) {
                const [entry] = matchHymns(index, [variant]);
                expect(entry.song_title).toBe(variant);
                // Ids always use the catalog's own casing, never the request's.
                expect(entry.versions[0].id).toBe(`${record.song_title}-0`);
            }
        });

        test("is exact otherwise: a prefix or a longer title does not match", () => {
            const prefix = singleTuneTitle.slice(0, -1);
            const longer = `${singleTuneTitle} Medley`;
            expect(recordsFor(prefix)).toEqual([]);
            expect(recordsFor(longer)).toEqual([]);
            expect(matchHymns(index, [prefix])).toEqual([]);
            expect(matchHymns(index, [longer])).toEqual([]);
        });
    });

    describe("versions", () => {
        test("a title with several catalog records keeps catalog order, generated ids and string numbers", () => {
            const records = recordsFor(multiTuneTitle);
            const [entry] = matchHymns(index, [multiTuneTitle]);

            expect(entry.song_title).toBe(multiTuneTitle);
            expect(entry.versions).toEqual(
                records.map((record, i) => ({
                    id: `${record.song_title}-${i}`,
                    tune_name: record.tune_name,
                    rejoice_hymns_number: String(record.rejoice_hymns),
                    great_hymns_number: String(record.great_hymns_of_the_faith),
                    selected: false,
                }))
            );
            // The example really exercises a missing book: "-1" as a string.
            expect(
                entry.versions.some(
                    (version) =>
                        version.rejoice_hymns_number === "-1" ||
                        version.great_hymns_number === "-1"
                )
            ).toBe(true);
            for (const version of entry.versions) {
                expect(typeof version.rejoice_hymns_number).toBe("string");
                expect(typeof version.great_hymns_number).toBe("string");
            }
        });

        test("every multi-tune title in the catalog keeps catalog order with sequential ids", () => {
            expect(multiTuneTitles.length).toBeGreaterThan(0);
            for (const title of multiTuneTitles) {
                const records = recordsFor(title);
                const [entry] = matchHymns(index, [title]);
                expect(entry.versions.map((version) => version.tune_name)).toEqual(
                    records.map((record) => record.tune_name)
                );
                expect(entry.versions.map((version) => version.id)).toEqual(
                    records.map((record, i) => `${record.song_title}-${i}`)
                );
            }
        });

        test("output shape, with literal values (synthetic catalog)", () => {
            const catalog: RawHymn[] = [
                {
                    song_title: "Test Hymn",
                    tune_name: "TUNE ONE",
                    rejoice_hymns: 42,
                    great_hymns_of_the_faith: -1,
                },
                {
                    song_title: "Test Hymn",
                    tune_name: "TUNE TWO",
                    rejoice_hymns: -1,
                    great_hymns_of_the_faith: 305,
                },
                {
                    song_title: "Solo Hymn",
                    tune_name: "",
                    rejoice_hymns: 7,
                    great_hymns_of_the_faith: 8,
                },
            ];
            expect(
                matchHymns(buildHymnIndex(catalog), [
                    "test hymn",
                    "Solo Hymn",
                    "Missing Hymn",
                ])
            ).toStrictEqual([
                {
                    song_title: "test hymn",
                    versions: [
                        {
                            id: "Test Hymn-0",
                            tune_name: "TUNE ONE",
                            rejoice_hymns_number: "42",
                            great_hymns_number: "-1",
                            selected: false,
                        },
                        {
                            id: "Test Hymn-1",
                            tune_name: "TUNE TWO",
                            rejoice_hymns_number: "-1",
                            great_hymns_number: "305",
                            selected: false,
                        },
                    ],
                },
                {
                    song_title: "Solo Hymn",
                    versions: [
                        {
                            id: "Solo Hymn-0",
                            tune_name: "",
                            rejoice_hymns_number: "7",
                            great_hymns_number: "8",
                            selected: true,
                        },
                    ],
                },
            ]);
        });
    });

    describe("selected", () => {
        test("is true when a title has exactly one version", () => {
            const [entry] = matchHymns(index, [singleTuneTitle]);
            expect(entry.versions).toHaveLength(1);
            expect(entry.versions[0].selected).toBe(true);
        });

        test("is false on every version of a multi-tune title", () => {
            const [entry] = matchHymns(index, [multiTuneTitle]);
            expect(entry.versions.length).toBeGreaterThan(1);
            expect(entry.versions.every((version) => !version.selected)).toBe(
                true
            );
        });

        test("is true only for single-version titles, across the whole catalog", () => {
            for (const entry of matchHymns(index, catalogTitles)) {
                for (const version of entry.versions) {
                    expect(version.selected).toBe(entry.versions.length === 1);
                }
            }
        });
    });

    describe("known non-matches", () => {
        test.each(["!", "?"])(
            'quirk (pinned): a catalog title ending in "%s" does not match when queried without it',
            (mark) => {
                // Skip titles whose unpunctuated form is a different catalog title.
                const titles = catalogTitles.filter(
                    (title) =>
                        title.endsWith(mark) &&
                        recordsFor(withoutTrailingPunctuation(title)).length ===
                            0
                );
                expect(titles.length).toBeGreaterThan(0);
                for (const title of titles) {
                    // Control: the exact title is found...
                    expect(matchHymns(index, [title])).toHaveLength(1);
                    // ...but the same title without its punctuation is not.
                    expect(
                        matchHymns(index, [withoutTrailingPunctuation(title)])
                    ).toEqual([]);
                }
            }
        );

        test("quirk (pinned): a title and its trailing-punctuation sibling stay separate lookups, never merged", () => {
            // E.g. "X!" and "X" are two catalog titles; each finds only its own record.
            const punctuated = catalogTitles.filter(
                (title) =>
                    trailingPunctuation.test(title) &&
                    recordsFor(withoutTrailingPunctuation(title)).length > 0
            );
            expect(punctuated.length).toBeGreaterThan(0);
            for (const title of punctuated) {
                const bare = withoutTrailingPunctuation(title);
                const [withMark] = matchHymns(index, [title]);
                const [withoutMark] = matchHymns(index, [bare]);
                expect(withMark.versions).toHaveLength(recordsFor(title).length);
                expect(withoutMark.versions).toHaveLength(
                    recordsFor(bare).length
                );
                expect(withMark.versions.map((v) => v.id)).not.toEqual(
                    withoutMark.versions.map((v) => v.id)
                );
            }
        });

        test("quirk (pinned): a catalog title with a curly apostrophe or quote does not match when queried with straight quotes", () => {
            const titles = catalogTitles.filter(
                (title) =>
                    curlyQuote.test(title) &&
                    recordsFor(toStraightQuotes(title)).length === 0
            );
            expect(titles.length).toBeGreaterThan(0);
            for (const title of titles) {
                // Control: the exact (curly) title is found...
                expect(matchHymns(index, [title])).toHaveLength(1);
                // ...but the straight-quoted spelling is not.
                expect(matchHymns(index, [toStraightQuotes(title)])).toEqual(
                    []
                );
            }
        });

        test("quirk (pinned): a catalog title with a straight apostrophe does not match when queried with a curly one", () => {
            const titles = catalogTitles.filter(
                (title) =>
                    title.includes("'") &&
                    recordsFor(toCurlyApostrophe(title)).length === 0
            );
            expect(titles.length).toBeGreaterThan(0);
            for (const title of titles) {
                expect(matchHymns(index, [title])).toHaveLength(1);
                expect(matchHymns(index, [toCurlyApostrophe(title)])).toEqual(
                    []
                );
            }
        });

        test("quirk (pinned): a title with a trailing space does not match", () => {
            // Control: the same title without the space is found.
            expect(matchHymns(index, [singleTuneTitle])).toHaveLength(1);
            expect(matchHymns(index, [`${singleTuneTitle} `])).toEqual([]);
            // Leading whitespace is not trimmed either.
            expect(matchHymns(index, [` ${singleTuneTitle}`])).toEqual([]);
        });
    });
});
