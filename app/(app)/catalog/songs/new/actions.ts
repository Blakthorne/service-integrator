"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
    NEW_SONG_FIELDS,
    validateNewSong,
    type NewSongPart,
} from "@/lib/catalog/validation";
import {
    FORM_FAILURE_MESSAGE,
    formError,
    readValues,
    type FieldErrors,
    type FormLink,
    type FormState,
    type FormValues,
} from "@/lib/forms";
import { parsePcoId } from "@/lib/pco";
import {
    createSong,
    getNewSongBooks,
    type CreateSongResult,
    type ExistingRow,
} from "@/lib/queries/catalogEdit";
import { routes } from "@/lib/routes";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";

/**
 * Where the new-song form stands: its parts' errors, and "link" for the
 * link to the Planning Center song it was opened for. It never succeeds
 * here: a song that is added redirects.
 */
export type NewSongFormState = FormState<NewSongPart | "link">;

/** What the form says above its fields when one of them needs fixing. */
const FIX_FIELDS_MESSAGE = "The song was not added. Fix what is marked below, then try again.";

/** What the form says when its Planning Center song is not one: a stale or tampered form. */
const NO_SUCH_PCO_SONG_MESSAGE =
    "The song was not added: the Planning Center song this form was opened for does not exist. Open the form again.";

/**
 * A server action is a public POST endpoint, so it checks the session
 * itself rather than relying on the middleware (convention 15), and throws
 * without one.
 */
async function requireSession(): Promise<void> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
}

/** A link to the row a problem is about: a song's page or a tune's. */
function linkTo(existing: ExistingRow): FormLink {
    return existing.kind === "song"
        ? { href: routes.catalogSong(existing.songId), label: existing.label }
        : { href: routes.catalogTune(existing.tuneId), label: existing.label };
}

/** The form's errors for the problems the catalog found: the first for each part. */
function problemErrors(
    result: Extract<CreateSongResult, { ok: false }>
): FieldErrors<NewSongPart | "link"> {
    const fieldErrors: FieldErrors<NewSongPart | "link"> = {};
    for (const { part, message, existing } of result.problems) {
        fieldErrors[part ?? "link"] ??= {
            message,
            ...(existing && { link: linkTo(existing) }),
        };
    }
    return fieldErrors;
}

/** Log a failure nobody expected, and give the form the generic message. */
function failed(what: string, error: unknown, values: FormValues): NewSongFormState {
    console.error(`Failed to ${what}:`, error);
    return formError(FORM_FAILURE_MESSAGE, { values });
}

/** A path without its query or fragment, as `revalidatePath` takes it. */
function pathOf(url: string): string {
    return url.split(/[?#]/, 1)[0];
}

/**
 * The new-song form's action: check the session, read and check the
 * fields (`validateNewSong`, against the active books), then add the song
 * with its hymn, tune, first entry and link to the form's Planning Center
 * song in one transaction (`createSong`). A field that needs fixing, or a
 * problem the catalog finds (a title or number taken, a song that exists),
 * comes back as an error on its part of the form, with a link to what
 * exists; a refused link comes back as "link", with the song that holds it.
 *
 * On success it revalidates the catalog's pages, the plan pages (a new link
 * gives them numbers, and a new song can be a suggestion) and the page it
 * returns to, then redirects there: to `returnTo` when the form has one
 * that `safeCallbackUrl` accepts, else to the new song's page.
 */
export async function createSongAction(
    _state: NewSongFormState,
    formData: FormData
): Promise<NewSongFormState> {
    await requireSession();
    const values = readValues(formData, NEW_SONG_FIELDS);

    const rawPcoSongId = formData.get("pcoSongId") ?? "";
    const pcoSongId = rawPcoSongId === "" ? null : parsePcoId(rawPcoSongId);
    if (rawPcoSongId !== "" && pcoSongId === null) {
        return formError(NO_SUCH_PCO_SONG_MESSAGE, { values });
    }
    const returnTo = safeCallbackUrl(formData.get("returnTo"));

    let books: ReturnType<typeof getNewSongBooks>;
    try {
        books = getNewSongBooks();
    } catch (error) {
        return failed("read the catalog's books", error, values);
    }
    const checked = validateNewSong(formData, books);
    if (!checked.ok) {
        return formError(FIX_FIELDS_MESSAGE, { fieldErrors: checked.fieldErrors, values });
    }

    let result: CreateSongResult;
    try {
        result = await createSong({ ...checked.input, pcoSongId });
    } catch (error) {
        return failed("add a catalog song", error, values);
    }
    if (!result.ok) {
        return formError(FIX_FIELDS_MESSAGE, { fieldErrors: problemErrors(result), values });
    }

    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    if (returnTo !== null) {
        revalidatePath(pathOf(returnTo));
    }
    // redirect() throws, so it stays outside every try block. A path from
    // the form cannot be checked against the route table; safeCallbackUrl
    // has made sure it is a path on this site.
    redirect((returnTo ?? routes.catalogSong(result.songId)) as Route);
}
