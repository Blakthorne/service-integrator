import { describe, expect, test } from "vitest";
import type { CatalogMatch, LabelledEntry, LinkSuggestion, Song } from "./domain";
import {
    SCHEDULE_OPTION_LABELS,
    catalogUnavailableMessage,
    differentSongTitle,
    linkedNotice,
    scheduleChoices,
    scheduleSongView,
    type ScheduleCatalogState,
} from "./scheduleCards";

function entry(id: number, label: string): LabelledEntry {
    return {
        id,
        bookId: 1,
        songId: 7,
        number: null,
        position: null,
        locationLabel: null,
        variantNote: null,
        bookCode: label.slice(0, 1),
        label,
    };
}

const ABIDE: CatalogMatch = {
    songId: 7,
    title: "Abide with Me",
    tuneName: "EVENTIDE",
    entries: [entry(1, "R-517"), entry(2, "G-64")],
};

const NOT_IN_A_BOOK: CatalogMatch = {
    songId: 8,
    title: "Shine, Jesus, Shine",
    tuneName: null,
    entries: [],
};

const NETTLETON: LinkSuggestion = {
    songId: 9,
    title: "Come, Thou Fount of Every Blessing",
    tuneName: "NETTLETON",
    entries: [entry(3, "R-553")],
    reason: "exact",
    pcoSongId: null,
};

/**
 * Planning Center song 30 is linked to Abide with Me and 50 to a song in no
 * book; 20 is not linked, with one suggestion, and 40 has none; 60 was set
 * aside on Reconcile, so it has neither.
 */
const STATE: ScheduleCatalogState = {
    catalog: { "30": ABIDE, "50": NOT_IN_A_BOOK },
    suggestions: { "20": [NETTLETON], "40": [] },
    catalogError: null,
};

describe("scheduleSongView", () => {
    test("a song linked to a catalog song shows it", () => {
        expect(scheduleSongView({ songId: "30" }, STATE)).toEqual({
            kind: "linked",
            match: ABIDE,
        });
    });

    test("a song that is not linked shows its suggestions, even none", () => {
        expect(scheduleSongView({ songId: "20" }, STATE)).toEqual({
            kind: "unlinked",
            pcoSongId: "20",
            suggestions: [NETTLETON],
        });
        expect(scheduleSongView({ songId: "40" }, STATE)).toEqual({
            kind: "unlinked",
            pcoSongId: "40",
            suggestions: [],
        });
    });

    test("a song with neither a link nor suggestions was set aside on Reconcile", () => {
        expect(scheduleSongView({ songId: "60" }, STATE)).toEqual({
            kind: "ignored",
            pcoSongId: "60",
        });
    });

    test("an item with no Planning Center song has no catalog song", () => {
        expect(scheduleSongView({ songId: null }, STATE)).toEqual({ kind: "no-song" });
    });

    test("when the catalog cannot be read, no song's link is known", () => {
        const unreadable: ScheduleCatalogState = {
            catalog: {},
            suggestions: {},
            catalogError: "Could not open the database",
        };
        expect(scheduleSongView({ songId: "30" }, unreadable)).toEqual({ kind: "unknown" });
        expect(scheduleSongView({ songId: null }, unreadable)).toEqual({ kind: "no-song" });
    });

    test("reads only the maps' own keys", () => {
        expect(scheduleSongView({ songId: "constructor" }, STATE)).toEqual({
            kind: "ignored",
            pcoSongId: "constructor",
        });
    });
});

describe("scheduleChoices", () => {
    test("a song linked to a catalog song in a book offers Numbers first", () => {
        expect(scheduleChoices({ kind: "linked", match: ABIDE })).toEqual([
            "numbers",
            "blank",
            "custom",
        ]);
    });

    test("every other song offers Leave blank and Custom", () => {
        for (const view of [
            { kind: "linked", match: NOT_IN_A_BOOK },
            { kind: "unlinked", pcoSongId: "20", suggestions: [NETTLETON] },
            { kind: "ignored", pcoSongId: "60" },
            { kind: "no-song" },
            { kind: "unknown" },
        ] as const) {
            expect(scheduleChoices(view)).toEqual(["blank", "custom"]);
        }
    });

    test("each choice has a label", () => {
        expect(SCHEDULE_OPTION_LABELS).toEqual({
            numbers: "Numbers",
            blank: "Leave blank",
            custom: "Custom",
        });
    });
});

describe("linkedNotice", () => {
    test("says the link went through, with the numbers the text will print", () => {
        expect(linkedNotice({ kind: "linked", match: ABIDE })).toBe("Linked: R-517 / G-64");
    });

    test("says when the linked song is in no book", () => {
        expect(linkedNotice({ kind: "linked", match: NOT_IN_A_BOOK })).toBe(
            "Linked. The song is in no book, so there are no numbers to print."
        );
    });

    test("says nothing while the card still shows the song as not linked", () => {
        expect(
            linkedNotice({ kind: "unlinked", pcoSongId: "20", suggestions: [NETTLETON] })
        ).toBeNull();
    });

    test("says just that it is linked when the catalog could not be read again", () => {
        expect(linkedNotice({ kind: "unknown" })).toBe("Linked.");
    });
});

describe("differentSongTitle", () => {
    const song = (title: string): Song => ({
        id: "20",
        title,
        author: null,
        admin: null,
        ccliNumber: null,
        copyright: null,
        notes: null,
        themes: null,
    });

    test("gives the song's title when the item calls it something else", () => {
        expect(
            differentSongTitle({
                title: "Come Thou Fount (Key of D)",
                song: song("Come, Thou Fount of Every Blessing"),
            })
        ).toBe("Come, Thou Fount of Every Blessing");
    });

    test("gives null when the titles are the same, but for spaces at the ends", () => {
        expect(differentSongTitle({ title: "Abide with Me", song: song("Abide with Me ") })).toBeNull();
    });

    test("gives null for an item without a song, or a song without a title", () => {
        expect(differentSongTitle({ title: "Offertory", song: null })).toBeNull();
        expect(differentSongTitle({ title: "Offertory", song: song("  ") })).toBeNull();
    });
});

describe("catalogUnavailableMessage", () => {
    test("says why the catalog is unavailable, and what that means for the numbers", () => {
        expect(
            catalogUnavailableMessage(
                "Could not open the database at /srv/data/app.sqlite: unable to open database file"
            )
        ).toBe(
            "The catalog is unavailable: Could not open the database at /srv/data/app.sqlite: unable to open database file. Numbers can't be shown."
        );
    });

    test("does not add a second full stop to a reason that ends a sentence", () => {
        expect(catalogUnavailableMessage("The disk is full.")).toBe(
            "The catalog is unavailable: The disk is full. Numbers can't be shown."
        );
        expect(catalogUnavailableMessage("Locked!")).toBe(
            "The catalog is unavailable: Locked! Numbers can't be shown."
        );
    });

    test("trims the reason, and leaves out an empty one", () => {
        expect(catalogUnavailableMessage("  locked  ")).toBe(
            "The catalog is unavailable: locked. Numbers can't be shown."
        );
        expect(catalogUnavailableMessage(" ")).toBe(
            "The catalog is unavailable. Numbers can't be shown."
        );
    });
});
