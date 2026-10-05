import type { CatalogRowRef, EditProblem, RenameOutcome } from "@/lib/db/catalogEdit";
import type { SongMarkKind } from "@/lib/domain";
import type { FieldError, FieldErrors, FormLink } from "@/lib/forms";
import { routes } from "@/lib/routes";

/**
 * What the song page's and the tune page's edit forms say: the errors their
 * actions give back, with links to what a refused change clashes with, and
 * the sentences that follow a save. Pure and safe on both sides: the
 * actions (`app/(app)/catalog/songs/[songId]/editActions.ts` and the tune
 * page's `actions.ts`) build their states with these, and the forms show
 * them.
 */

/** What a form says above its button when a field needs fixing. It does not say where the fields are, or their colour. */
export const FIX_MARKED_FIELDS_MESSAGE = "Nothing was changed. Fix what is marked, then try again.";

/** What a form says when the page asked for something that cannot be: an id that is not one, from a stale or tampered page. */
export const STALE_PAGE_MESSAGE = "This page asked for a change that cannot be made. Reload it and try again.";

/**
 * What a form says when its action never answered (the request failed, or
 * the session ended): the change may or may not have been made.
 */
export const NO_ANSWER_MESSAGE =
    "The server did not answer, so the change may or may not have been made. Reload the page to see the catalog as it is.";

/** A link to the catalog row a refusal is about: a song's page, a tune's or a book's. */
export function linkToCatalogRow(row: CatalogRowRef): FormLink {
    switch (row.kind) {
        case "song":
            return { href: routes.catalogSong(row.songId), label: row.label };
        case "tune":
            return { href: routes.catalogTune(row.tuneId), label: row.label };
        case "book":
            return { href: routes.catalogBook(row.code), label: row.label };
    }
}

/** A refused form as it shows: the sentence above its button, and the fields to mark. */
export interface FormRefusal<P extends string> {
    message: string;
    fieldErrors: FieldErrors<P>;
}

/**
 * A form's errors as it shows them. An error on a part the form shows as a
 * field (`fieldParts`) marks that field. Any other is about a hidden id
 * (the song, entry, hymn or tune the form is for): that one is not, or is
 * not in the catalog any more. It has no field to mark, so its message is
 * the form's own; otherwise the form's message asks for the marked fields
 * to be fixed.
 */
export function formRefusal<P extends string>(
    errors: FieldErrors<P>,
    fieldParts: readonly P[]
): FormRefusal<P> {
    const fieldErrors: FieldErrors<P> = {};
    let elsewhere: FieldError | undefined;
    for (const [part, error] of Object.entries(errors) as [P, FieldError | undefined][]) {
        if (error === undefined) {
            continue;
        }
        if (fieldParts.includes(part)) {
            fieldErrors[part] = error;
        } else {
            elsewhere ??= error;
        }
    }
    return { message: elsewhere?.message ?? FIX_MARKED_FIELDS_MESSAGE, fieldErrors };
}

/**
 * What the catalog refused, as the form shows it (`formRefusal`): the first
 * problem of each part, with a link to the row it clashes with, such as the
 * song that has the number.
 */
export function editRefusal<P extends string>(
    problems: readonly EditProblem<string, P>[],
    fieldParts: readonly P[]
): FormRefusal<P> {
    const errors: FieldErrors<P> = {};
    for (const { part, message, existing } of problems) {
        errors[part] ??= { message, ...(existing && { link: linkToCatalogRow(existing) }) };
    }
    return formRefusal(errors, fieldParts);
}

/** What a hymn's or a tune's names are called. */
export type NamedKind = "hymn" | "tune";

/** A hymn's title in quotes; a tune's name as it is written, in capitals. */
function named(kind: NamedKind, name: string): string {
    return kind === "hymn" ? `"${name}"` : name;
}

const OTHER_NAME: Readonly<Record<NamedKind, string>> = {
    hymn: "another title",
    tune: "another name",
};

/**
 * What the hymn's (or tune's) Save says: "Saved.", and what the rename did
 * to its other names. The old name stays as another one while a Planning
 * Center song is still matched by it, and another name that is the new name
 * now goes (see `editHymn`).
 */
export function describeNameSaved(kind: NamedKind, { aliasKept, aliasDropped }: RenameOutcome): string {
    const sentences = ["Saved."];
    if (aliasKept !== null) {
        sentences.push(
            kind === "hymn"
                ? `${named(kind, aliasKept)} stays as another title, since a Planning Center song is still titled so.`
                : `${named(kind, aliasKept)} stays as another name, since a Planning Center song's title still names it.`
        );
    }
    if (aliasDropped !== null) {
        sentences.push(
            kind === "hymn"
                ? `${named(kind, aliasDropped)} is no longer another title: it is the title now.`
                : `${named(kind, aliasDropped)} is no longer another name: it is the name now.`
        );
    }
    return sentences.join(" ");
}

/** 'Added "Rejoice! The Lord Is King" as another title.', "Added DARWAL as another name." */
export function describeAliasAdded(kind: NamedKind, alias: string): string {
    return `Added ${named(kind, alias)} as ${OTHER_NAME[kind]}.`;
}

/** 'Removed "Rejoice! The Lord Is King".' */
export function describeAliasRemoved(kind: NamedKind, alias: string): string {
    return `Removed ${named(kind, alias)}.`;
}

/** How each mark is said in a sentence: a song is marked "to learn". */
const MARK_PHRASES: Readonly<Record<SongMarkKind, string>> = { "to-learn": "to learn" };

/**
 * What Mark (and Save note) says: what the song is marked now, with its
 * note; or that it was marked so already, with that note.
 */
export function describeMarked(mark: SongMarkKind, changed: boolean, note: string | null): string {
    const phrase = MARK_PHRASES[mark];
    if (!changed) {
        return `Nothing changed: the song was marked ${phrase} with this note already.`;
    }
    return note === null ? `Marked ${phrase}.` : `Marked ${phrase}, with the note "${note}".`;
}

/** What Unmark says: that the mark is gone, or was not there. */
export function describeUnmarked(mark: SongMarkKind, changed: boolean): string {
    const phrase = MARK_PHRASES[mark];
    return changed ? `No longer marked ${phrase}.` : `The song was not marked ${phrase}.`;
}
