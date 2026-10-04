import {
    CREDIT_PAIR_PHRASE_FIELD,
    CREDIT_ROLE_FIELD_PREFIX,
    creditPhraseField,
    creditRoleField,
} from "./creditRows";
import { phraseFor } from "./credits";
import {
    readOptionalPositiveInteger,
    readValues,
    type FieldErrors,
    type FormState,
    type FormValues,
} from "./forms";
import {
    parseCreditPhrase,
    parseCreditRole,
    parseEmailAddress,
    parseHeaderLabel,
    parseSetting,
    type ScheduleHeaderLabels,
    type SettingKey,
    type SettingParse,
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

/**
 * The Credits form's fields: a role and a phrase for each row
 * (`creditRoleField`, `creditPhraseField`: lib/creditRows.ts), and the
 * phrase for the first two roles held by the same people. Errors about the
 * list of roles as a whole (too few, too many) are marked on
 * `CREDIT_ROLES_FIELD`, which no input has: the form shows it under the list.
 */
export const CREDIT_ROLES_FIELD = "creditRoles" satisfies SettingKey;

/** Where an error about the phrases as a whole is marked, as `CREDIT_ROLES_FIELD` is for the roles. */
export const CREDIT_PHRASES_FIELD = "creditPhrases" satisfies SettingKey;

/**
 * The Credits form's confirmation that saving its roles changes songs'
 * copyright text (lib/creditRoleImpact.ts): a checkbox, shown only when it
 * would, that posts how many songs it confirmed. Its refusals are marked on
 * it. It holds no setting, so it is not one of the form's values.
 */
export const CREDIT_ROLES_CONFIRM_FIELD = "creditRolesConfirmed";

/** The Email form's fields, each named for the setting it holds. */
export const EMAIL_RECIPIENTS_FIELD = "emailRecipients" satisfies SettingKey;
export const EMAIL_SUBJECT_FIELD = "emailSubjectTemplate" satisfies SettingKey;

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

/** The names of a role field: its prefix and a row number of at most three digits. */
const CREDIT_ROW_FIELD = new RegExp(`^${CREDIT_ROLE_FIELD_PREFIX}(0|[1-9][0-9]{0,2})$`);

/** The row numbers of the role fields a form posted, once each, in order. A field that is not one is not a row. */
function creditRowsPosted(formData: FormData): number[] {
    const indexes = new Set<number>();
    for (const name of formData.keys()) {
        const match = CREDIT_ROW_FIELD.exec(name);
        if (match !== null) {
            indexes.add(Number(match[1]));
        }
    }
    return [...indexes].sort((a, b) => a - b);
}

/** A phrase typed in the form: blank is no phrase of its own (null), else what `parseCreditPhrase` takes. */
function readPhrase(text: string): SettingParse<string | null> {
    if (text.trim() === "") {
        return { ok: true, value: null };
    }
    return parseCreditPhrase(text);
}

/** A row of the Credits form as far as it reads: its role (null if refused) and the phrase typed (null if blank or refused). */
interface ReadRow {
    role: string | null;
    phrase: string | null;
}

/**
 * The Credits form: a role and a phrase for each row, in the order they
 * stand, and the phrase for the first two roles held by the same people.
 *
 * - **Every field is checked on its own**, with the registry's parsers, so
 *   the refusal marks the field: a role that is blank, too long or has a
 *   separator in it, a role listed twice (the later row is marked), a phrase
 *   that is too long. Only when every field is fine are the roles checked as
 *   a list (at least two, at most 12), which marks `CREDIT_ROLES_FIELD`.
 * - **A blank phrase is no phrase of its own**: the copyright text prints
 *   "<role> by" for it, so it is not saved, and the form shows that text.
 * - **What is saved replaces every phrase.** Only a phrase for each role and
 *   the one for the first two roles are edited here, so a phrase saved
 *   under a role that was renamed or removed goes with it.
 * - `shown` holds each field as the form shows it after the save: the role
 *   trimmed and each phrase as the text prints it (a blank one filled in).
 */
export function readCreditsForm(formData: FormData): SettingsFormRead {
    const indexes = creditRowsPosted(formData);
    const posted = readValues(formData, [
        ...indexes.flatMap((index) => [creditRoleField(index), creditPhraseField(index)]),
        CREDIT_PAIR_PHRASE_FIELD,
    ]);
    const into = emptyCollected();
    const rows: ReadRow[] = [];
    const seen = new Set<string>();
    for (const index of indexes) {
        const roleField = creditRoleField(index);
        const phraseField = creditPhraseField(index);
        const row: ReadRow = { role: null, phrase: null };
        const role = parseCreditRole(posted[roleField]);
        if (!role.ok) {
            into.fieldErrors[roleField] = { message: role.message };
        } else if (seen.has(role.value.toLowerCase())) {
            into.fieldErrors[roleField] = {
                message: `The role ${JSON.stringify(role.value)} is listed twice.`,
            };
        } else {
            seen.add(role.value.toLowerCase());
            row.role = role.value;
        }
        const phrase = readPhrase(posted[phraseField]);
        if (phrase.ok) {
            row.phrase = phrase.value;
        } else {
            into.fieldErrors[phraseField] = { message: phrase.message };
        }
        rows.push(row);
    }
    const pair = readPhrase(posted[CREDIT_PAIR_PHRASE_FIELD]);
    if (!pair.ok) {
        into.fieldErrors[CREDIT_PAIR_PHRASE_FIELD] = { message: pair.message };
    }
    if (Object.keys(into.fieldErrors).length > 0 || !pair.ok) {
        return finish(into, posted);
    }

    const roles = rows.map((row) => row.role ?? "");
    const listed = parseSetting("creditRoles", roles);
    if (!listed.ok) {
        into.fieldErrors[CREDIT_ROLES_FIELD] = { message: listed.message };
        return finish(into, posted);
    }
    const typed: Record<string, string> = {};
    rows.forEach((row, i) => {
        if (row.phrase !== null) {
            typed[roles[i]] = row.phrase;
        }
    });
    if (pair.value !== null) {
        typed[`${roles[0]} & ${roles[1]}`] = pair.value;
    }
    const phrases = parseSetting("creditPhrases", typed);
    if (!phrases.ok) {
        into.fieldErrors[CREDIT_PHRASES_FIELD] = { message: phrases.message };
        return finish(into, posted);
    }
    into.values.creditRoles = listed.value;
    into.values.creditPhrases = phrases.value;
    indexes.forEach((index, i) => {
        into.shown[creditRoleField(index)] = roles[i];
        into.shown[creditPhraseField(index)] = phraseFor([roles[i]], phrases.value);
    });
    into.shown[CREDIT_PAIR_PHRASE_FIELD] = phraseFor([roles[0], roles[1]], phrases.value);
    return finish(into, posted);
}

/**
 * The roles a Credits form read, in order, as they would be saved; null
 * when the form was refused. What saving them would do to songs is checked
 * with these (lib/creditRoleImpact.ts).
 */
export function creditRolesOf(read: SettingsFormRead): readonly string[] | null {
    if (!read.ok) {
        return null;
    }
    const roles = parseSetting("creditRoles", read.values.creditRoles);
    return roles.ok ? roles.value : null;
}

/**
 * How many songs the Credits form's checkbox confirmed would change
 * (`CREDIT_ROLES_CONFIRM_FIELD`), or null when it confirmed nothing: the
 * box was not ticked (it then posts nothing), or what it posted is not a
 * whole number of at least 1.
 */
export function readCreditRolesConfirmation(formData: FormData): number | null {
    const confirmed = readOptionalPositiveInteger(formData, CREDIT_ROLES_CONFIRM_FIELD);
    return confirmed.ok ? confirmed.value : null;
}

/** What separates the recipients typed in the Email form: a line break, a comma or a semicolon. */
const RECIPIENT_SEPARATORS = /[\n\r,;]+/;

/** The entries of the recipients field: split at line breaks, commas and semicolons, trimmed, with the blank ones left out. */
export function splitRecipients(text: string): string[] {
    return text
        .split(RECIPIENT_SEPARATORS)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
}

/** The most entries named in a message about entries that are not addresses. */
const NAMED_ENTRIES_MAX = 3;

/** What the recipients field says of entries that are not email addresses (at least one): the first few, named. */
function notAddressesMessage(entries: readonly string[]): string {
    if (entries.length === 1) {
        const parsed = parseEmailAddress(entries[0]);
        return parsed.ok ? "That is not an email address." : parsed.message;
    }
    const named = entries
        .slice(0, NAMED_ENTRIES_MAX)
        .map((entry) => JSON.stringify(entry.length > 40 ? `${entry.slice(0, 40)}…` : entry));
    const more = entries.length > NAMED_ENTRIES_MAX ? ` and ${entries.length - NAMED_ENTRIES_MAX} more` : "";
    return `${entries.length} entries are not email addresses: ${named.join(", ")}${more}. Each is like name@example.org.`;
}

/**
 * The Email form: the recipients, one per line or separated by commas or
 * semicolons (`splitRecipients`), and the subject.
 *
 * - **Every entry is checked as an address** (`parseEmailAddress`) and the
 *   field says which are not, all at once; only then is the list checked
 *   (no address twice, at most 25). A blank field is fine: no one is
 *   emailed until there are recipients.
 * - The subject is parsed as the registry does (trimmed, not blank, only
 *   `{date}` and `{service}`).
 * - `shown` has the recipients one to a line, as saved.
 */
export function readEmailForm(formData: FormData): SettingsFormRead {
    const posted = readValues(formData, [EMAIL_RECIPIENTS_FIELD, EMAIL_SUBJECT_FIELD]);
    const into = emptyCollected();
    const entries = splitRecipients(posted[EMAIL_RECIPIENTS_FIELD]);
    const refused = entries.filter((entry) => !parseEmailAddress(entry).ok);
    if (refused.length > 0) {
        into.fieldErrors[EMAIL_RECIPIENTS_FIELD] = { message: notAddressesMessage(refused) };
    } else {
        const recipients = parseSetting("emailRecipients", entries);
        if (recipients.ok) {
            into.values.emailRecipients = recipients.value;
            into.shown[EMAIL_RECIPIENTS_FIELD] = recipients.value.join("\n");
        } else {
            into.fieldErrors[EMAIL_RECIPIENTS_FIELD] = { message: recipients.message };
        }
    }
    take(into, "emailSubjectTemplate", EMAIL_SUBJECT_FIELD, posted[EMAIL_SUBJECT_FIELD]);
    return finish(into, posted);
}

/** True when two forms' values are the same, field for field. */
export function sameValues(a: FormValues, b: FormValues): boolean {
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

/**
 * What a form's fields hold once its action has answered with `state`: after
 * a save, exactly the fields the save posted and what each now holds (a
 * trimmed number), else what they held. The saved fields replace the held
 * ones rather than add to them: a form's fields can change between renders
 * (the Schedule text form lists the service types Planning Center gave it,
 * and a later read may fail), and a field the form no longer has must not
 * stay behind to make the form look unsaved.
 */
export function valuesAfterSave(current: FormValues, state: FormState): FormValues {
    return state.status === "success" ? state.values : current;
}

/** True while a form that shows `values` shows exactly what `state` says was saved, so its "Saved." is still true. */
export function isSaved(values: FormValues, state: FormState): boolean {
    return state.status === "success" && sameValues(values, state.values);
}
