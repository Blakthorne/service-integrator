"use client";

import { useRef, useState } from "react";
import {
    saveSongCreditsAction,
    type SaveSongCreditsState,
} from "@/app/(app)/catalog/songs/[songId]/actions";
import {
    CREDITS_NO_ANSWER,
    CREDIT_STATUS_LABELS,
    FIX_MARKED_NAMES_MESSAGE,
    NO_CREDITS_MESSAGE,
    creditRows,
    describeCreditsDraft,
    describeCreditsSave,
    draftCredits,
    hasCreditNameProblems,
    previewCredits,
    sameCredits,
    type CreditNamesRow,
} from "@/lib/catalog/creditsEditor";
import type { Credit, CreditParseStatus } from "@/lib/domain";
import { formStateKey } from "@/lib/forms";
import type { CreditSettings } from "@/lib/settings";
import CatalogCard, { CardField, NoValue } from "../CatalogCard";
import { HINT_CLASS } from "../SongForm/Fields";
import CreditNamesEditor from "./CreditNamesEditor";
import CreditsPreviewBox from "./CreditsPreviewBox";
import PendingButton from "./PendingButton";
import { ALERT_CLASS, DONE_CLASS, WARNING_CLASS } from "./styles";

/** The id of the line that says what the author will be, which describes Save. */
const AUTHOR_PREVIEW_ID = "song-credits-author";

/** Each status's tag colours; the tag's words say the same, so colour is never the only sign. */
const STATUS_TAG_CLASSES: Readonly<Record<CreditParseStatus, string>> = {
    ok: "bg-green-50 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900",
    legacy: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    unparsed: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
};

/** How the song's author reads, as a small tag. */
function StatusTag({ status }: { status: CreditParseStatus }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TAG_CLASSES[status]}`}
        >
            {CREDIT_STATUS_LABELS[status]}
        </span>
    );
}

interface CreditsCardProps {
    /** The linked Planning Center song's id. */
    pcoSongId: string;
    /** Its author as the app's copy of the library has it. */
    author: string | null;
    /** The credit roles and their phrases, from the settings. */
    settings: CreditSettings;
    /** False for a song deleted from Planning Center: its credits are shown, and cannot be saved. */
    editable: boolean;
}

/**
 * The Credits card of a song linked to Planning Center: the song's author
 * as Planning Center has it and how it reads (labelled, not labelled yet,
 * or with labels the app cannot read), then the credit editor, a row of
 * names for each credit role, with a live preview of the credit line the
 * copyright text will print and of the exact author Planning Center will
 * be sent, and Save.
 *
 * The editor starts from the author: its credits when it is labelled; the
 * guided split of one that is not, which is how the copyright text reads
 * it now; for one whose labels do not parse, the groups that do, with the
 * others listed to place by hand (`draftCredits`).
 *
 * Only Save writes, never Enter in a field: it calls `saveSongCreditsAction`
 * from its click, with its pending state in `useState` (convention 15),
 * then says what Planning Center's author is now, or why nothing was
 * saved, in an alert keyed per attempt. Focus stays on Save. The fields
 * are this card's state: a revalidation updates the author above them and
 * never what is being typed. Once a save succeeds they hold what
 * Planning Center has now, and "Saved." stays until they change.
 */
export default function CreditsCard({ pcoSongId, author, settings, editable }: CreditsCardProps) {
    const roles = settings.creditRoles;
    const current = draftCredits(author, roles);
    const [rows, setRows] = useState<CreditNamesRow[]>(() => current.rows);
    /** The groups the guided split could not place, from the author the editor started from. */
    const [unplaced] = useState(() => current.unplaced);
    const [result, setResult] = useState<SaveSongCreditsState | null>(null);
    /** The credits the last save left in Planning Center, while "Saved." is true. */
    const [savedCredits, setSavedCredits] = useState<Credit[] | null>(null);
    const [pending, setPending] = useState(false);
    // Read by the click, which may come again before a render shows `pending`.
    const saving = useRef(false);

    const preview = previewCredits(rows, settings);
    const namesMarked = hasCreditNameProblems(rows, roles);
    const saved =
        result?.ok === true &&
        savedCredits !== null &&
        preview.ok &&
        sameCredits(preview.credits, savedCredits);
    const unchanged = preview.ok && preview.credits.length > 0 && preview.author === (author ?? "");

    async function save() {
        if (saving.current) {
            return;
        }
        const check = previewCredits(rows, settings);
        if (!check.ok) {
            // A marked name says what is wrong with it; anything else is said here.
            setResult({ ok: false, message: namesMarked ? FIX_MARKED_NAMES_MESSAGE : check.message });
            return;
        }
        if (check.credits.length === 0) {
            setResult({ ok: false, message: NO_CREDITS_MESSAGE });
            return;
        }
        saving.current = true;
        setPending(true);
        try {
            const next = await saveSongCreditsAction(pcoSongId, check.credits);
            setResult(next);
            if (next.ok) {
                const stored = next.credits.status === "ok" ? next.credits.credits : check.credits;
                setRows(creditRows(stored, roles));
                setSavedCredits(stored);
            }
        } catch (error) {
            console.error("Saving the credits failed:", error);
            setResult({ ok: false, message: CREDITS_NO_ANSWER });
        } finally {
            saving.current = false;
            setPending(false);
        }
    }

    return (
        <CatalogCard title="Credits" headingId="credits-heading">
            <div className="space-y-4">
                <dl>
                    <CardField label="In Planning Center">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="break-words">
                                {author?.trim() ? author : <NoValue>No author</NoValue>}
                            </span>
                            <StatusTag status={current.status} />
                        </span>
                    </CardField>
                </dl>
                {editable ? (
                    <>
                        <p className={HINT_CLASS}>{describeCreditsDraft(current, author, roles)}</p>
                        {unplaced.length > 0 && current.status === "unparsed" && (
                            <div className={WARNING_CLASS}>
                                <p>Not placed: put each of these under its role.</p>
                                <ul className="mt-1 list-disc pl-5">
                                    {unplaced.map((group) => (
                                        <li key={group} className="break-words">
                                            {group}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <CreditNamesEditor
                            idPrefix="song-credits"
                            rows={rows}
                            roles={roles}
                            onChange={setRows}
                            readOnly={pending}
                        />
                        <CreditsPreviewBox
                            preview={preview}
                            authorId={AUTHOR_PREVIEW_ID}
                            emptyMessage={NO_CREDITS_MESSAGE}
                            namesMarked={namesMarked}
                        />
                        {result?.ok === false && (
                            // A new key per attempt: a repeated refusal is announced again.
                            <p key={formStateKey(result)} role="alert" className={ALERT_CLASS}>
                                {result.message}
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <PendingButton
                                pending={pending}
                                pendingLabel="Saving…"
                                onClick={() => void save()}
                                describedBy={AUTHOR_PREVIEW_ID}
                            >
                                Save credits
                            </PendingButton>
                            {saved && result?.ok === true ? (
                                <p key={formStateKey(result)} role="status" className={DONE_CLASS}>
                                    {describeCreditsSave(result)}
                                </p>
                            ) : (
                                unchanged &&
                                !pending && (
                                    <p className={HINT_CLASS}>Planning Center already has these credits.</p>
                                )
                            )}
                        </div>
                    </>
                ) : (
                    <p className={WARNING_CLASS}>
                        This song was deleted from Planning Center, so its credits cannot be changed here.
                    </p>
                )}
            </div>
        </CatalogCard>
    );
}
