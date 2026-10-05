import "server-only";
import type { HymnOption, TuneOption } from "@/lib/catalog/pickers";
import {
    EMPTY_NEW_SONG,
    draftFromPcoTitle,
    type NewSongDraft,
} from "@/lib/catalog/validation";
import { getDb } from "@/lib/db";
import { listBooks, listCatalogSongs, listTunes } from "@/lib/db/catalog";
import {
    createCatalogSong,
    type CreateSongResult,
    type NewCatalogSong,
} from "@/lib/db/catalogWrites";
import { findLinkedSong, unlinkSong, type UnlinkResult } from "@/lib/db/links";
import { findPcoSong } from "@/lib/db/pcoSongs";
import type { Book, CatalogSongSummary, MirroredPcoSong } from "@/lib/domain";
import { buildCatalogIndex } from "@/lib/reconcile";
import { mirrorPcoSong } from "./reconcile";

export type {
    CreateSongProblem,
    CreateSongResult,
    ExistingRow,
    NewCatalogSong,
} from "@/lib/db/catalogWrites";

/**
 * Editing the catalog from its forms: what the new-song form shows and the
 * song it creates, and the song page's Unlink. Reads are synchronous, like
 * the database, except where Planning Center may have to be asked (a song
 * the mirror lacks). A change the catalog's rules refuse comes back as a
 * value with a message fit to show; anything unexpected (a database that
 * cannot be opened, Planning Center failing) throws. Each function takes
 * IDs its caller has already parsed (convention 19).
 */

/** A book as the new-song form offers it. */
export type NewSongFormBook = Pick<
    Book,
    "id" | "code" | "name" | "shortName" | "numbered" | "labelFormat"
>;

/** The Planning Center song the new-song form links its song to, as the form shows it. */
export interface NewSongPcoSong {
    id: string;
    title: string;
    author: string | null;
    /** Deleted from Planning Center, so the form cannot link it. */
    removed: boolean;
    /** The catalog song it is linked to already, so the form cannot link it; null when none. */
    linkedTo: { songId: number; label: string } | null;
}

/** What the new-song form shows. */
export interface NewSongFormData {
    /** Every hymn, by title, with the tunes it is sung to. */
    hymns: HymnOption[];
    /** Every tune, by name. */
    tunes: TuneOption[];
    /** The active books, in book order. */
    books: NewSongFormBook[];
    /** The Planning Center song the form was opened for; null without one, or when Planning Center has no such song. */
    pcoSong: NewSongPcoSong | null;
    /** What the form starts with: prefilled from the Planning Center song's title, if there is one. */
    draft: NewSongDraft;
}

/** Every hymn of the songs list's rows, in their order (by title), with the names of its tunes. */
function hymnOptions(songs: readonly CatalogSongSummary[]): HymnOption[] {
    const hymns = new Map<number, HymnOption>();
    for (const song of songs) {
        const hymn = hymns.get(song.hymnId);
        if (hymn) {
            hymn.tunes.push(song.tuneName);
        } else {
            hymns.set(song.hymnId, {
                id: song.hymnId,
                title: song.title,
                aliases: song.aliases,
                tunes: [song.tuneName],
            });
        }
    }
    return [...hymns.values()];
}

/**
 * What the new-song form shows, opened for Planning Center song
 * `pcoSongId` (null for none): every hymn and tune for its pickers, the
 * active books, and the form's first values, prefilled from that song's
 * title (`draftFromPcoTitle`). A song the mirror lacks is read from
 * Planning Center first (`mirrorPcoSong`); when Planning Center has no such
 * song, the form is the empty one, with no song to link. Throws when the
 * database cannot be read or Planning Center fails.
 */
export async function getNewSongFormData(pcoSongId: string | null): Promise<NewSongFormData> {
    const mirrored = pcoSongId !== null && (await mirrorPcoSong(pcoSongId));
    const db = getDb();
    const songs = listCatalogSongs(db);
    const pcoSong: MirroredPcoSong | null =
        mirrored && pcoSongId !== null ? findPcoSong(db, pcoSongId) : null;
    return {
        hymns: hymnOptions(songs),
        tunes: listTunes(db).map(({ id, name, aliases, meter }) => ({ id, name, aliases, meter })),
        books: listBooks(db)
            .filter(({ active }) => active)
            .map(({ id, code, name, shortName, numbered, labelFormat }) => ({
                id,
                code,
                name,
                shortName,
                numbered,
                labelFormat,
            })),
        pcoSong: pcoSong && {
            id: pcoSong.id,
            title: pcoSong.title,
            author: pcoSong.author,
            removed: pcoSong.removedAt !== null,
            linkedTo: findLinkedSong(db, pcoSong.id),
        },
        draft: pcoSong ? draftFromPcoTitle(pcoSong.title, buildCatalogIndex(songs)) : EMPTY_NEW_SONG,
    };
}

/** The books the new-song form's action checks an entry against: the active ones. */
export function getNewSongBooks(): Pick<Book, "id" | "name" | "numbered">[] {
    return listBooks(getDb())
        .filter(({ active }) => active)
        .map(({ id, name, numbered }) => ({ id, name, numbered }));
}

/**
 * Add the new-song form's song to the catalog (`createCatalogSong`), linked
 * to its Planning Center song if it has one. That song is mirrored first
 * when the mirror lacks it (one request), so the link always points at a
 * mirrored song; when Planning Center has no such song, nothing is written.
 */
export async function createSong(
    song: NewCatalogSong,
    now: Date = new Date()
): Promise<CreateSongResult> {
    if (song.pcoSongId !== null && !(await mirrorPcoSong(song.pcoSongId, now))) {
        return {
            ok: false,
            problems: [
                {
                    reason: "pco-song-not-found",
                    part: null,
                    message: "There is no such Planning Center song.",
                    existing: null,
                },
            ],
        };
    }
    return createCatalogSong(getDb(), song, now);
}

/** A song of the Planning Center mirror, or null when the mirror lacks it: what the song page shows of a link. */
export function getMirroredPcoSong(pcoSongId: string): MirroredPcoSong | null {
    return findPcoSong(getDb(), pcoSongId);
}

/**
 * The song page's Unlink: remove catalog song `songId`'s link to Planning
 * Center song `pcoSongId`, and stop syncs from linking that Planning Center
 * song again on their own, as Reconcile's Undo does: a person has said the
 * two do not belong together (a link by hand still works). Refused when the
 * song is not linked to that Planning Center song (the page was out of
 * date).
 */
export function unlinkCatalogSong(songId: number, pcoSongId: string): UnlinkResult {
    return unlinkSong(getDb(), songId, { pcoSongId, blockAutoLink: true });
}
