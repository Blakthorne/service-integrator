import { readValues, type FieldErrors, type FormValues } from "./forms";
import {
    parseHeaderLabel,
    parseSetting,
    type ScheduleHeaderLabels,
    type SettingKey,
} from "./settings";

/**
 * The Settings page's forms, one per card: the fields each posts, and how
 * its action reads them. A reader parses every field with the registry's own
 * parser (lib/settings.ts), so the form, the action and the stored value
 * agree on what is valid, and it collects every field's problem at once, not
 * the first. The action then saves what it read (`saveSettings`) and gives
 * the form `shown` back, so the fields show what was stored: a trimmed
 * number, a separator exactly as typed.
 *
 * Pure and safe on both sides: the forms take their field names from here,
 * and the actions (app/(app)/settings/actions.ts) take the readers.
 */

/** The Copyright form's field. Each field is named for the setting it holds. */
export const CCLI_LICENSE_NUMBER_FIELD = "ccliLicenseNumber" satisfies SettingKey;

/** The Schedule text form's separator field; its header labels are `headerLabelField(id)`. */
export const NUMBER_SEPARATOR_FIELD = "numberSeparator" satisfies SettingKey;

/** The Hymnal notes form's fields. */
export const CATEGORY_NAME_FIELD = "hymnNoteCategoryName" satisfies SettingKey;
export const INCLUDES_TUNE_FIELD = "hymnNoteIncludesTune" satisfies SettingKey;

/** What a yes-or-no field posts: a checkbox is posted through a hidden field, since an unchecked box posts nothing. */
export const YES = "yes";
export const NO = "no";

const HEADER_LABEL_FIELD_PREFIX = "headerLabel-";

/** The name of the field that holds the header label of the service type with this Planning Center id. */
export function headerLabelField(serviceTypeId: string): string {
    return `${HEADER_LABEL_FIELD_PREFIX}${serviceTypeId}`;
}

/** What reading a form came to. */
export type SettingsFormRead =
    | {
          ok: true;
          /** What to save, by setting key, each value as its setting parses it. */
          values: Record<string, unknown>;
          /**
           * What each field holds once this is saved, as text by field name:
           * the value as parsed (a trimmed number; "yes" or "no").
           */
          shown: FormValues;
          /** What was posted, as text by field name, untrimmed. */
          posted: FormValues;
      }
    | {
          ok: false;
          /** What is wrong, by field name: every field that is wrong, at once. */
          fieldErrors: FieldErrors;
          /** What was posted, as text by field name, untrimmed. */
          posted: FormValues;
      };

/** What a reader has made of the fields so far. */
interface Collected {
    values: Record<string, unknown>;
    shown: FormValues;
    fieldErrors: FieldErrors;
}

function emptyCollected(): Collected {
    return { values: {}, shown: {}, fieldErrors: {} };
}

/** A value as the field that holds it shows it. */
function shownText(value: unknown): string {
    return typeof value === "boolean" ? (value ? YES : NO) : String(value);
}

/** Parse `raw`, posted in `field`, as setting `key`: collect its value, or the field's error. */
function take<K extends SettingKey>(into: Collected, key: K, field: string, raw: unknown): void {
    const parsed = parseSetting(key, raw);
    if (parsed.ok) {
        into.values[key] = parsed.value;
        into.shown[field] = shownText(parsed.value);
    } else {
        into.fieldErrors[field] = { message: parsed.message };
    }
}

function finish(into: Collected, posted: FormValues): SettingsFormRead {
    return Object.keys(into.fieldErrors).length > 0
        ? { ok: false, fieldErrors: into.fieldErrors, posted }
        : { ok: true, values: into.values, shown: into.shown, posted };
}

/** The Copyright form: the CCLI license number, trimmed by its parser. */
export function readCopyrightForm(formData: FormData): SettingsFormRead {
    const posted = readValues(formData, [CCLI_LICENSE_NUMBER_FIELD]);
    const into = emptyCollected();
    take(into, "ccliLicenseNumber", CCLI_LICENSE_NUMBER_FIELD, posted[CCLI_LICENSE_NUMBER_FIELD]);
    return finish(into, posted);
}

/** The names of the header label fields a form posted, each once. */
function headerLabelFieldsPosted(formData: FormData): string[] {
    const names = new Set<string>();
    for (const name of formData.keys()) {
        if (name.startsWith(HEADER_LABEL_FIELD_PREFIX)) {
            names.add(name);
        }
    }
    return [...names];
}

/**
 * The Schedule text form: a header label for each service type it lists
 * (`headerLabelField`) and the number separator.
 *
 * - **A blank label is no label of its own**: the service type gets the
 *   default for its name (`defaultScheduleHeaderLabel`), so its entry is
 *   dropped from the saved labels rather than saved as "", which would mean
 *   no header at all.
 * - **Labels the form did not post are kept as they are** (`stored`): the
 *   form lists only the service types Planning Center gave it, so the labels
 *   of an archived type, or of every type when Planning Center could not be
 *   reached, must not be lost by saving.
 * - **The separator is read as typed**, never trimmed: the spaces in " / "
 *   are part of it.
 * - A field named for something that is not a service type's id (a form
 *   that was tampered with) is an error on that field. `parseServiceTypeId`
 *   is the parser for a Planning Center id (`parsePcoId`, which is
 *   server-only, so the action passes it in).
 */
export function readScheduleTextForm(
    formData: FormData,
    stored: ScheduleHeaderLabels,
    parseServiceTypeId: (raw: string) => string | null
): SettingsFormRead {
    const labelFields = headerLabelFieldsPosted(formData);
    const posted = readValues(formData, [NUMBER_SEPARATOR_FIELD, ...labelFields]);
    const into = emptyCollected();
    const labels: Record<string, string> = { ...stored };
    for (const field of labelFields) {
        const serviceTypeId = parseServiceTypeId(field.slice(HEADER_LABEL_FIELD_PREFIX.length));
        if (serviceTypeId === null) {
            into.fieldErrors[field] = { message: "That is not a service type's id." };
            continue;
        }
        const parsed = parseHeaderLabel(posted[field]);
        if (!parsed.ok) {
            into.fieldErrors[field] = { message: parsed.message };
            continue;
        }
        if (parsed.value === "") {
            delete labels[serviceTypeId];
        } else {
            labels[serviceTypeId] = parsed.value;
        }
        into.shown[field] = parsed.value;
    }
    take(into, "numberSeparator", NUMBER_SEPARATOR_FIELD, posted[NUMBER_SEPARATOR_FIELD]);
    if (Object.keys(into.fieldErrors).length === 0) {
        into.values.scheduleHeaderLabels = labels;
    }
    return finish(into, posted);
}

/**
 * The Hymnal notes form: the category's name (trimmed by its parser) and
 * whether a note names the tune, posted as "yes" or "no". Anything else
 * goes to the parser as it is, so it refuses it with its own message.
 */
export function readHymnalNotesForm(formData: FormData): SettingsFormRead {
    const posted = readValues(formData, [CATEGORY_NAME_FIELD, INCLUDES_TUNE_FIELD]);
    const into = emptyCollected();
    take(into, "hymnNoteCategoryName", CATEGORY_NAME_FIELD, posted[CATEGORY_NAME_FIELD]);
    const includesTune = posted[INCLUDES_TUNE_FIELD];
    take(
        into,
        "hymnNoteIncludesTune",
        INCLUDES_TUNE_FIELD,
        includesTune === YES ? true : includesTune === NO ? false : includesTune
    );
    return finish(into, posted);
}

/** True when two forms' values are the same, field for field. */
export function sameValues(a: FormValues, b: FormValues): boolean {
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}
