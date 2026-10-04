import "server-only";
import type { HymnOption, TuneOption } from "@/lib/catalog/pickers";
import {
    EMPTY_NEW_SONG,
    draftFromPcoTitle,
    type EntryEditInput,
    type HymnAliasInput,
    type HymnEditInput,
    type MoveDirection,
    type NewEntryInput,
    type NewSongDraft,
    type TuneAliasInput,
    type TuneEditInput,
} from "@/lib/catalog/validation";
import { getDb } from "@/lib/db";
import { listBooks, listCatalogSongs, listTunes } from "@/lib/db/catalog";
import {
    addEntry,
    addHymnAlias,
    addTuneAlias,
    deleteEntry,
    editEntry,
    editHymn,
    editTune,
    moveEntry,
    removeHymnAlias,
    removeTuneAlias,
    type EntryDeleteResult,
    type EntryEditResult,
    type EntryMoveResult,
    type HymnAliasResult,
    type HymnEditResult,
    type TuneAliasResult,
    type TuneEditResult,
} from "@/lib/db/catalogEdit";
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
export type {
    CatalogRowRef,
    EditProblem,
    EditResult,
    EntryDeleteResult,
    EntryEditResult,
    EntryMoveResult,
    EntryProblem,
    EntryProblemReason,
    HymnAliasResult,
    HymnEditResult,
    NameProblemReason,
    RenameOutcome,
    TuneAliasResult,
    TuneEditResult,
} from "@/lib/db/catalogEdit";

/**
 * Editing the catalog from its forms: what the new-song form shows and the
 * song it creates, the song page's Unlink, and the edits of a song's
 * entries, its hymn and tune and their other names, merges of hymns and of
 * tunes, and books. Reads and the local edits are synchronous, like the
 * database; only what may ask Planning Center (a song the mirror lacks) is
 * async. A change the catalog's rules refuse comes back as a value with a
 * message fit to show, naming the part of the form it is about and the row
 * it clashes with; anything unexpected (a database that cannot be opened,
 * Planning Center failing) throws. Each function takes IDs its caller has
 * already parsed (convention 19), and input its form's reader in
 * lib/catalog/validation.ts has checked.
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

// ---------------------------------------------------------------------------
// Entries (the song page's Entries card, and a book's page)
// ---------------------------------------------------------------------------

/**
 * Add an entry of a song to a book: at a number or location in a numbered
 * book, or in the order of one without (at its end, or at a position). See
 * `addEntry` for what it refuses.
 */
export function addCatalogEntry(input: NewEntryInput): EntryEditResult {
    return addEntry(getDb(), input);
}

/** Change an entry's number, location or place in the order, and its variant note (`editEntry`). */
export function editCatalogEntry(input: EntryEditInput): EntryEditResult {
    return editEntry(getDb(), input);
}

/** Delete an entry; in a book without numbers, the entries after it move up (`deleteEntry`). */
export function deleteCatalogEntry(entryId: number): EntryDeleteResult {
    return deleteEntry(getDb(), entryId);
}

/** Move an entry of a book without numbers one place up or down (`moveEntry`). */
export function moveCatalogEntry(entryId: number, direction: MoveDirection): EntryMoveResult {
    return moveEntry(getDb(), entryId, direction);
}

// ---------------------------------------------------------------------------
// Hymns and tunes (the song page's Hymn card, and a tune's page)
// ---------------------------------------------------------------------------

/**
 * Change a hymn's title, first line and notes (`editHymn`). A renamed hymn
 * keeps its old title as another title when a Planning Center song still
 * matches it, and says so (`aliasKept`).
 */
export function editCatalogHymn(input: HymnEditInput): HymnEditResult {
    return editHymn(getDb(), input);
}

/** Give a hymn another title (`addHymnAlias`). */
export function addCatalogHymnAlias(input: HymnAliasInput): HymnAliasResult {
    return addHymnAlias(getDb(), input);
}

/** Take another title off a hymn (`removeHymnAlias`). */
export function removeCatalogHymnAlias(input: HymnAliasInput): HymnAliasResult {
    return removeHymnAlias(getDb(), input);
}

/**
 * Change a tune's name, meter and notes (`editTune`). A renamed tune keeps
 * its old name as another name when a Planning Center song's title still
 * names it, and says so (`aliasKept`).
 */
export function editCatalogTune(input: TuneEditInput): TuneEditResult {
    return editTune(getDb(), input);
}

/** Give a tune another name (`addTuneAlias`). */
export function addCatalogTuneAlias(input: TuneAliasInput): TuneAliasResult {
    return addTuneAlias(getDb(), input);
}

/** Take another name off a tune (`removeTuneAlias`). */
export function removeCatalogTuneAlias(input: TuneAliasInput): TuneAliasResult {
    return removeTuneAlias(getDb(), input);
}
