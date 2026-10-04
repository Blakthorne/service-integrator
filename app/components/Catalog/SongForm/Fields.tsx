import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { FieldError } from "@/lib/forms";
import { LINK_CLASS } from "../CatalogCard";

/** The look of a text field, as the catalog's search fields have it. */
export const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 aria-[invalid=true]:border-red-500 dark:aria-[invalid=true]:border-red-400";

/** The look of a field's label. */
export const LABEL_CLASS = "block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300";

/** The look of a sentence that explains a field or a part of the form. */
export const HINT_CLASS = "text-sm text-gray-600 dark:text-gray-400";

interface FieldErrorTextProps {
    /** The id the field it describes names in `aria-describedby`. */
    id: string;
    error: FieldError | undefined;
}

/**
 * A field's error from the action, under the field, with a link to what it
 * clashes with when it has one ("See Holy, Holy, Holy (NICAEA)"). Nothing
 * when the field has no error.
 */
export function FieldErrorText({ id, error }: FieldErrorTextProps) {
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
                    <Link href={error.link.href as Route} className={`font-medium ${LINK_CLASS}`}>
                        {error.link.label}
                    </Link>
                    .
                </>
            )}
        </p>
    );
}

interface TextFieldProps {
    id: string;
    /** The field's name in the form data. */
    name: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** A sentence under the label, such as an example. */
    hint?: string;
    /** The id of the error that describes the field, when it has one. */
    errorId?: string;
    inputMode?: "text" | "numeric";
    placeholder?: string;
    maxLength?: number;
}

/**
 * A labelled text field whose value lives in the form's state. It stays
 * controlled, so the reset React does after a form action keeps it.
 */
export function TextField({
    id,
    name,
    label,
    value,
    onChange,
    hint,
    errorId,
    inputMode,
    placeholder,
    maxLength,
}: TextFieldProps) {
    const hintId = `${id}-hint`;
    return (
        <div>
            <label htmlFor={id} className={LABEL_CLASS}>
                {label}
            </label>
            {hint && (
                <p id={hintId} className={`mb-1 ${HINT_CLASS}`}>
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
                maxLength={maxLength}
                autoComplete="off"
                aria-describedby={[hint ? hintId : null, errorId].filter(Boolean).join(" ") || undefined}
                aria-invalid={errorId ? true : undefined}
                className={INPUT_CLASS}
            />
        </div>
    );
}

interface PartProps {
    /** The legend: "Hymn", "Tune", "First entry". */
    legend: string;
    /** What the part is for, under the legend. */
    description: string;
    /** The id of the part's error, when it has one; the whole part is described by it. */
    errorId?: string;
    children: ReactNode;
}

/** One part of the form, as a fieldset with its legend, its explanation and its fields. */
export function FormPart({ legend, description, errorId, children }: PartProps) {
    return (
        // min-w-0: a fieldset is otherwise as wide as its widest content,
        // so a row of buttons would widen the form past a phone's screen.
        <fieldset aria-describedby={errorId} className="min-w-0 space-y-3">
            {/* A legend sits on its fieldset's border, so the rule above each
                part is a line of its own, not the fieldset's border. */}
            <legend className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {legend}
            </legend>
            <p className={HINT_CLASS}>{description}</p>
            {children}
        </fieldset>
    );
}

const NOTICE_TONES = {
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    warning:
        "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
} as const;

interface FormNoticeProps {
    tone: keyof typeof NOTICE_TONES;
    children: ReactNode;
}

/** A boxed note at the top of the form, such as the Planning Center song it links. */
export function FormNotice({ tone, children }: FormNoticeProps) {
    return (
        <div className={`rounded-lg border px-4 py-3 text-sm space-y-2 ${NOTICE_TONES[tone]}`}>
            {children}
        </div>
    );
}
