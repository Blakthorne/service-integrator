import "server-only";
import type { ItemNote } from "../domain";
import { jsonApi, pcoMutate } from "./client";
import { assertPcoId } from "./ids";
import { toItemNote } from "./mappers";
import type { PcoItemNoteResource, PcoSingleResponse } from "./resources";

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
