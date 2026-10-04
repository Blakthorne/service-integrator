import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
    applyAutoLinks,
    findLinkedSong,
    linkSong,
    listAutoLinks,
    unlinkSong,
} from "./links";
import { findPcoSong } from "./pcoSongs";
import { openTestDb, seedHymn, seedPcoSong, seedSong, seedTune } from "./testing";

let db: DatabaseSync;

beforeEach(() => {
    db = openTestDb();
});

afterEach(() => {
    db.close();
});

const T1 = new Date("2026-10-04T12:00:00.000Z");
const T2 = new Date("2026-10-04T13:00:00.000Z");
const T3 = new Date("2026-10-04T14:00:00.000Z");

/** Two catalog songs (one with an unknown tune) and two Planning Center songs, none linked. */
function seed() {
    return {
        amazingGrace: seedSong(db, {
            hymnId: seedHymn(db, { title: "Amazing Grace" }),
            tuneId: seedTune(db, { name: "NEW BRITAIN" }),
        }),
        doxology: seedSong(db, { hymnId: seedHymn(db, { title: "Doxology" }) }),
        pcoAmazingGrace: seedPcoSong(db, { id: "1001", title: "Amazing Grace" }),
        pcoDoxology: seedPcoSong(db, { id: "1016", title: "Doxology" }),
    };
}

/** A catalog song's link columns. */
function linkOf(songId: number) {
    return db
        .prepare("SELECT pco_song_id, linked_at, linked_by FROM songs WHERE id = ?")
        .get(songId);
}

const UNLINKED = { pco_song_id: null, linked_at: null, linked_by: null };

describe("linkSong", () => {
    test("links a catalog song to a Planning Center song, recording when and how", () => {
        const { amazingGrace, pcoAmazingGrace } = seed();
        expect(linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T1)).toEqual({
            ok: true,
            changed: true,
        });
        expect(linkOf(amazingGrace)).toEqual({
            pco_song_id: "1001",
            linked_at: T1.toISOString(),
            linked_by: "manual",
        });
    });

    test("takes the Planning Center song off the ignored list", () => {
        const { doxology } = seed();
        const ignored = seedPcoSong(db, { title: "Doxology", ignoredAt: T1.toISOString() });
        expect(linkSong(db, doxology, ignored, "manual", T2)).toMatchObject({ ok: true });
        expect(findPcoSong(db, ignored)?.ignoredAt).toBeNull();
    });

    test("leaves a link that is already there as it was", () => {
        const { amazingGrace, pcoAmazingGrace } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "auto", T1);
        expect(linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T2)).toEqual({
            ok: true,
            changed: false,
        });
        expect(linkOf(amazingGrace)).toEqual({
            pco_song_id: "1001",
            linked_at: T1.toISOString(),
            linked_by: "auto",
        });
    });

    test("refuses a catalog song that does not exist", () => {
        const { pcoAmazingGrace } = seed();
        expect(linkSong(db, 9999, pcoAmazingGrace, "manual", T1)).toEqual({
            ok: false,
            reason: "song-not-found",
            message: "There is no such catalog song.",
        });
    });

    test("refuses a Planning Center song the mirror lacks", () => {
        const { amazingGrace } = seed();
        expect(linkSong(db, amazingGrace, "404", "manual", T1)).toEqual({
            ok: false,
            reason: "pco-song-not-found",
            message: "There is no such Planning Center song.",
        });
        expect(linkOf(amazingGrace)).toEqual(UNLINKED);
    });

    test("refuses a Planning Center song deleted from Planning Center", () => {
        const { amazingGrace } = seed();
        const removed = seedPcoSong(db, { title: "Amazing Grace", removedAt: T1.toISOString() });
        expect(linkSong(db, amazingGrace, removed, "manual", T2)).toEqual({
            ok: false,
            reason: "pco-song-removed",
            message:
                'The Planning Center song "Amazing Grace" has been deleted from Planning Center.',
        });
        expect(linkOf(amazingGrace)).toEqual(UNLINKED);
    });

    test("refuses a catalog song linked to another Planning Center song, naming it", () => {
        const { amazingGrace, pcoAmazingGrace, pcoDoxology } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T1);
        expect(linkSong(db, amazingGrace, pcoDoxology, "manual", T2)).toEqual({
            ok: false,
            reason: "song-linked",
            message:
                '"Amazing Grace (NEW BRITAIN)" is already linked to the Planning Center song "Amazing Grace". Undo that link first.',
        });
        expect(linkOf(amazingGrace)).toMatchObject({ pco_song_id: "1001" });
        expect(findLinkedSong(db, pcoDoxology)).toBeNull();
    });

    test("names a Planning Center song the mirror lacks by its id", () => {
        const { pcoDoxology } = seed();
        const linkedByImport = seedSong(db, {
            hymnId: seedHymn(db, { title: "Abide with Me" }),
            pcoSongId: "777",
        });
        expect(linkSong(db, linkedByImport, pcoDoxology, "manual", T1)).toMatchObject({
            reason: "song-linked",
            message:
                '"Abide with Me" is already linked to Planning Center song 777. Undo that link first.',
        });
    });

    test("refuses a Planning Center song linked to another catalog song, naming it", () => {
        const { amazingGrace, doxology, pcoAmazingGrace } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T1);
        expect(linkSong(db, doxology, pcoAmazingGrace, "manual", T2)).toEqual({
            ok: false,
            reason: "pco-song-linked",
            message:
                'The Planning Center song "Amazing Grace" is already linked to "Amazing Grace (NEW BRITAIN)". Undo that link first.',
        });
        expect(linkOf(doxology)).toEqual(UNLINKED);
    });
});

describe("unlinkSong", () => {
    test("removes a link, giving the Planning Center song it had", () => {
        const { amazingGrace, pcoAmazingGrace } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "auto", T1);
        expect(unlinkSong(db, amazingGrace, {}, T2)).toEqual({ ok: true, pcoSongId: "1001" });
        expect(linkOf(amazingGrace)).toEqual(UNLINKED);
        expect(findPcoSong(db, pcoAmazingGrace)?.autoLinkBlockedAt).toBeNull();
    });

    test("stops syncs from linking the Planning Center song again when asked", () => {
        const { amazingGrace, pcoAmazingGrace } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "auto", T1);
        expect(
            unlinkSong(db, amazingGrace, { pcoSongId: pcoAmazingGrace, blockAutoLink: true }, T2)
        ).toEqual({ ok: true, pcoSongId: "1001" });
        expect(findPcoSong(db, pcoAmazingGrace)?.autoLinkBlockedAt).toBe(T2.toISOString());
    });

    test("refuses a catalog song that is not linked", () => {
        const { doxology } = seed();
        expect(unlinkSong(db, doxology, { blockAutoLink: true }, T1)).toEqual({
            ok: false,
            reason: "not-linked",
            message: '"Doxology" is not linked to a Planning Center song.',
        });
    });

    test("refuses when the catalog song is linked to another Planning Center song than the one given", () => {
        const { amazingGrace, pcoAmazingGrace, pcoDoxology } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T1);
        expect(
            unlinkSong(db, amazingGrace, { pcoSongId: pcoDoxology, blockAutoLink: true }, T2)
        ).toEqual({
            ok: false,
            reason: "not-linked",
            message:
                '"Amazing Grace (NEW BRITAIN)" is not linked to the Planning Center song "Doxology".',
        });
        expect(linkOf(amazingGrace)).toMatchObject({ pco_song_id: "1001" });
        expect(findPcoSong(db, pcoDoxology)?.autoLinkBlockedAt).toBeNull();
    });

    test("refuses a catalog song that does not exist", () => {
        expect(unlinkSong(db, 9999)).toMatchObject({ ok: false, reason: "song-not-found" });
    });
});

describe("applyAutoLinks", () => {
    test("makes each link as an auto-link, and counts them", () => {
        const { amazingGrace, doxology, pcoAmazingGrace, pcoDoxology } = seed();
        expect(
            applyAutoLinks(
                db,
                [
                    { songId: amazingGrace, pcoSongId: pcoAmazingGrace },
                    { songId: doxology, pcoSongId: pcoDoxology },
                ],
                T1
            )
        ).toBe(2);
        expect(linkOf(doxology)).toEqual({
            pco_song_id: "1016",
            linked_at: T1.toISOString(),
            linked_by: "auto",
        });
    });

    test("skips a link that is refused or already there", () => {
        const { amazingGrace, doxology, pcoAmazingGrace } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T1);
        expect(
            applyAutoLinks(
                db,
                [
                    { songId: amazingGrace, pcoSongId: pcoAmazingGrace },
                    { songId: doxology, pcoSongId: "404" },
                    { songId: doxology, pcoSongId: pcoAmazingGrace },
                ],
                T2
            )
        ).toBe(0);
        expect(linkOf(amazingGrace)).toMatchObject({ linked_by: "manual" });
        expect(linkOf(doxology)).toEqual(UNLINKED);
    });

    test("makes nothing from no choices", () => {
        expect(applyAutoLinks(db, [], T1)).toBe(0);
    });
});

describe("listAutoLinks", () => {
    test("lists the auto-links made since a time that still stand, newest first", () => {
        const { amazingGrace, doxology, pcoAmazingGrace, pcoDoxology } = seed();
        const earlier = seedSong(db, { hymnId: seedHymn(db, { title: "Abide with Me" }) });
        const manual = seedSong(db, { hymnId: seedHymn(db, { title: "Be Thou My Vision" }) });
        const undone = seedSong(db, { hymnId: seedHymn(db, { title: "Holy, Holy, Holy" }) });
        linkSong(db, earlier, seedPcoSong(db, { title: "Abide with Me" }), "auto", T1);
        linkSong(db, amazingGrace, pcoAmazingGrace, "auto", T2);
        linkSong(db, manual, seedPcoSong(db, { title: "Be Thou My Vision" }), "manual", T3);
        linkSong(db, undone, seedPcoSong(db, { title: "Holy, Holy, Holy" }), "auto", T3);
        unlinkSong(db, undone, { blockAutoLink: true }, T3);
        linkSong(db, doxology, pcoDoxology, "auto", T3);

        expect(listAutoLinks(db, T2)).toEqual([
            {
                songId: doxology,
                title: "Doxology",
                tuneName: null,
                pcoSongId: "1016",
                pcoTitle: "Doxology",
                linkedAt: T3.toISOString(),
            },
            {
                songId: amazingGrace,
                title: "Amazing Grace",
                tuneName: "NEW BRITAIN",
                pcoSongId: "1001",
                pcoTitle: "Amazing Grace",
                linkedAt: T2.toISOString(),
            },
        ]);
        expect(listAutoLinks(db, T1).map(({ title }) => title)).toEqual([
            "Doxology",
            "Amazing Grace",
            "Abide with Me",
        ]);
    });
});

describe("findLinkedSong", () => {
    test("gives the catalog song linked to a Planning Center song, or null", () => {
        const { amazingGrace, pcoAmazingGrace, pcoDoxology } = seed();
        linkSong(db, amazingGrace, pcoAmazingGrace, "manual", T1);
        expect(findLinkedSong(db, pcoAmazingGrace)).toEqual({
            songId: amazingGrace,
            label: "Amazing Grace (NEW BRITAIN)",
        });
        expect(findLinkedSong(db, pcoDoxology)).toBeNull();
    });
});
