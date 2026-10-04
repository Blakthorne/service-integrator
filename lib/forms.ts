/**
 * Forms whose action is a server action: the state an action hands back to
 * its form, and readers for the fields it posts. Pure and safe on both sides:
 * actions read their `FormData` with these, and client forms render the
 * `FormState` that `useActionState` gives them.
 *
 * An action is `(state: FormState, formData: FormData) => Promise<FormState>`.
 * It checks the session, reads and validates the fields, writes, and then
 * redirects (after creating something) or returns "success"; when it
 * refuses, it returns "error" with what to fix. Both carry the values the
 * form posted, as text: React resets a form's uncontrolled fields after its
 * action, so a form that shows them again reads them from here.
 */

/** A link from an error to what it is about, such as the song that already has a number. */
export interface FormLink {
    /** An internal path, built by `lib/routes.ts`. */
    href: string;
    label: string;
}

/** What is wrong with one field (or one group of fields), and what it points at. */
export interface FieldError {
    message: string;
    link?: FormLink;
}

/** A form's errors by field name; a field that is fine has none. */
export type FieldErrors<F extends string = string> = Partial<Record<F, FieldError>>;

/** What a form posted, as text by field name, for the form to show again. */
export type FormValues = Record<string, string>;

/**
 * Where a form stands, as its action returns it to `useActionState`:
 *
 * - "idle": nothing has been submitted yet;
 * - "error": refused or failed. `message` says so for the whole form, and
 *   `fieldErrors` mark the fields to fix (none when the form as a whole was
 *   refused);
 * - "success": done, with a message to show. An action that creates
 *   something redirects instead.
 */
export type FormState<F extends string = string> =
    | { status: "idle" }
    | {
          status: "error";
          message: string;
          fieldErrors: FieldErrors<F>;
          values: FormValues;
      }
    | { status: "success"; message: string; values: FormValues };

/** The state of a form before its first submission: `useActionState(action, IDLE_FORM)`. */
export const IDLE_FORM = { status: "idle" } as const satisfies FormState;

/**
 * What an action says when something it did not expect failed (the database,
 * Planning Center), after it has logged the cause. Its writes are one
 * transaction, so nothing changed.
 */
export const FORM_FAILURE_MESSAGE =
    "Something went wrong, so nothing was changed. Try again; the server log has the details.";

/** An "error" state: `message` for the whole form, and the fields to fix, if any. */
export function formError<F extends string = string>(
    message: string,
    { fieldErrors = {}, values = {} }: { fieldErrors?: FieldErrors<F>; values?: FormValues } = {}
): FormState<F> {
    return { status: "error", message, fieldErrors, values };
}

/** A "success" state, with the message to show. */
export function formSuccess<F extends string = string>(
    message: string,
    values: FormValues = {}
): FormState<F> {
    return { status: "success", message, values };
}

/** The error of field `name` in `state`, if it has one. */
export function fieldErrorOf<F extends string>(
    state: FormState<F>,
    name: F
): FieldError | undefined {
    return state.status === "error" ? state.fieldErrors[name] : undefined;
}

/** A field's text as posted, or null when the form has no such field or sent a file in it. */
function rawText(formData: FormData, name: string): string | null {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
}

/** A field's text, trimmed: "" when the field is missing, empty or a file. */
export function readString(formData: FormData, name: string): string {
    return rawText(formData, name)?.trim() ?? "";
}

/** A field's text, trimmed, or null when it is missing, blank or a file. */
export function readOptionalString(formData: FormData, name: string): string | null {
    const text = readString(formData, name);
    return text === "" ? null : text;
}

/**
 * What a reader made of an optional field that must be well formed when it
 * is filled in: its value (null when left blank), or `ok: false` when what
 * was typed is not one.
 */
export type OptionalField<T> = { ok: true; value: T | null } | { ok: false };

/** Only ASCII digits: no sign, point, exponent or space inside. */
const DIGITS = /^[0-9]+$/;

/**
 * An optional whole number of at least 1 and at most `max`: "396" is 396,
 * and a blank field is null. Spaces around it are fine, and so are leading
 * zeros ("007" is 7). Not a number: "0", "-1", "+1", "1.5", "1e3", "3 96",
 * "abc", full-width digits, anything over `max` (by default the largest
 * safe integer), and a file.
 */
export function readOptionalPositiveInteger(
    formData: FormData,
    name: string,
    { max = Number.MAX_SAFE_INTEGER }: { max?: number } = {}
): OptionalField<number> {
    const raw = formData.get(name);
    if (raw === null) {
        return { ok: true, value: null };
    }
    if (typeof raw !== "string") {
        return { ok: false };
    }
    const text = raw.trim();
    if (text === "") {
        return { ok: true, value: null };
    }
    if (!DIGITS.test(text)) {
        return { ok: false };
    }
    const value = Number(text);
    return value >= 1 && value <= max ? { ok: true, value } : { ok: false };
}

/**
 * An ID from a field (often a hidden one), through the parser for its kind
 * (convention 19), such as `readId(formData, "songId", parseCatalogId)`. It
 * is not trimmed: an ID is never typed. Null when the field is missing, is a
 * file, or does not parse.
 */
export function readId<T>(
    formData: FormData,
    name: string,
    parse: (raw: unknown) => T | null
): T | null {
    const raw = rawText(formData, name);
    return raw === null ? null : parse(raw);
}

/**
 * The text of each named field as posted, for `FormState.values`: untrimmed,
 * so the form shows what was typed; "" for a field that is missing or a file.
 */
export function readValues<F extends string>(
    formData: FormData,
    names: readonly F[]
): Record<F, string> {
    const values = {} as Record<F, string>;
    for (const name of names) {
        values[name] = rawText(formData, name) ?? "";
    }
    return values;
}
