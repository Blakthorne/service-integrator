import "server-only";
import type { ItemNote, PcoLibrarySong, PlanItem } from "../domain";
import { jsonApi, pcoMutate, toMany } from "./client";
import { assertPcoId } from "./ids";
import { toItemNote, toPcoLibrarySong, toPlanItem } from "./mappers";
import type {
    PcoItemNoteResource,
    PcoItemResource,
    PcoSingleResponse,
    PcoSongResource,
} from "./resources";

/**
 * The writes to Planning Center: the only module that sends a POST, PATCH
 * or DELETE (convention 18), each through `pcoMutate` with a body from
 * `jsonApi`. Every function checks every id it is given with `assertPcoId`
 * before it sends anything, makes one write, unpaced (someone is waiting),
 * and returns what changed. A 422 throws `PcoValidationError`, whose
 * `details` say what Planning Center refused ("category: must exist"); any
 * other failure throws `PcoError`, or the timeout's error.
 *
 * The caller, a `lib/queries` function, reads afresh before it writes
 * (refresh-before-write) and records a `write_log` row for each write.
 *
 * The writes: item notes (create, update, delete), songs (create, update),
 * song items (create, appended to a plan) and a song's tags (assign).
 */

/** The path of an item's notes. */
function itemNotesPath(serviceTypeId: string, planId: string, itemId: string): string {
    const st = assertPcoId(serviceTypeId);
    const plan = assertPcoId(planId);
    const item = assertPcoId(itemId);
    return `/service_types/${st}/plans/${plan}/items/${item}/item_notes`;
}

/** The note a write's response describes. Throws when Planning Center sent none. */
function noteFrom(
    response: PcoSingleResponse<PcoItemNoteResource> | null,
    path: string
): ItemNote {
    if (!response?.data) {
        throw new Error(`Planning Center sent no item note back (${path})`);
    }
    return toItemNote(response.data);
}

/**
 * Create a note saying `content` on item `itemId` of plan `planId`, in item
 * note category `categoryId` of service type `serviceTypeId`. The category
 * goes in `item_note_category_id`, as a string, which the spike found PCO
 * takes. Returns the note Planning Center created. An item may already hold
 * notes in that category (PCO allows several): look first.
 */
export async function createItemNote(
    serviceTypeId: string,
    planId: string,
    itemId: string,
    categoryId: string,
    content: string
): Promise<ItemNote> {
    const path = itemNotesPath(serviceTypeId, planId, itemId);
    const category = assertPcoId(categoryId);
    const response = await pcoMutate<PcoSingleResponse<PcoItemNoteResource>>(
        "POST",
        path,
        jsonApi("ItemNote", { content, item_note_category_id: category })
    );
    const note = noteFrom(response, path);
    return { ...note, categoryId: note.categoryId ?? category };
}

/**
 * Change what note `noteId` on item `itemId` says to `content`. Only the
 * content: a note's category can never change (PCO answers 422 "Forbidden
 * Attribute"). Returns the note as Planning Center has it now.
 */
export async function updateItemNote(
    serviceTypeId: string,
    planId: string,
    itemId: string,
    noteId: string,
    content: string
): Promise<ItemNote> {
    const path = `${itemNotesPath(serviceTypeId, planId, itemId)}/${assertPcoId(noteId)}`;
    const response = await pcoMutate<PcoSingleResponse<PcoItemNoteResource>>(
        "PATCH",
        path,
        jsonApi("ItemNote", { content })
    );
    return noteFrom(response, path);
}

/** What `deleteItemNote` removed. */
export interface DeletedItemNote {
    id: string;
}

/** Delete note `noteId` from item `itemId`. Returns the id of the note deleted. */
export async function deleteItemNote(
    serviceTypeId: string,
    planId: string,
    itemId: string,
    noteId: string
): Promise<DeletedItemNote> {
    const note = assertPcoId(noteId);
    await pcoMutate("DELETE", `${itemNotesPath(serviceTypeId, planId, itemId)}/${note}`);
    return { id: note };
}

/** What a new song is created with: every field but its CCLI number (see `createSong`). */
export interface NewPcoSong {
    title: string;
    author?: string | null;
    copyright?: string | null;
    admin?: string | null;
    themes?: string | null;
    hidden?: boolean;
}

/**
 * What `updateSong` may change of a song: the attributes Planning Center lets
 * the API assign (any other, such as its notes, gets a 422 "Forbidden
 * Attribute"). A field left out is left as it is.
 */
export interface PcoSongChanges {
    title?: string;
    author?: string | null;
    copyright?: string | null;
    ccliNumber?: number | null;
    admin?: string | null;
    themes?: string | null;
    hidden?: boolean;
}

/** Planning Center's name for each song field a write sends. */
const SONG_ATTRIBUTES = {
    title: "title",
    author: "author",
    copyright: "copyright",
    ccliNumber: "ccli_number",
    admin: "admin",
    themes: "themes",
    hidden: "hidden",
} as const satisfies Record<keyof PcoSongChanges, string>;

/** The attributes a song write sends: each field given, under Planning Center's name for it. */
function songAttributes(fields: PcoSongChanges): Record<string, unknown> {
    const attributes: Record<string, unknown> = {};
    for (const [field, attribute] of Object.entries(SONG_ATTRIBUTES)) {
        const value = fields[field as keyof PcoSongChanges];
        if (value !== undefined) {
            attributes[attribute] = value;
        }
    }
    return attributes;
}

/** The song a write's response describes. Throws when Planning Center sent none. */
function songFrom(response: PcoSingleResponse<PcoSongResource> | null, path: string): PcoLibrarySong {
    if (!response?.data) {
        throw new Error(`Planning Center sent no song back (${path})`);
    }
    return toPcoLibrarySong(response.data);
}

/**
 * Create a song in Planning Center's library with `song`'s fields, and
 * return it as Planning Center created it (Planning Center gives it a
 * "Default Arrangement"). Never with a CCLI number: the spike found that a
 * `ccli_number` on create makes Planning Center replace the song's title,
 * author, copyright, admin and themes with CCLI's, so only the fields of
 * `NewPcoSong` are sent, whatever else `song` holds. Set the number
 * afterwards with `updateSong`.
 */
export async function createSong(song: NewPcoSong): Promise<PcoLibrarySong> {
    const { title, author, copyright, admin, themes, hidden } = song;
    const path = "/songs";
    const response = await pcoMutate<PcoSingleResponse<PcoSongResource>>(
        "POST",
        path,
        jsonApi("Song", songAttributes({ title, author, copyright, admin, themes, hidden }))
    );
    return songFrom(response, path);
}

/**
 * Change song `songId`'s fields given in `changes` (a PATCH with no
 * `data.id`, which the spike found Planning Center takes), and return the
 * song as Planning Center has it now. Throws, sending nothing, when
 * `changes` changes nothing.
 */
export async function updateSong(songId: string, changes: PcoSongChanges): Promise<PcoLibrarySong> {
    const path = `/songs/${assertPcoId(songId)}`;
    const attributes = songAttributes(changes);
    if (Object.keys(attributes).length === 0) {
        throw new Error(`Nothing to change of the song (${path})`);
    }
    const response = await pcoMutate<PcoSingleResponse<PcoSongResource>>(
        "PATCH",
        path,
        jsonApi("Song", attributes)
    );
    return songFrom(response, path);
}

/** What a new song item is: the song, the arrangement it uses, and its title in the plan. */
export interface NewSongItem {
    songId: string;
    /** One of the song's arrangements; without one, Planning Center gives the item none. */
    arrangementId: string;
    /** Without one, Planning Center calls the item "New Item". */
    title: string;
}

/**
 * Add song `songId` to plan `planId` of service type `serviceTypeId` as a
 * new item at the end of the plan (no `sequence` is sent, so it is
 * appended), titled `title` and using arrangement `arrangementId`: the spike
 * found that an item given only its song is titled "New Item" and has no
 * arrangement. Returns the item Planning Center created.
 */
export async function createSongItem(
    serviceTypeId: string,
    planId: string,
    { songId, arrangementId, title }: NewSongItem
): Promise<PlanItem> {
    const path = `/service_types/${assertPcoId(serviceTypeId)}/plans/${assertPcoId(planId)}/items`;
    const song = assertPcoId(songId);
    const arrangement = assertPcoId(arrangementId);
    const response = await pcoMutate<PcoSingleResponse<PcoItemResource>>(
        "POST",
        path,
        jsonApi("Item", { title, song_id: song, arrangement_id: arrangement })
    );
    if (!response?.data) {
        throw new Error(`Planning Center sent no item back (${path})`);
    }
    const item = toPlanItem(response.data);
    return { ...item, songId: item.songId ?? song };
}

/** What `assignSongTags` gave a song: its whole set of tags now. */
export interface AssignedSongTags {
    songId: string;
    tagIds: string[];
}

/**
 * Give song `songId` exactly the tags `tagIds` (each once), replacing all of
 * its tags: the spike found that `assign_tags` replaces them, so send the
 * whole new set, and an empty one clears them. It also found that an
 * arrangement tag's id is taken and silently ignored, so send only the ids
 * of song tags. Returns the set sent.
 */
export async function assignSongTags(
    songId: string,
    tagIds: readonly string[]
): Promise<AssignedSongTags> {
    const song = assertPcoId(songId);
    const ids = [...new Set(tagIds)];
    await pcoMutate(
        "POST",
        `/songs/${song}/assign_tags`,
        jsonApi("TagAssignment", {}, { tags: toMany("Tag", ids) })
    );
    return { songId: song, tagIds: ids };
}
