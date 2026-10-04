import { formStateKey, type FieldError } from "@/lib/forms";
import { FieldErrorText, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from "../Catalog/SongForm/Fields";
import SaveButton from "./SaveButton";
import type { SettingsForm } from "./useSettingsForm";

interface SettingsTextFieldProps {
    /** The input's id, unique on the page. */
    id: string;
    /** The field's name in the form data. */
    name: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** A sentence under the label, such as an example or what leaving the field blank does. */
    hint?: string;
    /**
     * What the value makes, under the field, such as "R-396 / G-317". It
     * describes the input (`aria-describedby`), so it is read when the field
     * gets focus, not at every keystroke.
     */
    preview?: React.ReactNode;
    /** What the action found wrong with the field. */
    error?: FieldError;
    inputMode?: "text" | "numeric";
    placeholder?: string;
    autoCapitalize?: "none" | "sentences";
}

/**
 * A labelled text field of a Settings form, whose value lives in the form's
 * state (`useSettingsForm`), so the preview under it follows what is typed.
 * Its hint, preview and error all describe it, and an error marks it
 * invalid. The value is never trimmed here: a separator's spaces are part
 * of it.
 */
export function SettingsTextField({
    id,
    name,
    label,
    value,
    onChange,
    hint,
    preview,
    error,
    inputMode,
    placeholder,
    autoCapitalize,
}: SettingsTextFieldProps) {
    const hintId = `${id}-hint`;
    const previewId = `${id}-preview`;
    const errorId = `${id}-error`;
    const describedBy =
        [hint ? hintId : null, preview ? previewId : null, error ? errorId : null]
            .filter(Boolean)
            .join(" ") || undefined;
    return (
        <div className="space-y-1">
            <label htmlFor={id} className={LABEL_CLASS}>
                {label}
            </label>
            {hint && (
                <p id={hintId} className={HINT_CLASS}>
                    {hint}
                </p>
            )}
            <input
                id={id}
                name={name}
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                inputMode={inputMode}
                placeholder={placeholder}
                autoComplete="off"
                autoCapitalize={autoCapitalize}
                spellCheck={false}
                aria-describedby={describedBy}
                aria-invalid={error ? true : undefined}
                className={INPUT_CLASS}
            />
            {preview && (
                <p id={previewId} className={HINT_CLASS}>
                    {preview}
                </p>
            )}
            <FieldErrorText id={errorId} error={error} />
        </div>
    );
}

/** A sample of what a setting writes, set apart in a preview: its spaces are kept as they are. */
export function PreviewSample({ children }: { children: React.ReactNode }) {
    return (
        <span className="whitespace-pre-wrap break-words font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {children}
        </span>
    );
}

interface SettingsFormFooterProps {
    /** The form's state, from `useSettingsForm`. */
    form: Pick<SettingsForm, "state" | "pending" | "saved">;
    /** The Save button's text, naming its card: "Save copyright". */
    saveLabel: string;
}

/**
 * The bottom of a Settings form: what the action refused, then the Save
 * button and, once saved, a "Saved." that goes away when a field changes.
 *
 * The refusal sits right above the button, not at the top of the card: a
 * card is taller than a phone's screen, and the button is where the person
 * is looking when they save. Both messages get a key that is new for every
 * response (`formStateKey`), because a screen reader announces an alert or a
 * status when it appears or changes, and a refusal, or a save, repeated word
 * for word would otherwise be silent.
 */
export function SettingsFormFooter({ form, saveLabel }: SettingsFormFooterProps) {
    const { state, pending, saved } = form;
    return (
        <div className="space-y-3">
            {state.status === "error" && (
                <p
                    key={formStateKey(state)}
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                >
                    {state.message}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <SaveButton pending={pending}>{saveLabel}</SaveButton>
                {saved && state.status === "success" && (
                    <p
                        key={formStateKey(state)}
                        role="status"
                        className="text-sm font-medium text-green-700 dark:text-green-400"
                    >
                        {state.message}
                    </p>
                )}
            </div>
        </div>
    );
}
