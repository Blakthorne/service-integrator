"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { rowAfter } from "@/lib/catalog/pickers";

/** What a list says after one of its rows left, and where focus went. */
export interface RowNotice {
    message: string;
    /** The id of the element focus moves to: the next row's heading, or the notice itself. */
    focusId: string;
}

/**
 * For a list whose rows leave when acted on (Reconcile's Link, Ignore,
 * Undo, Unignore): the notice that says what was done, and focus moved to
 * the heading of the row that took the place of the one that left (or to
 * the notice, when the list is empty now), so it is not dropped on the
 * page's body.
 *
 * `announce` is called from a row's action once it has succeeded. It sets
 * the notice in a transition, so the notice and focus move land with the
 * refreshed list that the action's revalidation brings.
 */
export function useRowNotice(noticeId: string, headingIdOf: (rowId: string) => string) {
    const [notice, setNotice] = useState<RowNotice | null>(null);

    useEffect(() => {
        if (notice) {
            document.getElementById(notice.focusId)?.focus();
        }
    }, [notice]);

    const announce = useCallback(
        (rowIds: readonly string[], rowId: string, message: string) => {
            const next = rowAfter(rowIds, rowId);
            startTransition(() => {
                setNotice({ message, focusId: next === null ? noticeId : headingIdOf(next) });
            });
        },
        [noticeId, headingIdOf]
    );

    return { notice, announce };
}
