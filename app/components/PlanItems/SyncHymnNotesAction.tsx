"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
    previewHymnNotesAction,
    syncHymnNotesAction,
    type PreviewHymnNotesState,
    type SyncHymnNotesState,
} from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
import Dialog from "@/app/components/ui/Dialog";
import type { HymnNoteStatus } from "@/lib/hymnNotes";
import {
    MISSING_CATEGORY_HELP,
    confirmLabel,
    previewRows,
    previewSummary,
    resultRows,
    resultSummary,
    writesToMake,
    type HymnNoteLine,
    type HymnNoteLineKind,
    type HymnNoteRow,
} from "@/lib/hymnNoteText";
import { routes } from "@/lib/routes";

/** A preview that found the category: each song item's diff. */
type ReadyStatus = Extract<HymnNoteStatus, { kind: "ready" }>;

/** Where the dialog is: reading the preview, showing it, writing, or showing what was written. */
type SyncDialogState =
    | { phase: "previewing" }
    | { phase: "preview"; result: PreviewHymnNotesState }
    | { phase: "syncing"; status: ReadyStatus }
    | { phase: "results"; result: SyncHymnNotesState };

/** Shown when the preview's action never answered: the network failed, or the session ended. */
const PREVIEW_NO_ANSWER: PreviewHymnNotesState = {
    ok: false,
    message: "The server did not answer, so the notes could not be compared. Reload the page and try again.",
};

/**
 * Shown when the sync's action never answered. Planning Center may have
 * taken some of the writes, so it says to look before trying again.
 */
const SYNC_NO_ANSWER: SyncHymnNotesState = {
    ok: false,
    kind: "failed",
    message:
        "The server did not answer, so it is not known which notes were written. Reload the page, then preview again.",
};

/** What the dialog's status line says while an action runs. */
const PENDING_TEXT: Partial<Record<SyncDialogState["phase"], string>> = {
    previewing: "Reading the plan's notes from Planning Center…",
    syncing: "Writing the notes to Planning Center…",
};

/** Each line's tag colours; the tag's words say the same, so colour is never the only sign. */
const TAG_CLASSES: Readonly<Record<HymnNoteLineKind, string>> = {
    add: "bg-green-50 text-green-800 ring-green-200 dark:bg-green-950 dark:text-green-200 dark:ring-green-900",
    change: "bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900",
    remove: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
    failed: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
    "in-sync":
        "bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700",
    "left-alone":
        "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
    "no-note":
        "bg-gray-50 text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700",
};

const PRIMARY_BUTTON_CLASS =
    "px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors";

const SECONDARY_BUTTON_CLASS =
    "px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed";

const LINK_CLASS =
    "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline";

/** One line of a row: its tag, then the note's words, old to new for a change, and why. */
function NoteLine({ line }: { line: HymnNoteLine }) {
    return (
        <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${
                    TAG_CLASSES[line.kind]
                }`}
            >
                {line.label}
            </span>
            <span className="min-w-0 break-words text-gray-900 dark:text-gray-100">
                {line.from !== null && (
                    <>
                        <span className="text-gray-600 dark:text-gray-400">{line.from}</span>
                        <span aria-hidden="true"> → </span>
                        <span className="sr-only"> to </span>
                    </>
                )}
                {line.text}
                {line.why !== null && (
                    <span className="text-gray-600 dark:text-gray-400"> ({line.why})</span>
                )}
            </span>
        </li>
    );
}

/** A row per song item: its title, and a line for each of its notes. */
function NoteRows({ rows, label }: { rows: readonly HymnNoteRow[]; label: string }) {
    if (rows.length === 0) {
        return null;
    }
    return (
        <ul
            aria-label={label}
            className="mt-3 divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700"
        >
            {rows.map((row) => (
                <li key={row.itemId} className="px-3 py-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{row.title}</p>
                    <ul className="mt-1 space-y-1">
                        {row.lines.map((noteLine, i) => (
                            <NoteLine key={i} line={noteLine} />
                        ))}
                    </ul>
                </li>
            ))}
        </ul>
    );
}

/** Under a missing category's message: how to fix it, and where its name is set. */
function MissingCategoryHelp() {
    return (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            {MISSING_CATEGORY_HELP}{" "}
            {/* prefetch={false}: Settings reads every service type's categories from Planning Center. */}
            <Link href={routes.settings()} prefetch={false} className={LINK_CLASS}>
                Hymnal note settings
            </Link>
        </p>
    );
}

/** The buttons along the bottom of the dialog. */
function Buttons({ children }: { children: React.ReactNode }) {
    return <div className="mt-5 flex flex-wrap justify-end gap-3">{children}</div>;
}

interface SyncHymnNotesActionProps {
    serviceTypeId: string;
    planId: string;
}

/**
 * The plan header's "Sync hymn notes": a button that opens a dialog
 * (`ui/Dialog`) which previews what a sync would write to each song item's
 * hymnal note in Planning Center, writes it on Confirm, and then says what
 * became of each note, the failures first. A missing category is explained,
 * with a link to the settings.
 *
 * Both steps wait on Planning Center, so each action is called from its
 * click (Sync hymn notes, Confirm), with where the dialog is in `useState`,
 * never in a transition or a form action, which would hold every navigation
 * until Planning Center answered (convention 15). A preview whose dialog
 * was closed, or opened again, before it answered is ignored. While the
 * sync runs the dialog cannot be dismissed, but the browser may still close
 * it (Chromium lets a third Escape through): the sync then goes on, Sync
 * hymn notes opens the dialog on it again rather than start a preview, and
 * its results open the dialog themselves, so they are seen. The sync
 * revalidates the plan, so the cards' note statuses follow.
 *
 * Focus: the dialog's close button has it while the preview is read; then
 * the summary or the message takes it, so it is read out; Confirm keeps it
 * while the sync runs (`aria-disabled`); then the results' summary takes
 * it; closing hands it back to the button. A failure is an alert keyed per
 * attempt, so the same words are announced again.
 */
export default function SyncHymnNotesAction({ serviceTypeId, planId }: SyncHymnNotesActionProps) {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<SyncDialogState>({ phase: "previewing" });
    /** Counts the actions run, to key each failure's alert. */
    const [attempt, setAttempt] = useState(0);
    const buttonRef = useRef<HTMLButtonElement>(null);
    /** The message or summary that takes focus when an action answers. */
    const answerRef = useRef<HTMLParagraphElement>(null);
    /** Incremented by every action and every close, so an answer nobody waits for is dropped. */
    const requestRef = useRef(0);

    useEffect(() => {
        if (state.phase === "preview" || state.phase === "results") {
            answerRef.current?.focus();
        }
    }, [state]);

    async function preview() {
        const request = ++requestRef.current;
        setState({ phase: "previewing" });
        setAttempt((count) => count + 1);
        let result: PreviewHymnNotesState;
        try {
            result = await previewHymnNotesAction(serviceTypeId, planId);
        } catch (error) {
            console.error("Failed to preview the hymnal notes:", error);
            result = PREVIEW_NO_ANSWER;
        }
        if (request === requestRef.current) {
            setState({ phase: "preview", result });
        }
    }

    async function sync(status: ReadyStatus) {
        if (state.phase === "syncing") {
            return;
        }
        const request = ++requestRef.current;
        setState({ phase: "syncing", status });
        setAttempt((count) => count + 1);
        let result: SyncHymnNotesState;
        try {
            result = await syncHymnNotesAction(serviceTypeId, planId);
        } catch (error) {
            console.error("Failed to sync the hymnal notes:", error);
            result = SYNC_NO_ANSWER;
        }
        if (request === requestRef.current) {
            setState({ phase: "results", result });
            // Open again if the browser closed the dialog while the sync ran.
            setOpen(true);
        }
    }

    function openDialog() {
        setOpen(true);
        // The browser closed the dialog on a running sync: show it again, and
        // read nothing from Planning Center until it is done.
        if (state.phase !== "syncing") {
            void preview();
        }
    }

    // The dialog has closed, however it closed (see `ui/Dialog`), so the state
    // always follows. A preview still being read is dropped; a sync goes on,
    // and opens the dialog again with its results.
    function close() {
        if (state.phase !== "syncing") {
            requestRef.current += 1;
        }
        setOpen(false);
    }

    const syncing = state.phase === "syncing";
    const pendingText = PENDING_TEXT[state.phase] ?? "";

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={openDialog}
                // SubmitButton's primary colours: white text is 5.3:1 on
                // blue-600, and the ring outside the button 3:1 on the page.
                // Sized like "View in Planning Center" below it.
                className="px-4 py-2 text-white text-center bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors whitespace-nowrap cursor-pointer"
            >
                Sync hymn notes
            </button>
            <Dialog
                open={open}
                onClose={close}
                title="Sync hymn notes"
                description="Writes each song's hymnal numbers to its note in Planning Center. Notes in other categories, and notes the app did not write, are left alone."
                returnFocusRef={buttonRef}
                dismissible={!syncing}
            >
                <p
                    role="status"
                    className={pendingText === "" ? "sr-only" : "text-sm text-gray-600 dark:text-gray-300"}
                >
                    {pendingText}
                </p>
                <SyncDialogBody
                    state={state}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={close}
                    onPreview={() => void preview()}
                    onSync={(status) => void sync(status)}
                />
            </Dialog>
        </>
    );
}

interface SyncDialogBodyProps {
    state: SyncDialogState;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onPreview: () => void;
    onSync: (status: ReadyStatus) => void;
}

/**
 * What the dialog shows below its status line, for where it is. A preview
 * that found the category and the sync that follows it are the same
 * `ReadyPreview` in the same place, so Confirm stays the same button, and
 * keeps focus, while the sync runs.
 */
function SyncDialogBody({ state, attempt, answerRef, onClose, onPreview, onSync }: SyncDialogBodyProps) {
    switch (state.phase) {
        case "previewing":
            return (
                <Buttons>
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Cancel
                    </button>
                </Buttons>
            );
        case "preview":
            if (state.result.ok && state.result.status.kind === "ready") {
                return (
                    <ReadyPreview
                        status={state.result.status}
                        answerRef={answerRef}
                        onClose={onClose}
                        onSync={onSync}
                    />
                );
            }
            return (
                <PreviewProblem
                    result={state.result}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={onClose}
                    onPreview={onPreview}
                />
            );
        case "syncing":
            return (
                <ReadyPreview
                    status={state.status}
                    syncing
                    answerRef={answerRef}
                    onClose={onClose}
                    onSync={onSync}
                />
            );
        case "results":
            return (
                <ResultsBody
                    result={state.result}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={onClose}
                    onPreview={onPreview}
                />
            );
    }
}

/**
 * A message that takes focus when it arrives. A failure is an alert, keyed
 * per attempt, and red unless `quiet`: the results' summary, which says what
 * was written too, stays black, and its failed rows' tags are red.
 */
function Answer({
    answerRef,
    alert,
    quiet = false,
    attempt,
    children,
}: {
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    alert?: boolean;
    quiet?: boolean;
    attempt?: number;
    children: React.ReactNode;
}) {
    return (
        <p
            key={alert ? attempt : undefined}
            ref={answerRef}
            tabIndex={-1}
            role={alert ? "alert" : undefined}
            className={`text-sm focus:outline-none ${
                alert && !quiet ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-gray-100"
            }`}
        >
            {children}
        </p>
    );
}

/**
 * A preview that found the category: the summary, a row per song item, and
 * Confirm when there is anything to write; with `syncing`, Confirm says so
 * and Cancel waits.
 */
function ReadyPreview({
    status,
    syncing = false,
    answerRef,
    onClose,
    onSync,
}: {
    status: ReadyStatus;
    syncing?: boolean;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onSync: (status: ReadyStatus) => void;
}) {
    const changes = writesToMake(status.items);
    return (
        <>
            <Answer answerRef={answerRef}>{previewSummary(status.items)}</Answer>
            <NoteRows rows={previewRows(status.items)} label="What a sync would do, song by song" />
            <Buttons>
                {changes > 0 ? (
                    <>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={syncing}
                            className={SECONDARY_BUTTON_CLASS}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (!syncing) {
                                    onSync(status);
                                }
                            }}
                            // aria-disabled, not disabled, so it keeps focus while the sync runs.
                            aria-disabled={syncing}
                            className={`${PRIMARY_BUTTON_CLASS} ${
                                syncing ? "opacity-60 cursor-not-allowed" : "hover:bg-blue-700 cursor-pointer"
                            }`}
                        >
                            {syncing ? "Writing…" : confirmLabel(changes)}
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Close
                    </button>
                )}
            </Buttons>
        </>
    );
}

/**
 * A preview with nothing to write: the missing category, with how to fix
 * it; or why the notes cannot be compared, with Try again.
 */
function PreviewProblem({
    result,
    attempt,
    answerRef,
    onClose,
    onPreview,
}: {
    result: PreviewHymnNotesState;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onPreview: () => void;
}) {
    if (result.ok && result.status.kind === "no-category") {
        return (
            <>
                <Answer answerRef={answerRef}>{result.status.message}</Answer>
                <MissingCategoryHelp />
                <Buttons>
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Close
                    </button>
                </Buttons>
            </>
        );
    }
    const message = !result.ok
        ? result.message
        : result.status.kind === "unavailable"
          ? result.status.message
          : null;
    if (message === null) {
        // A preview that found the category is ReadyPreview's.
        return null;
    }
    return (
        <>
            <Answer answerRef={answerRef} alert attempt={attempt}>
                {message}
            </Answer>
            <Buttons>
                <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                    Close
                </button>
                <button
                    type="button"
                    onClick={onPreview}
                    className={`${PRIMARY_BUTTON_CLASS} hover:bg-blue-700 cursor-pointer`}
                >
                    Try again
                </button>
            </Buttons>
        </>
    );
}

/** What the sync did, item by item, the failures first; or why it wrote nothing. */
function ResultsBody({
    result,
    attempt,
    answerRef,
    onClose,
    onPreview,
}: {
    result: SyncHymnNotesState;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onPreview: () => void;
}) {
    if (result.ok) {
        return (
            <>
                <Answer answerRef={answerRef} alert={result.counts.failed > 0} quiet attempt={attempt}>
                    {resultSummary(result.counts)}
                </Answer>
                <NoteRows rows={resultRows(result.items)} label="What the sync did, song by song" />
                <Buttons>
                    <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                        Done
                    </button>
                </Buttons>
            </>
        );
    }
    return (
        <>
            <Answer answerRef={answerRef} alert attempt={attempt}>
                {result.message}
            </Answer>
            {result.kind === "no-category" && <MissingCategoryHelp />}
            <Buttons>
                <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                    Close
                </button>
                <button
                    type="button"
                    onClick={onPreview}
                    className={`${PRIMARY_BUTTON_CLASS} hover:bg-blue-700 cursor-pointer`}
                >
                    Preview again
                </button>
            </Buttons>
        </>
    );
}
