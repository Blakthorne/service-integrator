import { describe, expect, test } from "vitest";
import type { BookEntry } from "@/lib/domain";
import { toBookRows, type BookRow } from "./bookRows";

/** A book's entry as `getCatalogBook` reads it; the fields a test does not set are plain. */
function entry(fields: Partial<BookEntry> & { songId: number }): BookEntry {
    return {
        id: fields.songId,
        bookId: 1,
        number: null,
        position: null,
        locationLabel: null,
        variantNote: null,
        bookCode: "R",
        label: "R-?",
        hymnId: fields.songId,
        title: `Hymn ${fields.songId}`,
        tuneId: null,
        tuneName: null,
        pcoSongId: null,
        ...fields,
    };
}

const NUMBERED = { numbered: true };
const UNNUMBERED = { numbered: false };

describe("toBookRows", () => {
    test("a numbered book's row has its label, its number, the hymn, the tune and no note", () => {
        const rows = toBookRows({
            ...NUMBERED,
            entries: [
                entry({
                    songId: 7,
                    number: 396,
                    label: "R-396",
                    title: "Amazing Grace",
                    tuneId: 3,
                    tuneName: "NEW BRITAIN",
                    pcoSongId: "12345",
                }),
            ],
        });

        expect(rows).toEqual([
            {
                number: 396,
                placement: "R-396",
                songId: 7,
                title: "Amazing Grace",
                tune: "NEW BRITAIN",
                note: "",
            },
        ]);
    });

    test("keeps the rows in the order the book gives them, the front cover first", () => {
        const rows = toBookRows({
            ...NUMBERED,
            entries: [
                entry({ songId: 1, locationLabel: "front cover", label: "G-Front Cover" }),
                entry({ songId: 2, number: 1, label: "G-1" }),
                entry({ songId: 3, number: 2, label: "G-2" }),
            ],
        });

        expect(rows.map((row) => row.placement)).toEqual(["G-Front Cover", "G-1", "G-2"]);
        expect(rows.map((row) => row.number)).toEqual([null, 1, 2]);
    });

    test("does not repeat a location the label already says", () => {
        const [frontCover] = toBookRows({
            ...NUMBERED,
            entries: [
                entry({
                    songId: 1,
                    label: "G-Front Cover",
                    locationLabel: "front cover",
                }),
            ],
        });

        expect(frontCover.note).toBe("");
    });

    test("notes a variant, and a location the label does not say, in that order", () => {
        const rows = toBookRows({
            ...NUMBERED,
            entries: [
                entry({
                    songId: 1,
                    number: 700,
                    label: "R-700",
                    variantNote: "Descant - last stanza only",
                }),
                entry({
                    songId: 2,
                    number: 7,
                    label: "R-7",
                    locationLabel: "inside back cover",
                }),
                entry({
                    songId: 3,
                    number: 8,
                    label: "R-8",
                    variantNote: "A Round",
                    locationLabel: "inside back cover",
                }),
            ],
        });

        expect(rows.map((row) => row.note)).toEqual([
            "Descant - last stanza only",
            "inside back cover",
            "A Round · inside back cover",
        ]);
    });

    test("leaves the tune null when it is not known", () => {
        const [row] = toBookRows({
            ...NUMBERED,
            entries: [entry({ songId: 1, number: 5, label: "R-5", tuneName: null })],
        });

        expect(row.tune).toBeNull();
    });

    test("an unnumbered book's row has its position, a dash without one, and its location as a note", () => {
        const rows = toBookRows({
            ...UNNUMBERED,
            entries: [
                entry({ songId: 1, position: 1, label: "Chorus Book" }),
                entry({ songId: 2, position: 12, label: "Chorus Book" }),
                entry({
                    songId: 3,
                    label: "Chorus Book",
                    locationLabel: "back cover",
                }),
            ],
        });

        expect(rows.map((row) => row.placement)).toEqual(["1", "12", "—"]);
        expect(rows.map((row) => row.number)).toEqual([null, null, null]);
        expect(rows.map((row) => row.note)).toEqual(["", "", "back cover"]);
    });

    test("an unnumbered book's rows carry their entry's id, for moving them; a numbered book's do not", () => {
        const unnumbered = toBookRows({
            ...UNNUMBERED,
            entries: [
                entry({ id: 41, songId: 1, position: 1, label: "Chorus Book" }),
                entry({ id: 17, songId: 2, position: 2, label: "Chorus Book" }),
            ],
        });
        const numbered = toBookRows({
            ...NUMBERED,
            entries: [entry({ id: 41, songId: 1, number: 1, label: "R-1" })],
        });

        expect(unnumbered.map((row) => row.entryId)).toEqual([41, 17]);
        expect("entryId" in numbered[0]).toBe(false);
    });

    test("is empty for a book with no entries", () => {
        expect(toBookRows({ ...NUMBERED, entries: [] })).toEqual([]);
    });

    test("sends only the six fields the table shows, since each is paid for once per row", () => {
        const [row] = toBookRows({
            ...NUMBERED,
            entries: [
                entry({
                    songId: 1,
                    number: 1,
                    label: "R-1",
                    tuneId: 9,
                    tuneName: "ST. ANNE",
                    pcoSongId: "99",
                    variantNote: "A Round",
                }),
            ],
        });

        const fields: (keyof BookRow)[] = [
            "number",
            "placement",
            "songId",
            "title",
            "tune",
            "note",
        ];
        expect(Object.keys(row).sort()).toEqual([...fields].sort());
    });
});
