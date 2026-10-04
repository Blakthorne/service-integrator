import { describe, expect, test } from "vitest";
import { hymnCatalog } from "@/lib/hymnCatalog";
import { buildHymnIndex, matchHymns } from "./hymnMatch";
import { normalizeTitle } from "./normalizeTitle";
import type { RawHymn } from "./unusedHymns";

// Characterization tests for the hymn lookup (first behind an API route, now
// called by getPlanDetail). They began by pinning its exact, lowercase-only
// lookup; the normalized lookup fix flipped those quirks into the "normalized
// matching" tests below.
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

/** Catalog records whose normalized title matches `title`'s, in catalog order. */
function recordsForNormalized(title: string): RawHymn[] {
    return hymnCatalog.filter(
        (hymn) => normalizeTitle(hymn.song_title) === normalizeTitle(title)
    );
}

/**
 * The version ids matchHymns should list for `title`: records equal to it
 * ignoring case first, then the other records of its normalized group, each
 * in catalog order.
 */
function expectedIds(title: string): string[] {
    const group = recordsForNormalized(title);
    const isExact = (hymn: RawHymn) =>
        hymn.song_title.toLowerCase() === title.toLowerCase();
    return [...group.filter(isExact), ...group.filter((hymn) => !isExact(hymn))].map(
        (hymn, i) => `${hymn.song_title}-${i}`
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
const curlyQuote = /[\u2018\u2019\u201C\u201D]/;
const toStraightQuotes = (title: string): string =>
    title.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
const toCurlyApostrophe = (title: string): string =>
    title.replace(/'/g, "\u2019");

describe("real catalog examples", () => {
    test("the catalog has the shapes the other tests rely on", () => {
        expect(hymnCatalog.length).toBeGreaterThan(0);
        expect(recordsFor(singleTuneTitle)).toHaveLength(1);
        expect(recordsFor(multiTuneTitle).length).toBeGreaterThan(1);
        expect(recordsFor(UNKNOWN_TITLE)).toEqual([]);
    });
});

describe("buildHymnIndex", () => {
    test("groups the real catalog by normalized title, keeping catalog order", () => {
        const normalizedTitles = new Set(
            hymnCatalog.map((hymn) => normalizeTitle(hymn.song_title))
        );
        expect(index.size).toBe(normalizedTitles.size);

        let indexed = 0;
        for (const [key, group] of index) {
            expect(key).toBe(normalizeTitle(key));
            expect(group).toEqual(
                hymnCatalog.filter(
                    (hymn) => normalizeTitle(hymn.song_title) === key
                )
            );
            indexed += group.length;
        }
        // Every catalog record lands in exactly one group.
        expect(indexed).toBe(hymnCatalog.length);
    });

    test('puts punctuation-only siblings such as "Jesus Saves" and "Jesus Saves!" under one key', () => {
        expect(
            index.get("jesus saves")?.map((hymn) => [hymn.song_title, hymn.tune_name])
        ).toEqual([
            ["Jesus Saves", "LIMPSFIELD"],
            ["Jesus Saves!", "JESUS SAVES"],
        ]);
    });

    test("merges records whose titles differ only by quotes, spacing, '&' or trailing punctuation (synthetic)", () => {
        const record = (song_title: string, tune_name: string): RawHymn => ({
            song_title,
            tune_name,
            rejoice_hymns: 1,
            great_hymns_of_the_faith: -1,
        });
        const catalog = [
            record("Jesus\u2019 Love & Mercy", "ONE"),
            record("Jesus' Love  and Mercy!", "TWO"),
            record(" JESUS' LOVE AND MERCY. ", "THREE"),
        ];
        const result = buildHymnIndex(catalog);
        expect([...result.keys()]).toEqual(["jesus' love and mercy"]);
        expect(result.get("jesus' love and mercy")).toEqual(catalog);
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

        test("every catalog title finds every record of its normalized title, its own records first", () => {
            const results = matchHymns(index, catalogTitles);
            expect(results).toHaveLength(catalogTitles.length);
            results.forEach((result, i) => {
                expect(result.song_title).toBe(catalogTitles[i]);
                expect(result.versions.map((version) => version.id)).toEqual(
                    expectedIds(catalogTitles[i])
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

        test("a prefix or a longer title still does not match", () => {
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
                // Its own records come first, in catalog order.
                expect(
                    entry.versions
                        .slice(0, records.length)
                        .map((version) => version.tune_name)
                ).toEqual(records.map((record) => record.tune_name));
                expect(entry.versions.map((version) => version.id)).toEqual(
                    expectedIds(title)
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
                        },
                        {
                            id: "Test Hymn-1",
                            tune_name: "TUNE TWO",
                            rejoice_hymns_number: "-1",
                            great_hymns_number: "305",
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
                        },
                    ],
                },
            ]);
        });
    });

    describe("normalized matching", () => {
        test.each(["!", "?"])(
            'a catalog title ending in "%s" also matches when queried without it',
            (mark) => {
                // Titles whose unpunctuated form is not itself a catalog title.
                const titles = catalogTitles.filter(
                    (title) =>
                        title.endsWith(mark) &&
                        recordsFor(withoutTrailingPunctuation(title)).length ===
                            0
                );
                expect(titles.length).toBeGreaterThan(0);
                for (const title of titles) {
                    const bare = withoutTrailingPunctuation(title);
                    const [entry] = matchHymns(index, [bare]);
                    expect(entry.song_title).toBe(bare);
                    expect(entry.versions.map((version) => version.id)).toEqual(
                        expectedIds(bare)
                    );
                    expect(entry.versions.length).toBeGreaterThan(0);
                }
            }
        );

        test("a title and its trailing-punctuation sibling are merged, each listing its own records first", () => {
            // E.g. "X!" and "X" are two catalog titles; both lookups find both.
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
                const merged = recordsFor(title).length + recordsFor(bare).length;
                expect(withMark.versions).toHaveLength(merged);
                expect(withoutMark.versions).toHaveLength(merged);
                expect(withMark.versions.map((v) => v.id)).toEqual(expectedIds(title));
                expect(withoutMark.versions.map((v) => v.id)).toEqual(expectedIds(bare));
            }
        });

        // The merged pair the lookup fix was checked against (hymns.json
        // records 439 and 440). Each spelling keeps the default version it
        // had before the fix and now also offers the other tune.
        test('"Jesus Saves!" defaults to JESUS SAVES and also lists LIMPSFIELD', () => {
            const [entry] = matchHymns(index, ["Jesus Saves!"]);
            expect(
                entry.versions.map((v) => [
                    v.id,
                    v.tune_name,
                    v.rejoice_hymns_number,
                    v.great_hymns_number,
                ])
            ).toEqual([
                ["Jesus Saves!-0", "JESUS SAVES", "342", "231"],
                ["Jesus Saves-1", "LIMPSFIELD", "341", "-1"],
            ]);
        });

        test('"Jesus Saves" defaults to LIMPSFIELD and also lists JESUS SAVES', () => {
            const [entry] = matchHymns(index, ["Jesus Saves"]);
            expect(
                entry.versions.map((v) => [
                    v.id,
                    v.tune_name,
                    v.rejoice_hymns_number,
                    v.great_hymns_number,
                ])
            ).toEqual([
                ["Jesus Saves-0", "LIMPSFIELD", "341", "-1"],
                ["Jesus Saves!-1", "JESUS SAVES", "342", "231"],
            ]);
        });

        test("lists records equal to the request (ignoring case) first, then the rest in catalog order (synthetic catalog)", () => {
            const record = (song_title: string, tune_name: string): RawHymn => ({
                song_title,
                tune_name,
                rejoice_hymns: 1,
                great_hymns_of_the_faith: -1,
            });
            const synthetic = buildHymnIndex([
                record("Rise Up", "A"),
                record("Rise Up!", "B"),
                record("RISE UP.", "C"),
                record("Rise Up!", "D"),
            ]);
            const tunes = (title: string) =>
                matchHymns(synthetic, [title])[0].versions.map((v) => v.tune_name);
            expect(tunes("Rise Up!")).toEqual(["B", "D", "A", "C"]);
            expect(tunes("rise up")).toEqual(["A", "B", "C", "D"]);
            expect(tunes("Rise up.")).toEqual(["C", "A", "B", "D"]);
            // No spelling matches exactly: plain catalog order.
            expect(tunes("Rise Up?")).toEqual(["A", "B", "C", "D"]);
        });

        test("ignores case, curly quotes, spacing, '&' and trailing punctuation (synthetic catalog)", () => {
            const synthetic = buildHymnIndex([
                {
                    song_title: "Jesus\u2019 Love & Mercy!",
                    tune_name: "ONE",
                    rejoice_hymns: 1,
                    great_hymns_of_the_faith: -1,
                },
            ]);
            for (const query of [
                "jesus' love and mercy",
                "  JESUS\u2018 LOVE  &  MERCY ",
                "Jesus' Love & Mercy?",
            ]) {
                const [entry] = matchHymns(synthetic, [query]);
                expect(entry.song_title).toBe(query);
                expect(entry.versions.map((v) => v.id)).toEqual([
                    "Jesus\u2019 Love & Mercy!-0",
                ]);
            }
        });

        test("a catalog title with a curly apostrophe or quote matches when queried with straight quotes", () => {
            const titles = catalogTitles.filter(
                (title) =>
                    curlyQuote.test(title) &&
                    recordsFor(toStraightQuotes(title)).length === 0
            );
            expect(titles.length).toBeGreaterThan(0);
            for (const title of titles) {
                const [entry] = matchHymns(index, [toStraightQuotes(title)]);
                expect(entry.song_title).toBe(toStraightQuotes(title));
                expect(entry.versions.map((v) => v.id)).toEqual(
                    recordsForNormalized(title).map(
                        (record, i) => `${record.song_title}-${i}`
                    )
                );
            }
        });

        test("a catalog title with a straight apostrophe matches when queried with a curly one", () => {
            const titles = catalogTitles.filter(
                (title) =>
                    title.includes("'") &&
                    recordsFor(toCurlyApostrophe(title)).length === 0
            );
            expect(titles.length).toBeGreaterThan(0);
            for (const title of titles) {
                const [entry] = matchHymns(index, [toCurlyApostrophe(title)]);
                expect(entry.versions.map((v) => v.id)).toEqual(
                    recordsForNormalized(title).map(
                        (record, i) => `${record.song_title}-${i}`
                    )
                );
            }
        });

        test("surrounding and repeated whitespace is ignored", () => {
            const [record] = recordsFor(singleTuneTitle);
            for (const query of [
                `${singleTuneTitle} `,
                ` ${singleTuneTitle}`,
                singleTuneTitle.replace(/ /g, "  "),
            ]) {
                const [entry] = matchHymns(index, [query]);
                expect(entry.song_title).toBe(query);
                expect(entry.versions.map((v) => v.id)).toEqual([
                    `${record.song_title}-0`,
                ]);
            }
        });
    });
});
