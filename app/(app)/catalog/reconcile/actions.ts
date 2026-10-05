"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { parseCatalogId } from "@/lib/catalog/ids";
import {
    FORM_FAILURE_MESSAGE,
    formError,
    formSuccess,
    readId,
    type FormState,
} from "@/lib/forms";
import { parsePcoId } from "@/lib/pco";
import { unlinkCatalogSong } from "@/lib/queries/catalogEdit";
import {
    ignorePcoSong,
    linkCatalogSong,
    undoAutoLink,
    unignorePcoSong,
} from "@/lib/queries/reconcile";
import { routes } from "@/lib/routes";

/**
 * Every change to a link between a catalog song and a Planning Center song
 * made from the catalog's pages: Reconcile's Link, Undo, Ignore and
 * Unignore, and the song page's Unlink. Each is a form's action
 * (`useActionState`): its ids come in hidden fields, and it gives back
 * "success" or "error" with a message (`lib/forms.ts`); none has fields of
 * its own to mark.
 */
export type LinkActionState = FormState<never>;

/** What an action says when an id it was posted is not one: a stale or tampered page. */
const NOT_AN_ID_MESSAGE = "This page asked for a change that cannot be made. Reload it and try again.";

/**
 * A server action is a public POST endpoint, so each one checks the session
 * itself rather than relying on the middleware (convention 15), and throws
 * without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

/**
 * Revalidate every page that shows whether songs are linked: the catalog's
 * (the songs list, Reconcile, each song's page) and the plans' (their
 * numbers and suggestions come from the links).
 */
function revalidateLinks(): void {
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
}

/** Log a failure nobody expected, and give the form the generic message. */
function failed(what: string, error: unknown): LinkActionState {
    console.error(`Failed to ${what}:`, error);
    return formError(FORM_FAILURE_MESSAGE);
}

/** The form's two ids, each through the parser for its kind (convention 19), or null if either is not one. */
function readSongIds(formData: FormData): { songId: number; pcoSongId: string } | null {
    const songId = readId(formData, "songId", parseCatalogId);
    const pcoSongId = readId(formData, "pcoSongId", parsePcoId);
    return songId === null || pcoSongId === null ? null : { songId, pcoSongId };
}

/**
 * Reconcile's Link: link catalog song `songId` to Planning Center song
 * `pcoSongId` by hand (`linkCatalogSong`). A refusal (either song is linked
 * to another already) comes back with its message.
 */
export async function linkSongAction(
    _state: LinkActionState,
    formData: FormData
): Promise<LinkActionState> {
    await requireSession();
    const ids = readSongIds(formData);
    if (ids === null) {
        return formError(NOT_AN_ID_MESSAGE);
    }
    let result: Awaited<ReturnType<typeof linkCatalogSong>>;
    try {
        result = await linkCatalogSong(ids.songId, ids.pcoSongId);
    } catch (error) {
        return failed(`link Planning Center song ${ids.pcoSongId} to catalog song ${ids.songId}`, error);
    }
    if (!result.ok) {
        return formError(result.message);
    }
    revalidateLinks();
    return formSuccess("Linked.");
}

/**
 * Reconcile's Undo for an auto-link: unlink the two songs and stop syncs
 * from making that link again (`undoAutoLink`). Refused when the songs are
 * no longer linked to each other.
 */
export async function undoAutoLinkAction(
    _state: LinkActionState,
    formData: FormData
): Promise<LinkActionState> {
    await requireSession();
    const ids = readSongIds(formData);
    if (ids === null) {
        return formError(NOT_AN_ID_MESSAGE);
    }
    let result: ReturnType<typeof undoAutoLink>;
    try {
        result = undoAutoLink(ids.songId, ids.pcoSongId);
    } catch (error) {
        return failed(`undo the auto-link of catalog song ${ids.songId}`, error);
    }
    if (!result.ok) {
        return formError(result.message);
    }
    revalidateLinks();
    return formSuccess("Unlinked. The next sync will not link them again.");
}

/**
 * The song page's Unlink: unlink catalog song `songId` from Planning Center
 * song `pcoSongId`, which syncs then leave alone (`unlinkCatalogSong`).
 * Refused when the songs are no longer linked to each other.
 */
export async function unlinkSongAction(
    _state: LinkActionState,
    formData: FormData
): Promise<LinkActionState> {
    await requireSession();
    const ids = readSongIds(formData);
    if (ids === null) {
        return formError(NOT_AN_ID_MESSAGE);
    }
    let result: ReturnType<typeof unlinkCatalogSong>;
    try {
        result = unlinkCatalogSong(ids.songId, ids.pcoSongId);
    } catch (error) {
        return failed(`unlink catalog song ${ids.songId}`, error);
    }
    if (!result.ok) {
        return formError(result.message);
    }
    revalidateLinks();
    return formSuccess("Unlinked from Planning Center.");
}

/** The ignore and unignore actions: `change` the Planning Center song the form names. */
async function changeIgnored(
    formData: FormData,
    what: string,
    change: (pcoSongId: string) => { ok: true } | { ok: false; message: string },
    done: string
): Promise<LinkActionState> {
    await requireSession();
    const pcoSongId = readId(formData, "pcoSongId", parsePcoId);
    if (pcoSongId === null) {
        return formError(NOT_AN_ID_MESSAGE);
    }
    let result: ReturnType<typeof change>;
    try {
        result = change(pcoSongId);
    } catch (error) {
        return failed(`${what} Planning Center song ${pcoSongId}`, error);
    }
    if (!result.ok) {
        return formError(result.message);
    }
    revalidateLinks();
    return formSuccess(done);
}

/**
 * Reconcile's Ignore: set a Planning Center song aside as not hymnal
 * material (`ignorePcoSong`). Refused when it is linked to a catalog song.
 */
export async function ignorePcoSongAction(
    _state: LinkActionState,
    formData: FormData
): Promise<LinkActionState> {
    return changeIgnored(formData, "ignore", ignorePcoSong, "Ignored.");
}

/** Reconcile's Unignore: put an ignored Planning Center song back on the list (`unignorePcoSong`). */
export async function unignorePcoSongAction(
    _state: LinkActionState,
    formData: FormData
): Promise<LinkActionState> {
    return changeIgnored(formData, "unignore", unignorePcoSong, "Back on the list.");
}
