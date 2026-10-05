"use client";

import { useRef, useState, type FormEvent } from "react";
import type { SettingsFormState } from "@/app/(app)/settings/actions";
import { IDLE_FORM, formError, type FormValues } from "@/lib/forms";
import { isSaved, valuesAfterSave } from "@/lib/settingsForms";

/** What a form says when its action could not even be called: no session, or a failed request. */
export const COULD_NOT_SAVE_MESSAGE =
    "The settings could not be saved. Reload the page and try again.";

/** What `useSettingsForm` gives a form. */
export interface SettingsForm {
    /** The last response of the action, or idle before the first. */
    state: SettingsFormState;
    /** True while a save is under way: the Save button says so and ignores clicks. */
    pending: boolean;
    /** What each field shows, as text by field name. */
    values: FormValues;
    /** Change one field (ignored while a save is under way). */
    setValue: (name: string, value: string) => void;
    /** True while the fields show exactly what the last save stored, so "Saved." is true. */
    saved: boolean;
    /** The form's `onSubmit`. */
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * The state of a Settings form: its fields' text (controlled, so the form
 * never shows something other than what was typed or saved), the last
 * response of its action, and whether a save is under way.
 *
 * The action is called from the form's `onSubmit` and not run as a form
 * action: a form action's transition lasts until the page the action
 * revalidated has been rendered again, and this page reads Planning Center,
 * which would keep "Saving..." up for as long as Planning Center takes (see
 * `SettingsFormState`). Called from a handler, "Saved." appears when the
 * action returns, and the Planning Center cards update when their reads are
 * back. An action that cannot be called at all (no session, a failed
 * request) shows `COULD_NOT_SAVE_MESSAGE`.
 *
 * Once a save succeeds the fields are exactly the ones it posted, holding
 * what it stored (a trimmed number: `valuesAfterSave`), and `saved` is true
 * until one is edited (`isSaved`). The fields are read-only while a save is
 * under way (`pending`), which a save queued behind another action, such as
 * Sync now, can make long: Next runs a page's server actions one at a time.
 * The props are not followed: a revalidation, after a save or Sync now, must
 * never overwrite what is being typed.
 */
export function useSettingsForm(
    initial: FormValues,
    save: (formData: FormData) => Promise<SettingsFormState>
): SettingsForm {
    const [state, setState] = useState<SettingsFormState>(IDLE_FORM);
    const [pending, setPending] = useState(false);
    const [values, setValues] = useState(initial);
    // Read by the handlers, which may run again before a render shows `pending`.
    const saving = useRef(false);

    async function submit(formData: FormData): Promise<void> {
        saving.current = true;
        setPending(true);
        try {
            const next = await save(formData);
            setState(next);
            setValues((current) => valuesAfterSave(current, next));
        } catch (error) {
            console.error("Saving the settings failed:", error);
            setState(formError(COULD_NOT_SAVE_MESSAGE));
        } finally {
            saving.current = false;
            setPending(false);
        }
    }

    return {
        state,
        pending,
        values,
        setValue: (name, value) => {
            if (!saving.current) {
                setValues((current) => ({ ...current, [name]: value }));
            }
        },
        saved: isSaved(values, state),
        onSubmit: (event) => {
            // The browser's own submit would load a page.
            event.preventDefault();
            if (!saving.current) {
                // Read before anything is awaited: the event is gone after.
                void submit(new FormData(event.currentTarget));
            }
        },
    };
}
