"use client";

import { useId } from "react";
import Dialog from "@/app/components/ui/Dialog";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import {
    REORDER_DIALOG_DESCRIPTION,
    REORDER_PENDING_TEXT,
    moveLabel,
    movedSummary,
    moveWords,
    reorderOutcomeView,
    type OrderRow,
    type ReorderOutcome,
} from "@/lib/planItemOrderText";
import { pcoWebUrls } from "@/lib/routes";
import { DialogAnswer, DialogButtons, LINK_CLASS } from "./PlanDialogParts";

/** Where the dialog is: showing the new order, writing it, or showing what came of it. */
export type ReorderDialogState =
    | { phase: "preview" }
    | { phase: "writing" }
    | { phase: "result"; outcome: ReorderOutcome };

/** The tag of a row that moved: blue like the sync dialog's "change", and its words say the same. */
const MOVE_TAG_CLASS =
    "inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-blue-800 ring-1 ring-inset ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900";

/** A row's tag for how far it moved: "Up 2", with the words for a screen reader. */
export function MoveTag({ row }: { row: OrderRow }) {
    if (row.move === null) {
        return null;
    }
    return (
        <span className={MOVE_TAG_CLASS}>
            <span aria-hidden="true">{moveLabel(row.move)}</span>
            <span className="sr-only">{moveWords(row.move)}</span>
        </span>
    );
}

/** An item's title, with its type after it when it is not a song. */
export function RowTitle({ row }: { row: OrderRow }) {
    return (
        <span className="min-w-0 flex-1 break-words text-sm text-gray-900 dark:text-gray-100">
            {row.title}
            {row.typeLabel !== null && (
                <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">{row.typeLabel}</span>
            )}
        </span>
    );
}

/**
 * The new order, every item, with its place and how far it moved. The list
 * scrolls inside the dialog so the buttons stay in view, which makes it a
 * region the keyboard can scroll (`tabIndex`), with a name.
 */
function NewOrder({ rows }: { rows: readonly OrderRow[] }) {
    const labelId = useId();
    return (
        <div className="mt-4">
            <p id={labelId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
                The new order
            </p>
            <div
                role="region"
                aria-labelledby={labelId}
                tabIndex={0}
                className="mt-1 max-h-[40vh] overflow-auto rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700"
            >
                {/* role="list": a list with its markers removed loses its semantics in Safari. */}
                <ol role="list" className="list-none divide-y divide-gray-200 dark:divide-gray-700">
                    {rows.map((row) => (
                        <li key={row.id} className="flex items-baseline gap-3 px-3 py-2">
                            <span
                                aria-hidden="true"
                                className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400"
                            >
                                {row.place}
                            </span>
                            <RowTitle row={row} />
                            <MoveTag row={row} />
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}

interface PreviewBodyProps {
    rows: readonly OrderRow[];
    /** How many items changed place. */
    moved: number;
    writing: boolean;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onBack: () => void;
    onConfirm: () => void;
}

/**
 * The new order and Confirm. While it is written, the same body stays, with
 * Confirm saying so (it is `aria-disabled`, so it keeps focus) and Back
 * waiting, so the button the person pressed is the one that stays.
 */
function PreviewBody({ rows, moved, writing, answerRef, onBack, onConfirm }: PreviewBodyProps) {
    return (
        <>
            <DialogAnswer answerRef={answerRef}>{movedSummary(moved, rows.length)}</DialogAnswer>
            <NewOrder rows={rows} />
            <DialogButtons>
                <button
                    type="button"
                    onClick={onBack}
                    disabled={writing}
                    className={buttonClasses("secondary", writing)}
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (!writing) {
                            onConfirm();
                        }
                    }}
                    // aria-disabled, not disabled, so it keeps focus while the order is written.
                    aria-disabled={writing}
                    className={buttonClasses("primary", writing)}
                >
                    {writing ? "Writing…" : "Confirm"}
                </button>
            </DialogButtons>
        </>
    );
}

interface ResultBodyProps {
    outcome: ReorderOutcome;
    total: number;
    planId: string;
    attempt: number;
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onClose: () => void;
    onTryAgain: () => void;
}

/**
 * What came of the reorder, with the buttons its outcome calls for
 * (`reorderOutcomeView`): Done or Close, Try again for a refusal that can
 * be, or a link to the plan in Planning Center when it is not known what
 * happened. A failure is an alert keyed per attempt, so the same words are
 * announced again.
 */
function ResultBody({ outcome, total, planId, attempt, answerRef, onClose, onTryAgain }: ResultBodyProps) {
    const view = reorderOutcomeView(outcome, total);
    return (
        <>
            <DialogAnswer
                answerRef={answerRef}
                alert={view.alert}
                // A warning is not red: the words say what it is.
                quiet={view.tone === "warning"}
                attempt={attempt}
            >
                {view.summary}
            </DialogAnswer>
            {view.linkToPlanningCenter && (
                <p className="mt-3 text-sm">
                    <a
                        href={pcoWebUrls.plan(planId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK_CLASS}
                    >
                        View the plan in Planning Center
                    </a>
                </p>
            )}
            <DialogButtons>
                <button type="button" onClick={onClose} className={buttonClasses("secondary")}>
                    {view.tone === "success" ? "Done" : "Close"}
                </button>
                {view.canTryAgain && (
                    <button type="button" onClick={onTryAgain} className={buttonClasses("primary")}>
                        Try again
                    </button>
                )}
            </DialogButtons>
        </>
    );
}

interface ReorderItemsDialogProps {
    open: boolean;
    /** Called once the dialog has closed, however it closed (see `ui/Dialog`). */
    onClose: () => void;
    state: ReorderDialogState;
    /** Counts the actions run, to key each failure's alert. */
    attempt: number;
    /** The items in the new order, for the preview. */
    rows: readonly OrderRow[];
    /** How many items changed place. */
    moved: number;
    planId: string;
    /** The element that gets focus back when the dialog closes: the button that opened it. */
    returnFocusRef: React.RefObject<HTMLElement | null>;
    /** The line that takes focus when an answer arrives. */
    answerRef: React.RefObject<HTMLParagraphElement | null>;
    onConfirm: () => void;
    onTryAgain: () => void;
}

/**
 * The dialog of "Reorder items" (`ui/Dialog`): the new order for the person
 * to read, Confirm to write it, and what came of it. It cannot be dismissed
 * while the order is written. The parent keeps `open` in step with
 * `onClose`, and opens it again when the answer comes, in case the browser
 * closed it meanwhile (see `ui/Dialog`).
 */
export default function ReorderItemsDialog({
    open,
    onClose,
    state,
    attempt,
    rows,
    moved,
    planId,
    returnFocusRef,
    answerRef,
    onConfirm,
    onTryAgain,
}: ReorderItemsDialogProps) {
    const writing = state.phase === "writing";
    const pendingText = writing ? REORDER_PENDING_TEXT : "";
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Confirm the new order"
            description={REORDER_DIALOG_DESCRIPTION}
            returnFocusRef={returnFocusRef}
            dismissible={!writing}
        >
            <p
                role="status"
                className={pendingText === "" ? "sr-only" : "text-sm text-gray-600 dark:text-gray-300"}
            >
                {pendingText}
            </p>
            {state.phase === "result" ? (
                <ResultBody
                    outcome={state.outcome}
                    total={rows.length}
                    planId={planId}
                    attempt={attempt}
                    answerRef={answerRef}
                    onClose={onClose}
                    onTryAgain={onTryAgain}
                />
            ) : (
                <PreviewBody
                    rows={rows}
                    moved={moved}
                    writing={writing}
                    answerRef={answerRef}
                    onBack={onClose}
                    onConfirm={onConfirm}
                />
            )}
        </Dialog>
    );
}
