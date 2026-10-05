"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { reorderItemsAction } from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
import { moveItem, movedCount, type MoveDirection } from "@/lib/planItemOrder";
import {
    REORDER_INTRO,
    REORDER_NO_ANSWER_MESSAGE,
    describeMove,
    movedSummary,
    orderRows,
    reorderOutcomeView,
    type ReorderOutcome,
} from "@/lib/planItemOrderText";
import MoveButtons from "../Catalog/Books/MoveButtons";
import { buttonClasses } from "../ui/buttonClasses";
import { usePlan } from "./PlanProvider";
import ReorderItemsDialog, {
    MoveTag,
    RowTitle,
    type ReorderDialogState,
} from "./ReorderItemsDialog";

/** The DOM id of the button that moves an item in a direction: focus is put back on it after a move. */
function buttonId(itemId: string, direction: MoveDirection): string {
    return `reorder-${direction}-${itemId}`;
}

interface ReorderItemsProps {
    /** Called when the mode ends: Cancel, or Close on an outcome that ends it. */
    onDone: () => void;
}

/**
 * The plan page's "Reorder items" mode, in place of the items table: every
 * item of the plan (headers and plain items too), each with Move up and Move
 * down, how many have moved, and "Review new order", which opens a dialog
 * (`ReorderItemsDialog`) with the new order for the person to read and
 * Confirm. Nothing is written until Confirm.
 *
 * The order the page showed (`shown`) is taken when the mode starts and
 * kept: Confirm sends it back with the order made, and the reorder is held
 * to it (`reorderItemsAction`), refusing, writing nothing, when the plan has
 * changed since. So a plan that changes while the person chooses ends in
 * that refusal and a refreshed page, never in an order made from items that
 * are no longer there.
 *
 * Confirm waits on Planning Center, so the action is called from its click,
 * with where the dialog is in `useState`, never in a transition or a form
 * action, which would hold every navigation until Planning Center answered
 * (convention 15). While the order is written the dialog cannot be
 * dismissed and a second click on Confirm does nothing; the browser may
 * still close it (Chromium lets a third Escape through), and the answer
 * then opens it again. A reorder that was made, or refused because the plan
 * had changed, revalidates the plan, so the page behind shows Planning
 * Center's order, and closing its outcome ends the mode.
 *
 * A keyboard user keeps their place. A row that moves is moved in the DOM,
 * and the browser takes focus off a node that is moved, so the button
 * pressed is remembered (`focusAfter`: the same direction on the same item)
 * and given focus again once the list is drawn. The Move buttons are
 * `aria-disabled` at the ends, never `disabled`, so they can hold focus. Each
 * move is announced in a status region that is always rendered.
 */
export default function ReorderItems({ onDone }: ReorderItemsProps) {
    const { plan, serviceType, items } = usePlan();
    /** The ids of the plan's items as the page showed them when the mode began. */
    const [shown] = useState(() => items.map(({ id }) => id));
    const [order, setOrder] = useState<string[]>(shown);
    const [status, setStatus] = useState("");
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState<ReorderDialogState>({ phase: "preview" });
    /** Counts the actions run, to key each failure's alert. */
    const [attempt, setAttempt] = useState(0);
    const introRef = useRef<HTMLParagraphElement>(null);
    const reviewRef = useRef<HTMLButtonElement>(null);
    const answerRef = useRef<HTMLParagraphElement>(null);
    const focusAfter = useRef<string | null>(null);
    /** True from a click on Confirm until its answer: read by the handler, which may run again before a render. */
    const writingRef = useRef(false);

    const rows = useMemo(() => orderRows(items, shown, order), [items, shown, order]);
    const moved = movedCount(shown, order);
    const writing = dialog.phase === "writing";

    // The mode replaced the table the person was on; say what to do.
    useEffect(() => {
        introRef.current?.focus();
    }, []);

    useEffect(() => {
        const id = focusAfter.current;
        if (id !== null) {
            focusAfter.current = null;
            document.getElementById(id)?.focus();
        }
    }, [order]);

    // The preview and the outcome take focus when they are shown, so they are read out.
    useEffect(() => {
        if (open && dialog.phase !== "writing") {
            answerRef.current?.focus();
        }
    }, [open, dialog]);

    function handleMove(id: string, direction: MoveDirection) {
        const next = moveItem(order, id, direction);
        if (next.every((value, place) => value === order[place])) {
            return;
        }
        const row = rows.find((candidate) => candidate.id === id);
        focusAfter.current = buttonId(id, direction);
        setOrder(next);
        setStatus(describeMove(row?.title ?? `Item ${id}`, next.indexOf(id) + 1, next.length, direction));
    }

    function review() {
        if (moved === 0) {
            return;
        }
        setDialog({ phase: "preview" });
        setOpen(true);
    }

    async function confirm() {
        if (writingRef.current) {
            return;
        }
        writingRef.current = true;
        setDialog({ phase: "writing" });
        setAttempt((count) => count + 1);
        let outcome: ReorderOutcome;
        try {
            // The order the page showed and the order made: the reorder is held to the first.
            outcome = await reorderItemsAction(serviceType.id, plan.id, { shown, order });
        } catch (error) {
            console.error("Failed to put the plan's items in order:", error);
            outcome = { ok: false, reason: "unknown", message: REORDER_NO_ANSWER_MESSAGE };
        } finally {
            writingRef.current = false;
        }
        setDialog({ phase: "result", outcome });
        // Open again if the browser closed the dialog while the order was written.
        setOpen(true);
    }

    // The dialog has closed, however it closed (see `ui/Dialog`), so `open`
    // always follows. An outcome that ends the mode (the order was written, or
    // the plan had changed and was shown afresh) ends it. Once is enough: the
    // close that follows a button's own is a no-op.
    function close() {
        if (!open) {
            return;
        }
        setOpen(false);
        if (dialog.phase === "result" && reorderOutcomeView(dialog.outcome, shown.length).endsMode) {
            onDone();
        }
    }

    return (
        <section aria-labelledby="reorder-items-heading">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h2 id="reorder-items-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Reorder items
                    </h2>
                    <p
                        ref={introRef}
                        tabIndex={-1}
                        className="mt-1 text-sm text-gray-600 dark:text-gray-300 focus:outline-none"
                    >
                        {REORDER_INTRO}
                    </p>
                    <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {movedSummary(moved, order.length)}
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-3">
                    <button type="button" onClick={onDone} className={buttonClasses("secondary")}>
                        Cancel
                    </button>
                    <button
                        ref={reviewRef}
                        type="button"
                        onClick={review}
                        // aria-disabled, not disabled, so it keeps focus when nothing has moved.
                        aria-disabled={moved === 0}
                        title={moved === 0 ? "Move an item first" : undefined}
                        className={buttonClasses("primary", moved === 0)}
                    >
                        Review new order
                    </button>
                </div>
            </div>
            <p role="status" className="sr-only">
                {status}
            </p>
            {/* role="list": a list with its markers removed loses its semantics in Safari. */}
            <ol
                role="list"
                aria-label="Plan items, in the order you are choosing"
                className="list-none divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800"
            >
                {rows.map((row, index) => (
                    <li key={row.id} className="flex items-center gap-3 px-3 py-3 sm:px-6">
                        <span
                            aria-hidden="true"
                            className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400"
                        >
                            {row.place}
                        </span>
                        <RowTitle row={row} />
                        <MoveTag row={row} />
                        <MoveButtons
                            name={row.title}
                            upId={buttonId(row.id, "up")}
                            downId={buttonId(row.id, "down")}
                            first={index === 0}
                            last={index === rows.length - 1}
                            pending={writing}
                            onMove={(direction) => handleMove(row.id, direction)}
                        />
                    </li>
                ))}
            </ol>
            <ReorderItemsDialog
                open={open}
                onClose={close}
                state={dialog}
                attempt={attempt}
                rows={rows}
                moved={moved}
                planId={plan.id}
                returnFocusRef={reviewRef}
                answerRef={answerRef}
                onConfirm={() => void confirm()}
                onTryAgain={() => setDialog({ phase: "preview" })}
            />
        </section>
    );
}
