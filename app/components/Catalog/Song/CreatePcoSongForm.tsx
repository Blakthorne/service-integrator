"use client";

import { useRef, useState, type FormEvent } from "react";
import {
    createInPlanningCenterAction,
    type CreateInPlanningCenterState,
} from "@/app/(app)/catalog/songs/[songId]/actions";
import Dialog from "@/app/components/ui/Dialog";
import { hasCreditNameProblems, previewCredits } from "@/lib/catalog/creditsEditor";
import {
    CCLI_SONG_NUMBER_HINT,
    NEW_PCO_SONG_COPYRIGHT_HINT,
    NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH,
    NEW_PCO_SONG_CREDITS_HINT,
    NEW_PCO_SONG_TITLE_MAX_LENGTH,
    USE_CCLI_DETAILS_HINT,
    checkNewPcoSongFields,
    newPcoSongFields,
    newPcoSongSummary,
    type CheckedNewPcoSong,
    type NewPcoSongFieldErrors,
    type NewPcoSongFields,
} from "@/lib/catalog/newPcoSong";
import { formStateKey } from "@/lib/forms";
import type { NewPcoSongField } from "@/lib/queries/pcoSongs";
import type { CreditSettings } from "@/lib/settings";
import { FieldErrorText, HINT_CLASS, LABEL_CLASS, TextField } from "../SongForm/Fields";
import CreditNamesEditor from "./CreditNamesEditor";
import CreditsPreviewBox, { Sample } from "./CreditsPreviewBox";
import PendingButton from "./PendingButton";
import { ALERT_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, primaryButtonState } from "./styles";

/** A song Planning Center now has, as the action said. */
export type CreatedPcoSong = Extract<CreateInPlanningCenterState, { ok: true }>;

/** What the form says above its button when a part needs fixing; the parts say what. */
const FIX_PARTS_MESSAGE = "Nothing was sent. Fix the parts marked above, then try again.";

/**
 * What the form says when its action never answered: the song may exist,
 * and creating it again would make a second one.
 */
const CREATE_NO_ANSWER =
    "The server did not answer, so it is not known whether the song was created in Planning Center. Look for it there, or on Reconcile after the next sync, before trying again, so that it is not created twice.";

/** The id of a part's error text. */
function errorId(part: NewPcoSongField): string {
    return `new-pco-song-${part}-error`;
}

interface CreateConfirmationProps {
    song: CheckedNewPcoSong;
    pending: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/** The dialog's body: what Planning Center will get, then Cancel and Create song. */
function CreateConfirmation({ song, pending, onCancel, onConfirm }: CreateConfirmationProps) {
    return (
        <>
            <dl className="space-y-2">
                {newPcoSongSummary(song).map((line) => (
                    <div key={line.label}>
                        <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{line.label}</dt>
                        <dd className="text-sm">
                            <Sample>{line.value}</Sample>
                        </dd>
                    </div>
                ))}
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                    type="button"
                    onClick={() => {
                        if (!pending) {
                            onCancel();
                        }
                    }}
                    aria-disabled={pending}
                    className={SECONDARY_BUTTON_CLASS}
                >
                    Cancel
                </button>
                <PendingButton pending={pending} pendingLabel="Creating…" onClick={onConfirm}>
                    Create song
                </PendingButton>
            </div>
        </>
    );
}

interface CreatePcoSongFormProps {
    /** The catalog song to create. */
    songId: number;
    /** The title the form starts with (`pcoSongTitleFor`). */
    title: string;
    /** The credit roles and their phrases, from the settings. */
    settings: CreditSettings;
    /**
     * Called once Planning Center has the song: the Planning Center card
     * says so from then on, and hides this form, so the song is never
     * created twice.
     */
    onCreated: (created: CreatedPcoSong) => void;
}

/**
 * "Create in Planning Center", on the Planning Center card of a song with
 * no Planning Center song: the title (the hymn's, with the tune when the
 * hymn is sung to several), the credits by role with a live preview, the
 * copyright and an optional CCLI number, with "Use CCLI's details" and
 * what it does.
 *
 * "Create in Planning Center…" checks the form first, marking every part
 * that needs fixing (`checkNewPcoSongFields`), then asks to confirm in a
 * dialog that shows exactly what Planning Center will get. Create song
 * calls `createInPlanningCenterAction` from its click, with its pending
 * state in `useState` (convention 15); the dialog cannot be dismissed while
 * it runs, though the browser may still close it (Chromium lets a third
 * Escape through), and then the create goes on. A refusal or a failure
 * closes the dialog, so focus is back on the button, and shows above it in
 * an alert keyed per attempt, marking the part it is about. Once the song
 * exists, `onCreated` hands over to the card.
 */
export default function CreatePcoSongForm({ songId, title, settings, onCreated }: CreatePcoSongFormProps) {
    const roles = settings.creditRoles;
    const [fields, setFields] = useState<NewPcoSongFields>(() => newPcoSongFields(title, roles));
    const [fieldErrors, setFieldErrors] = useState<NewPcoSongFieldErrors>({});
    /** What the form says above its button; a new object per attempt keys its alert. */
    const [failure, setFailure] = useState<{ message: string } | null>(null);
    /** The song the dialog asks to confirm; null while it is closed. */
    const [confirming, setConfirming] = useState<CheckedNewPcoSong | null>(null);
    const [pending, setPending] = useState(false);
    // Read by the click, which may come again before a render shows `pending`.
    const creating = useRef(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const preview = previewCredits(fields.credits, settings);
    const namesMarked = hasCreditNameProblems(fields.credits, roles);

    function update(changes: Partial<NewPcoSongFields>) {
        if (!creating.current) {
            setFields((current) => ({ ...current, ...changes }));
        }
    }

    function review(event: FormEvent<HTMLFormElement>) {
        // The browser's own submit would load a page.
        event.preventDefault();
        if (creating.current) {
            return;
        }
        const check = checkNewPcoSongFields(fields, roles);
        if (!check.ok) {
            setFieldErrors(check.fieldErrors);
            setFailure({ message: FIX_PARTS_MESSAGE });
            return;
        }
        setFieldErrors({});
        setFailure(null);
        setConfirming(check.song);
    }

    async function create(song: CheckedNewPcoSong) {
        if (creating.current) {
            return;
        }
        creating.current = true;
        setPending(true);
        let result: CreateInPlanningCenterState;
        try {
            result = await createInPlanningCenterAction(String(songId), {
                title: song.title,
                credits: song.credits,
                copyright: song.copyright,
                ccliNumber: song.ccliNumber === null ? "" : String(song.ccliNumber),
                useCcliDetails: song.useCcliDetails,
            });
        } catch (error) {
            console.error("Creating the song in Planning Center failed:", error);
            result = { ok: false, message: CREATE_NO_ANSWER };
        }
        if (result.ok) {
            // The card hides the form now. Until it does, it stays locked:
            // a second create would make a second song.
            onCreated(result);
            return;
        }
        creating.current = false;
        setPending(false);
        setConfirming(null);
        setFailure({ message: result.field ? FIX_PARTS_MESSAGE : result.message });
        setFieldErrors(result.field ? { [result.field]: result.message } : {});
    }

    const fieldError = (part: NewPcoSongField) => {
        const message = fieldErrors[part];
        if (message === undefined) {
            return undefined;
        }
        // A marked name says what is wrong with it, so the part's error only points at it.
        return { message: part === "credits" && namesMarked ? "Fix the names marked above." : message };
    };

    return (
        <>
            <form onSubmit={review} className="space-y-5" aria-labelledby="create-pco-song-heading">
                <div>
                    <h3 id="create-pco-song-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Create in Planning Center
                    </h3>
                    <p className={`mt-1 ${HINT_CLASS}`}>
                        Adds this song to the church&apos;s Planning Center library and links it here. The app
                        cannot delete it again: that is done in Planning Center.
                    </p>
                </div>
                <div className="space-y-1">
                    <TextField
                        id="new-pco-song-title"
                        name="title"
                        label="Title"
                        value={fields.title}
                        onChange={(value) => update({ title: value })}
                        hint="As Planning Center lists the song. A hymn sung to several tunes gets the tune in parentheses."
                        errorId={fieldErrors.title ? errorId("title") : undefined}
                        maxLength={NEW_PCO_SONG_TITLE_MAX_LENGTH}
                    />
                    <FieldErrorText id={errorId("title")} error={fieldError("title")} />
                </div>
                <div role="group" aria-labelledby="new-pco-song-credits-label" className="space-y-3">
                    <div>
                        <span id="new-pco-song-credits-label" className={LABEL_CLASS}>
                            Credits
                        </span>
                        <p className={HINT_CLASS}>{NEW_PCO_SONG_CREDITS_HINT}</p>
                    </div>
                    <CreditNamesEditor
                        idPrefix="new-pco-song-credits"
                        rows={fields.credits}
                        roles={roles}
                        onChange={(rows) => update({ credits: rows })}
                        readOnly={pending}
                    />
                    <CreditsPreviewBox
                    preview={preview}
                    authorId="new-pco-song-author"
                    namesMarked={namesMarked}
                />
                    <FieldErrorText id={errorId("credits")} error={fieldError("credits")} />
                </div>
                <div className="space-y-1">
                    <TextField
                        id="new-pco-song-copyright"
                        name="copyright"
                        label="Copyright"
                        value={fields.copyright}
                        onChange={(value) => update({ copyright: value })}
                        hint={NEW_PCO_SONG_COPYRIGHT_HINT}
                        errorId={fieldErrors.copyright ? errorId("copyright") : undefined}
                        maxLength={NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH}
                    />
                    <FieldErrorText id={errorId("copyright")} error={fieldError("copyright")} />
                </div>
                <div className="space-y-1">
                    <TextField
                        id="new-pco-song-ccli"
                        name="ccliNumber"
                        label="CCLI song number"
                        value={fields.ccliNumber}
                        onChange={(value) => update({ ccliNumber: value })}
                        hint={CCLI_SONG_NUMBER_HINT}
                        errorId={fieldErrors.ccliNumber ? errorId("ccliNumber") : undefined}
                        inputMode="numeric"
                    />
                    <FieldErrorText id={errorId("ccliNumber")} error={fieldError("ccliNumber")} />
                    <label className="mt-2 flex items-start gap-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                        <input
                            type="checkbox"
                            checked={fields.useCcliDetails}
                            onChange={(event) => update({ useCcliDetails: event.target.checked })}
                            aria-describedby="new-pco-song-use-ccli-hint"
                            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-blue-600"
                        />
                        <span>Use CCLI&apos;s details</span>
                    </label>
                    <p id="new-pco-song-use-ccli-hint" className={`pl-7 ${HINT_CLASS}`}>
                        {USE_CCLI_DETAILS_HINT}
                    </p>
                </div>
                {failure && (
                    // A new key per attempt: a repeated refusal is announced again.
                    <p key={formStateKey(failure)} role="alert" className={ALERT_CLASS}>
                        {failure.message}
                    </p>
                )}
                <button ref={buttonRef} type="submit" className={`${PRIMARY_BUTTON_CLASS} ${primaryButtonState(false)}`}>
                    Create in Planning Center…
                </button>
            </form>
            <Dialog
                open={confirming !== null}
                // The dialog has closed, however it closed (see `ui/Dialog`), so
                // the state always follows. A create still running goes on, and
                // its outcome shows on the card, not in the dialog.
                onClose={() => setConfirming(null)}
                title="Create this song in Planning Center?"
                description="Planning Center gets the song below, and this catalog song is linked to it. The app cannot delete it again."
                returnFocusRef={buttonRef}
                dismissible={!pending}
            >
                <p role="status" className={pending ? HINT_CLASS : "sr-only"}>
                    {pending ? "Creating the song in Planning Center…" : ""}
                </p>
                {confirming && (
                    <CreateConfirmation
                        song={confirming}
                        pending={pending}
                        onCancel={() => setConfirming(null)}
                        onConfirm={() => void create(confirming)}
                    />
                )}
            </Dialog>
        </>
    );
}
