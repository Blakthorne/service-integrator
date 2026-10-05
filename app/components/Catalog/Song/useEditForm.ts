"use client";

import { useRef, useState, type FormEvent } from "react";
import { NO_ANSWER_MESSAGE } from "@/lib/catalog/editForms";
import { IDLE_FORM, formError } from "@/lib/forms";

/** The states an edit form's action gives back (`FormState`, perhaps with more on success). */
type EditState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message: string };

/** What `useEditForm` gives a form. */
export interface EditForm<S extends EditState> {
    /** The last response of the action, or idle before the first. */
    state: S;
    /** True while the action runs. */
    pending: boolean;
    /** Call the action with `formData`, unless it is running already. */
    submit: (formData: FormData) => Promise<void>;
    /** The form's `onSubmit`: calls the action with the form's fields. */
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    /** Forget the last response, as a form that is put away does. */
    reset: () => void;
}

/**
 * An edit form of the song page or a tune's page: its action is called
 * from `onSubmit` (or a click, through `submit`), with the last response
 * and the pending flag in `useState`, never as a form action, since those
 * pages render cards that read Planning Center and a form action's
 * transition would last until they had (convention 15 as phase 5 refined
 * it). `onDone` runs with each response, for the form to hand focus on or
 * put itself away. An action that cannot be called at all (the session
 * ended, the request failed) comes back as `NO_ANSWER_MESSAGE`.
 */
export function useEditForm<S extends EditState>(
    action: (formData: FormData) => Promise<S>,
    onDone?: (state: S) => void
): EditForm<S> {
    const [state, setState] = useState<S>(IDLE_FORM as S);
    const [pending, setPending] = useState(false);
    // Read by the handlers, which may run again before a render shows `pending`.
    const busy = useRef(false);

    async function submit(formData: FormData): Promise<void> {
        if (busy.current) {
            return;
        }
        busy.current = true;
        setPending(true);
        try {
            const next = await action(formData);
            setState(next);
            onDone?.(next);
        } catch (error) {
            console.error("An edit of the catalog failed:", error);
            setState(formError(NO_ANSWER_MESSAGE) as S);
        } finally {
            busy.current = false;
            setPending(false);
        }
    }

    return {
        state,
        pending,
        submit,
        onSubmit: (event) => {
            // The browser's own submit would load a page.
            event.preventDefault();
            // Read before anything is awaited: the event is gone after.
            void submit(new FormData(event.currentTarget));
        },
        reset: () => setState(IDLE_FORM as S),
    };
}
