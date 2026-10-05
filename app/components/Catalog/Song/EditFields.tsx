import type { Route } from "next";
import Link from "next/link";
import type { Ref } from "react";
import { formStateKey, type FieldError } from "@/lib/forms";
import { buttonClasses, type ButtonVariant } from "../../ui/buttonClasses";
import { HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from "../SongForm/Fields";

/**
 * The parts the catalog's edit forms share (the song page's Books, Hymn
 * and To learn cards, and a tune's page): labelled fields whose hint and
 * error describe them, the error under a field with its link, the
 * submit button that takes its pending state as a prop, and the bottom of
 * a form, with its alert and its status region. Their look comes from the
 * new-song form's fields and `ui/buttonClasses`.
 */

/**
 * A link in a line of text, underlined as well as coloured: blue alone is
 * under the 3:1 a link needs against the text around it (convention 20).
 */
export const TEXT_LINK_CLASS =
    "font-medium text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300";

/** A field's error, under it, with a link to what it clashes with ("See R-396."). Nothing without one. */
export function FieldErrorText({ id, error }: { id: string; error: FieldError | undefined }) {
    if (!error) {
        return null;
    }
    return (
        <p id={id} className="text-sm text-red-600 dark:text-red-400">
            {error.message}
            {error.link && (
                <>
                    {" "}
                    See{" "}
                    {/* A runtime path cannot be checked against the route
                        table; the action built it with lib/routes.ts. */}
                    <Link href={error.link.href as Route} className={TEXT_LINK_CLASS}>
                        {error.link.label}
                    </Link>
                    .
                </>
            )}
        </p>
    );
}

interface FieldProps {
    /** The control's id, unique on the page. */
    id: string;
    /** Its name in the form data. */
    name: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** A sentence under the label, such as an example or what leaving it blank does. */
    hint?: string;
    /** What the action found wrong with the field. */
    error?: FieldError;
    /** True while the form's action runs: the field takes no input. */
    readOnly?: boolean;
    placeholder?: string;
    maxLength?: number;
}

/** The ids that describe a field: its hint and its error, or undefined for none. */
function describedBy(id: string, hint: string | undefined, error: FieldError | undefined): string | undefined {
    return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

interface TextFieldProps extends FieldProps {
    inputMode?: "text" | "numeric";
    inputRef?: Ref<HTMLInputElement>;
}

/** A labelled one-line field, controlled; its hint and error describe it, and an error marks it invalid. */
export function EditTextField({
    id,
    name,
    label,
    value,
    onChange,
    hint,
    error,
    readOnly,
    placeholder,
    maxLength,
    inputMode,
    inputRef,
}: TextFieldProps) {
    return (
        <div className="space-y-1">
            <label htmlFor={id} className={LABEL_CLASS}>
                {label}
            </label>
            {hint && (
                <p id={`${id}-hint`} className={HINT_CLASS}>
                    {hint}
                </p>
            )}
            <input
                ref={inputRef}
                id={id}
                name={name}
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                readOnly={readOnly}
                placeholder={placeholder}
                maxLength={maxLength}
                inputMode={inputMode}
                autoComplete="off"
                aria-describedby={describedBy(id, hint, error)}
                aria-invalid={error ? true : undefined}
                className={INPUT_CLASS}
            />
            <FieldErrorText id={`${id}-error`} error={error} />
        </div>
    );
}

/** A labelled text area for notes, controlled, described and marked as `EditTextField` is. */
export function EditTextArea({
    id,
    name,
    label,
    value,
    onChange,
    hint,
    error,
    readOnly,
    placeholder,
    maxLength,
}: FieldProps) {
    return (
        <div className="space-y-1">
            <label htmlFor={id} className={LABEL_CLASS}>
                {label}
            </label>
            {hint && (
                <p id={`${id}-hint`} className={HINT_CLASS}>
                    {hint}
                </p>
            )}
            <textarea
                id={id}
                name={name}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                rows={3}
                readOnly={readOnly}
                placeholder={placeholder}
                maxLength={maxLength}
                aria-describedby={describedBy(id, hint, error)}
                aria-invalid={error ? true : undefined}
                className={`${INPUT_CLASS} resize-y`}
            />
            <FieldErrorText id={`${id}-error`} error={error} />
        </div>
    );
}

interface PendingSubmitProps {
    /** True while the form's action runs: it says `pendingLabel` and ignores clicks. */
    pending: boolean;
    pendingLabel: string;
    variant?: ButtonVariant;
    buttonRef?: Ref<HTMLButtonElement>;
    children: React.ReactNode;
}

/**
 * The submit button of a form that calls its action from `onSubmit` (convention
 * 15), with the pending state passed in, as Settings' Save is. It is
 * `aria-disabled` while pending, not `disabled`, so a keyboard user keeps
 * focus on it when the action comes back with a refusal.
 */
export function PendingSubmit({ pending, pendingLabel, variant = "primary", buttonRef, children }: PendingSubmitProps) {
    return (
        <button
            ref={buttonRef}
            type="submit"
            aria-disabled={pending}
            onClick={(event) => {
                // Stops the form submitting again; Enter in a field submits through this click too.
                if (pending) {
                    event.preventDefault();
                }
            }}
            className={buttonClasses(variant, pending)}
        >
            {pending ? pendingLabel : children}
        </button>
    );
}

/** The look of an alert that says what an action refused, or what failed. */
export const ALERT_BOX_CLASS =
    "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200";

/** The look of a status line that says what an action did. */
export const STATUS_CLASS = "text-sm font-medium text-green-700 dark:text-green-400";

/**
 * What an action refused, as an alert with a key that is new for every
 * response (`formStateKey`): an alert is announced when it appears, and
 * one repeated word for word would otherwise be silent. Nothing when the
 * state is not an error.
 */
export function FormAlert({ state }: { state: { status: string; message?: string } }) {
    if (state.status !== "error") {
        return null;
    }
    return (
        <p key={formStateKey(state)} role="alert" className={ALERT_BOX_CLASS}>
            {state.message}
        </p>
    );
}

/**
 * A status region that is always rendered, empty until there is news, as
 * the app's other status regions are: a live region added with its text in
 * it may not be announced. The form clears it while its action runs, so
 * the same words twice are a change it announces again.
 */
export function StatusLine({
    text,
    id,
    statusRef,
}: {
    text: string;
    id?: string;
    statusRef?: Ref<HTMLParagraphElement>;
}) {
    return (
        <p ref={statusRef} id={id} role="status" tabIndex={-1} className={`${STATUS_CLASS} focus:outline-none`}>
            {text}
        </p>
    );
}
