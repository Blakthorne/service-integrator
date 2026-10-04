import "server-only";
import type {
    HymnNoteAction,
    HymnNoteChange,
    HymnNoteRemovalReason,
    PreviewedHymnNote,
} from "@/lib/hymnNotes";
import { parsePcoId } from "@/lib/pco";

/**
 * The plan a hymnal note preview showed, as the sync dialog sends it back
 * with Confirm (its `status.items`), checked before `syncHymnNotes` holds the
 * sync to it. It comes from a browser, so the confirm action parses it:
 * every item and note id through `parsePcoId`, every action, kind and
 * reason against the ones that exist, and the lists' lengths against caps,
 * so a forged or oversized body is refused before Planning Center is read.
 */

/** The most song items a preview may list: more than any plan has. */
export const MAX_PREVIEWED_ITEMS = 200;

/** The most writes one previewed item may list: a note in step, and its extras. */
export const MAX_PREVIEWED_CHANGES = 50;

/** Every action an item's diff can have, so a new one cannot be left out here. */
const ACTIONS: Readonly<Record<HymnNoteAction, true>> = {
    create: true,
    update: true,
    unchanged: true,
    delete: true,
    dedupe: true,
    keep: true,
    none: true,
};

const REASONS: Readonly<Record<HymnNoteRemovalReason, true>> = {
    "nothing-to-say": true,
    duplicate: true,
};

function isAction(value: unknown): value is HymnNoteAction {
    return typeof value === "string" && Object.hasOwn(ACTIONS, value);
}

function isReason(value: unknown): value is HymnNoteRemovalReason {
    return typeof value === "string" && Object.hasOwn(REASONS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One previewed write, rebuilt from its checked fields alone; null when it is not one. */
function parseChange(value: unknown): HymnNoteChange | null {
    if (!isRecord(value) || typeof value.content !== "string") {
        return null;
    }
    const { content } = value;
    switch (value.kind) {
        case "create":
            return { kind: "create", content };
        case "update": {
            const noteId = parsePcoId(value.noteId);
            return noteId !== null && typeof value.from === "string"
                ? { kind: "update", noteId, from: value.from, content }
                : null;
        }
        case "delete": {
            const noteId = parsePcoId(value.noteId);
            return noteId !== null && isReason(value.reason)
                ? { kind: "delete", noteId, content, reason: value.reason }
                : null;
        }
        default:
            return null;
    }
}

/** One previewed item, rebuilt from its checked fields alone; null when it is not one. */
function parseItem(value: unknown): PreviewedHymnNote | null {
    if (!isRecord(value) || !isAction(value.action) || !Array.isArray(value.changes)) {
        return null;
    }
    const itemId = parsePcoId(value.itemId);
    if (itemId === null || value.changes.length > MAX_PREVIEWED_CHANGES) {
        return null;
    }
    const changes: HymnNoteChange[] = [];
    for (const raw of value.changes) {
        const change = parseChange(raw);
        if (change === null) {
            return null;
        }
        changes.push(change);
    }
    return { itemId, action: value.action, changes };
}

/**
 * The previewed plan in `value`, each item and write rebuilt from its
 * checked fields alone (anything else the browser sent, such as a title, is
 * dropped), or null when any part of it is not what a preview sends: not a
 * list, more than `MAX_PREVIEWED_ITEMS` items or `MAX_PREVIEWED_CHANGES`
 * writes in one, an id that is not a Planning Center id, or an action, kind
 * or reason that does not exist. An empty list is a preview of a plan with
 * no songs.
 */
export function parsePreviewedHymnNotes(value: unknown): PreviewedHymnNote[] | null {
    if (!Array.isArray(value) || value.length > MAX_PREVIEWED_ITEMS) {
        return null;
    }
    const items: PreviewedHymnNote[] = [];
    for (const raw of value) {
        const item = parseItem(raw);
        if (item === null) {
            return null;
        }
        items.push(item);
    }
    return items;
}
