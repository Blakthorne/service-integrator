"use client";

import { useEffect, useRef, useState } from "react";
import {
    markSongAction,
    unmarkSongAction,
    type SongMarkFormState,
} from "@/app/(app)/catalog/songs/[songId]/editActions";
import LocalTime from "@/app/components/ui/LocalTime";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import { MARK_NOTE_MAX_LENGTH } from "@/lib/catalog/validation";
import type { SongMark } from "@/lib/domain";
import { fieldErrorOf } from "@/lib/forms";
import CatalogCard from "../CatalogCard";
import { EditTextField, FormAlert, PendingSubmit, StatusLine } from "./EditFields";
import { useEditForm } from "./useEditForm";

/** When a mark was made: the day, in the viewer's zone. */
const MARKED_ON = { year: "numeric", month: "short", day: "numeric" } as const;

interface ToLearnCardProps {
    songId: number;
    /** The song's "to-learn" mark, with its note; null when it has none. */
    mark: SongMark | null;
}

/**
 * The "to learn" shelf, on a song's page: whether the song is marked to
 * learn (a song to introduce), since when and with what note, then the
 * note's field and "Mark to learn" (or, once marked, "Save note" and
 * "Unmark"). The songs list's To learn filter lists every song marked so.
 *
 * Each is called from `onSubmit` or a click with its state in `useState`
 * (convention 15), and says what it did in the status region. The note is
 * this card's state, so a revalidation never replaces what is being
 * typed. Unmark takes its button away, so it hands focus to the main
 * button, which Mark to learn keeps.
 */
export default function ToLearnCard({ songId, mark }: ToLearnCardProps) {
    const [note, setNote] = useState(mark?.note ?? "");
    /** True once the note changed after the last response, whose words may no longer be true. */
    const [edited, setEdited] = useState(false);
    const mainButtonRef = useRef<HTMLButtonElement>(null);
    /** Set by Unmark: focus goes to the main button once the page shows the song unmarked. */
    const focusMain = useRef(false);
    const marked = mark !== null;

    const onDone = (state: SongMarkFormState) => {
        if (state.status === "success") {
            setNote(state.values.note ?? "");
            setEdited(false);
        }
    };
    const markForm = useEditForm(markSongAction, onDone);
    const unmarkForm = useEditForm(unmarkSongAction, (state) => {
        onDone(state);
        focusMain.current = state.status === "success";
    });
    const pending = markForm.pending || unmarkForm.pending;
    const last = latest(markForm.state, unmarkForm.state);
    const status = !pending && !edited && last.status === "success" ? last.message : "";

    useEffect(() => {
        if (focusMain.current && !marked) {
            focusMain.current = false;
            mainButtonRef.current?.focus();
        }
    }, [marked]);

    return (
        <CatalogCard title="To learn" headingId="to-learn-heading">
            <form
                onSubmit={(event) => {
                    unmarkForm.reset();
                    markForm.onSubmit(event);
                }}
                className="space-y-4"
            >
                <p className="text-gray-700 dark:text-gray-300">
                    {marked ? (
                        <>
                            Marked to learn on <LocalTime iso={mark.createdAt} options={MARKED_ON} />.
                        </>
                    ) : (
                        "Not marked. Mark a song to introduce, and the songs list's To learn filter will list it."
                    )}
                </p>
                <input type="hidden" name="songId" value={songId} />
                <input type="hidden" name="mark" value="to-learn" />
                <EditTextField
                    id="to-learn-note"
                    name="note"
                    label="Note"
                    hint="Optional, such as For Advent, or Teach the choir first."
                    value={note}
                    onChange={(value) => {
                        if (!pending) {
                            setNote(value);
                            setEdited(true);
                        }
                    }}
                    error={fieldErrorOf(markForm.state, "note")}
                    readOnly={pending}
                    maxLength={MARK_NOTE_MAX_LENGTH}
                />
                <FormAlert state={markForm.state} />
                <FormAlert state={unmarkForm.state} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <PendingSubmit
                        pending={markForm.pending}
                        pendingLabel={marked ? "Saving…" : "Marking…"}
                        buttonRef={mainButtonRef}
                    >
                        {marked ? "Save note" : "Mark to learn"}
                    </PendingSubmit>
                    {marked && (
                        <button
                            type="button"
                            aria-disabled={pending}
                            onClick={() => {
                                if (pending) {
                                    return;
                                }
                                markForm.reset();
                                const formData = new FormData();
                                formData.set("songId", String(songId));
                                formData.set("mark", "to-learn");
                                void unmarkForm.submit(formData);
                            }}
                            className={buttonClasses("secondary", pending)}
                        >
                            {unmarkForm.pending ? "Unmarking…" : "Unmark"}
                        </button>
                    )}
                    <StatusLine text={status} />
                </div>
            </form>
        </CatalogCard>
    );
}

/** The response of whichever form answered last: the other was reset when it was used. */
function latest(a: SongMarkFormState, b: SongMarkFormState): SongMarkFormState {
    return a.status !== "idle" ? a : b;
}
