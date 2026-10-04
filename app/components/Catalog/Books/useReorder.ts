"use client";

import { useEffect, useRef, useState } from "react";
import { describeMove, type MoveOutcome } from "@/lib/catalog/bookForms";
import type { MoveDirection } from "@/lib/catalog/validation";

/** What a list says when its Move action could not even be called: no session, or a failed request. */
export const COULD_NOT_MOVE_MESSAGE =
    "The move could not be made. Reload the page and try again.";

interface ReorderOptions {
    /** What the list holds, for the sentence after a move. */
    noun: "book" | "entry";
    /** The field the action reads the thing's id from. */
    idField: "bookId" | "entryId";
    /** The server action: reads `idField` and `direction`, and says where the thing is now. */
    move: (formData: FormData) => Promise<MoveOutcome>;
    /**
     * The list's rows as the page gave them. A page that is rendered again
     * after a move hands over a new array, which is when focus is put back
     * (see `focusAfter`).
     */
    rows: readonly unknown[];
    /** The DOM id of the button that moves the thing with this id in this direction. */
    buttonId: (id: number, direction: MoveDirection) => string;
}

/** What `useReorder` gives a list. */
export interface Reorder {
    /** True while a move is under way: the Move buttons are not available. */
    pending: boolean;
    /**
     * What the last move did, for the list's status region, which must always
     * be rendered: empty until a move comes back, and again while the next
     * one runs, so a sentence that repeats word for word is announced again.
     */
    status: string;
    /** What the last move was refused or failed with; `attempt` keys its alert, so a repeated refusal is announced again. */
    failure: { attempt: number; message: string } | null;
    /** Move the thing with this id, named `name` in the sentences, one place in `direction`. */
    moveItem: (id: number, name: string, direction: MoveDirection) => void;
}

/**
 * The state of a list whose rows have Move up and Move down buttons: a move
 * is a server action called from the button's click, with its pending state
 * in `useState` and not in a transition, so that a navigation never waits
 * for it (convention 15). A move changes the order of the rows the page
 * rendered, so the action revalidates the page and the rows come back
 * moved.
 *
 * A keyboard user keeps their place. When a row moves down, React moves its
 * DOM node, and the browser takes focus off a node that is moved, so the
 * button the person pressed would be lost, and a second Move down would
 * mean tabbing back through the whole list. Before the move goes out, the
 * button to focus is remembered (`focusAfter`: the same direction, on the
 * same thing), and an effect puts focus on it once the rows have come back.
 * The Move buttons are `aria-disabled` at the edges and while a move runs,
 * never `disabled`, so they can hold focus.
 */
export function useReorder({ noun, idField, move, rows, buttonId }: ReorderOptions): Reorder {
    const [pending, setPending] = useState(false);
    const [status, setStatus] = useState("");
    const [failure, setFailure] = useState<Reorder["failure"]>(null);
    // Read by the handler, which may run again before a render shows `pending`.
    const moving = useRef(false);
    const attempts = useRef(0);
    const focusAfter = useRef<string | null>(null);

    useEffect(() => {
        const id = focusAfter.current;
        if (id !== null) {
            focusAfter.current = null;
            document.getElementById(id)?.focus();
        }
    }, [rows]);

    function fail(message: string): void {
        attempts.current += 1;
        setFailure({ attempt: attempts.current, message });
    }

    async function moveItem(id: number, name: string, direction: MoveDirection): Promise<void> {
        if (moving.current) {
            return;
        }
        moving.current = true;
        setPending(true);
        setStatus("");
        setFailure(null);
        focusAfter.current = buttonId(id, direction);
        const formData = new FormData();
        formData.set(idField, String(id));
        formData.set("direction", direction);
        try {
            const outcome = await move(formData);
            if (outcome.ok) {
                setStatus(describeMove(name, direction, outcome, noun));
                if (!outcome.changed) {
                    // Nothing moved, so no rows come back to put focus after.
                    focusAfter.current = null;
                }
            } else {
                focusAfter.current = null;
                fail(outcome.message);
            }
        } catch (error) {
            console.error("Moving failed:", error);
            focusAfter.current = null;
            fail(COULD_NOT_MOVE_MESSAGE);
        } finally {
            moving.current = false;
            setPending(false);
        }
    }

    return {
        pending,
        status,
        failure,
        moveItem: (id, name, direction) => {
            void moveItem(id, name, direction);
        },
    };
}
