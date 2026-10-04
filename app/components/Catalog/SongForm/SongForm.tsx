"use client";

import type { Route } from "next";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createSongAction } from "@/app/(app)/catalog/songs/new/actions";
import SubmitButton from "@/app/components/ui/SubmitButton";
import type { HymnOption, TuneOption } from "@/lib/catalog/pickers";
import type { NewSongDraft, NewSongValues } from "@/lib/catalog/validation";
import { IDLE_FORM, fieldErrorOf, formStateKey } from "@/lib/forms";
import type { NewSongFormBook, NewSongPcoSong } from "@/lib/queries/catalogEdit";
import { routes } from "@/lib/routes";
import EntryFields from "./EntryFields";
import { FormNotice } from "./Fields";
import HymnFields from "./HymnFields";
import PcoSongNotice from "./PcoSongNotice";
import TuneFields from "./TuneFields";

interface SongFormProps {
    /** Every hymn, by title. */
    hymns: HymnOption[];
    /** Every tune, by name. */
    tunes: TuneOption[];
    /** The active books, in book order. */
    books: NewSongFormBook[];
    /** What the form starts with. */
    draft: NewSongDraft;
    /** The Planning Center song the form was opened for, or null. */
    pcoSong: NewSongPcoSong | null;
    /** True when the form was opened for a Planning Center song that Planning Center does not have. */
    pcoSongMissing: boolean;
    /** Where to go back to after adding the song, or on Cancel: a path `safeCallbackUrl` accepted, or null. */
    returnTo: string | null;
}

/**
 * The new-song form: the hymn, the tune, an optional first entry, and the
 * link to the Planning Center song it was opened for (when that song can be
 * linked). Its action (`createSongAction`) adds the song and redirects; a
 * refusal comes back through `useActionState` and shows on the part it is
 * about, with a summary above.
 *
 * What it posts is kept in state, so the parts that show and hide keep what
 * was typed; the hidden fields carry the modes and chosen ids. Pending
 * state is the submit button's `useFormStatus`.
 */
export default function SongForm({
    hymns,
    tunes,
    books,
    draft,
    pcoSong,
    pcoSongMissing,
    returnTo,
}: SongFormProps) {
    const [state, formAction] = useActionState(createSongAction, IDLE_FORM);
    const [values, setValues] = useState<NewSongValues>(draft.values);
    const [hymnSearch, setHymnSearch] = useState(draft.hymnSearch);
    const [tuneSearch, setTuneSearch] = useState(draft.tuneSearch);
    const linkable = pcoSong !== null && pcoSong.linkedTo === null && !pcoSong.removed;

    function change(changes: Partial<NewSongValues>) {
        setValues((current) => ({ ...current, ...changes }));
    }

    return (
        <form
            action={formAction}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6 space-y-6"
        >
            <input type="hidden" name="pcoSongId" value={linkable ? pcoSong.id : ""} />
            <input type="hidden" name="returnTo" value={returnTo ?? ""} />
            {state.status === "error" && (
                // A new key per attempt, so a refusal repeated word for word
                // is a new alert, which screen readers announce again.
                <p
                    key={formStateKey(state)}
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                >
                    {state.message}
                </p>
            )}
            {pcoSong && <PcoSongNotice pcoSong={pcoSong} error={fieldErrorOf(state, "link")} />}
            {pcoSongMissing && (
                <FormNotice tone="warning">
                    <p>
                        Planning Center has no such song, so the new song will not be linked to
                        one.
                    </p>
                </FormNotice>
            )}
            <HymnFields
                hymns={hymns}
                values={values}
                onChange={change}
                search={hymnSearch}
                onSearchChange={setHymnSearch}
                error={fieldErrorOf(state, "hymn")}
            />
            <hr className="border-gray-200 dark:border-gray-700" />
            <TuneFields
                tunes={tunes}
                values={values}
                onChange={change}
                search={tuneSearch}
                onSearchChange={setTuneSearch}
                error={fieldErrorOf(state, "tune")}
            />
            <hr className="border-gray-200 dark:border-gray-700" />
            <EntryFields
                books={books}
                values={values}
                onChange={change}
                error={fieldErrorOf(state, "entry")}
            />
            <div className="flex flex-col-reverse gap-3 border-t border-gray-200 dark:border-gray-700 pt-5 sm:flex-row sm:justify-end">
                {/* A path from the URL cannot be checked against the route table;
                    safeCallbackUrl has made sure it is a path on this site. */}
                <Link
                    href={(returnTo ?? routes.catalog()) as Route}
                    className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                >
                    Cancel
                </Link>
                <SubmitButton pendingLabel="Adding the song…">Add song</SubmitButton>
            </div>
        </form>
    );
}
