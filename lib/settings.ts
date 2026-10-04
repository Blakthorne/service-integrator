import type { ServiceType } from "./domain";

/**
 * The app's settings: a typed registry in which every key has a parser, which
 * turns what is stored (JSON) or typed into a valid value or says why it is
 * not one, and a default. The defaults reproduce the text the app wrote
 * before settings existed, so nothing changes until something is saved. A
 * stored value that no longer parses falls back to its default and is
 * reported (`resolveSettings`).
 *
 * Pure and safe on both sides: lib/db/settings.ts stores the values,
 * lib/queries/settings.ts reads and saves them, and the text functions
 * (lib/copyright.ts, lib/credits.ts, lib/serviceSchedule.ts,
 * lib/hymnNotes.ts) take what they need of them as arguments.
 */

/**
 * The schedule text's header label for each service type, by the type's
 * Planning Center id. An empty label means no header.
 */
export type ScheduleHeaderLabels = Readonly<Record<string, string>>;

/**
 * What the copyright text prints before the names of a credit role, by
 * role ("Words": "Words by"), and before the names of two roles the same
 * people hold, by the two roles joined with " & " ("Words & Music": "Words
 * and Music by").
 */
export type CreditPhrases = Readonly<Record<string, string>>;

/** Every setting, by key. */
export interface AppSettings {
    /** The church's CCLI Streaming License number, on the last line of every copyright block. */
    ccliLicenseNumber: string;
    /**
     * The schedule text's header label for each service type, by its id
     * ("Sunday AM"); "" for no header. A service type with no entry keeps
     * the label it always had (see `scheduleHeaderLabel`).
     */
    scheduleHeaderLabels: ScheduleHeaderLabels;
    /** What goes between a song's numbers, in the schedule text and the hymnal notes: "R-396 / G-317". */
    numberSeparator: string;
    /** The item note category the hymnal notes go in, found by name in each service type. */
    hymnNoteCategoryName: string;
    /** Whether a hymnal note names the tune after the numbers: "R-396 / G-317 · ST. ANNE". */
    hymnNoteIncludesTune: boolean;
    /**
     * The roles a song's credits name, in the order they are written and
     * printed: the labels of the credits convention in Planning Center's
     * author field (`Words: Isaac Watts; Music: Lowell Mason`), matched
     * without regard to case. The first two are the words' and the music's:
     * an author with no labels is read as naming those two.
     */
    creditRoles: readonly string[];
    /**
     * What the copyright text prints before each role's names, and before
     * the names of two roles the same people hold (see `CreditPhrases`). A
     * role without a phrase prints "<role> by", and two without one print
     * "<role> and <role> by".
     */
    creditPhrases: CreditPhrases;
    /** The addresses a plan's email goes to; none until some are saved. */
    emailRecipients: readonly string[];
    /**
     * A plan email's subject. `{date}` becomes the plan's date and
     * `{service}` its service type's name (see `EMAIL_SUBJECT_PLACEHOLDERS`).
     */
    emailSubjectTemplate: string;
}

export type SettingKey = keyof AppSettings;

/** What each setting is until something is saved: the app's text as it was before settings. */
export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
    ccliLicenseNumber: "1564484",
    scheduleHeaderLabels: Object.freeze({}),
    numberSeparator: " / ",
    hymnNoteCategoryName: "Hymnal",
    hymnNoteIncludesTune: false,
    creditRoles: Object.freeze(["Words", "Music", "Arr.", "Trans."]),
    creditPhrases: Object.freeze({
        Words: "Words by",
        Music: "Music by",
        "Words & Music": "Words and Music by",
        "Arr.": "Arr. by",
        "Trans.": "Trans. by",
    }),
    emailRecipients: Object.freeze([]),
    emailSubjectTemplate: "Songs for {date} · {service}",
});

/** What a parser made of a value: the setting's value, or why it is not one, fit to show. */
export type SettingParse<T> = { ok: true; value: T } | { ok: false; message: string };

/** One key of the registry. */
export interface SettingDefinition<T> {
    /** The value until one is saved. */
    readonly defaultValue: T;
    /** Turn a stored (JSON) or submitted value into the setting's value, or say why it is not one. */
    readonly parse: (value: unknown) => SettingParse<T>;
}

/** The longest CCLI license number taken. */
const CCLI_MAX_DIGITS = 20;
/** The longest header label taken. */
export const HEADER_LABEL_MAX_LENGTH = 40;
/** The longest number separator taken. */
export const NUMBER_SEPARATOR_MAX_LENGTH = 10;
/** The longest category name taken. */
export const CATEGORY_NAME_MAX_LENGTH = 100;
/** The longest credit role taken. */
export const CREDIT_ROLE_MAX_LENGTH = 30;
/** The most credit roles taken. */
export const CREDIT_ROLES_MAX = 12;
/** The longest credit phrase taken. */
export const CREDIT_PHRASE_MAX_LENGTH = 40;
/** The most credit phrases taken: one for each role and for each pair of roles next to each other. */
export const CREDIT_PHRASES_MAX = 2 * CREDIT_ROLES_MAX - 1;
/** The most email recipients taken. */
export const EMAIL_RECIPIENTS_MAX = 25;
/** The longest email address taken (RFC 5321's limit on a forward path). */
export const EMAIL_ADDRESS_MAX_LENGTH = 254;
/** The longest email subject template taken. */
export const EMAIL_SUBJECT_MAX_LENGTH = 150;

/**
 * The placeholders a plan email's subject may hold, as `{name}`: the plan's
 * date and its service type's name.
 */
export const EMAIL_SUBJECT_PLACEHOLDERS = ["date", "service"] as const;

/** A Planning Center id, as `parsePcoId` (server-only) accepts it. */
const PCO_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

function refuse<T>(message: string): SettingParse<T> {
    return { ok: false, message };
}

/** True when `text` has a control character, such as a line break or a tab. */
function hasControlCharacter(text: string): boolean {
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
            return true;
        }
    }
    return false;
}

/** `value` quoted and cut short, to name it in a message. */
function quoted(value: string): string {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
}

function parseCcliLicenseNumber(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("The CCLI license number must be text.");
    }
    const text = value.trim();
    if (text === "") {
        return refuse("Enter the CCLI license number.");
    }
    if (!/^[0-9]+$/.test(text) || text.length > CCLI_MAX_DIGITS) {
        return refuse(
            `A CCLI license number is digits only, at most ${CCLI_MAX_DIGITS} of them, such as 1564484.`
        );
    }
    return { ok: true, value: text };
}

/** A header label: trimmed, on one line, at most `HEADER_LABEL_MAX_LENGTH` characters; "" for no header. */
export function parseHeaderLabel(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("A header label must be text.");
    }
    const text = value.trim();
    if (hasControlCharacter(text)) {
        return refuse("A header label must be on one line.");
    }
    if (text.length > HEADER_LABEL_MAX_LENGTH) {
        return refuse(`A header label is at most ${HEADER_LABEL_MAX_LENGTH} characters.`);
    }
    return { ok: true, value: text };
}

function parseScheduleHeaderLabels(value: unknown): SettingParse<ScheduleHeaderLabels> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return refuse("The header labels must be a label for each service type.");
    }
    const labels: Record<string, string> = {};
    for (const [serviceTypeId, label] of Object.entries(value)) {
        if (!PCO_ID_PATTERN.test(serviceTypeId)) {
            return refuse(`${quoted(serviceTypeId)} is not a service type's id.`);
        }
        const parsed = parseHeaderLabel(label);
        if (!parsed.ok) {
            return parsed;
        }
        labels[serviceTypeId] = parsed.value;
    }
    return { ok: true, value: labels };
}

/**
 * A number separator, as typed: never trimmed, since the spaces around " / "
 * are part of it (a form must read it without trimming). It has at least one
 * character, at most `NUMBER_SEPARATOR_MAX_LENGTH`, all on one line.
 */
function parseNumberSeparator(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("The number separator must be text.");
    }
    if (value === "") {
        return refuse('Enter what goes between a song\'s numbers, such as " / ".');
    }
    if (hasControlCharacter(value)) {
        return refuse("The number separator must be on one line.");
    }
    if (value.length > NUMBER_SEPARATOR_MAX_LENGTH) {
        return refuse(`The number separator is at most ${NUMBER_SEPARATOR_MAX_LENGTH} characters.`);
    }
    return { ok: true, value };
}

function parseCategoryName(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("The category name must be text.");
    }
    const text = value.trim();
    if (text === "") {
        return refuse("Enter the name of the item note category, such as Hymnal.");
    }
    if (hasControlCharacter(text)) {
        return refuse("The category name must be on one line.");
    }
    if (text.length > CATEGORY_NAME_MAX_LENGTH) {
        return refuse(`The category name is at most ${CATEGORY_NAME_MAX_LENGTH} characters.`);
    }
    return { ok: true, value: text };
}

function parseIncludesTune(value: unknown): SettingParse<boolean> {
    return typeof value === "boolean"
        ? { ok: true, value }
        : refuse("Whether the note names the tune must be yes or no.");
}

/**
 * The characters that separate the parts of the credits convention
 * (`Words & Music: A, B; Arr.: C`), which a role may therefore not hold.
 */
const CREDIT_SEPARATORS = /[:;,&]/;

/** One credit role: trimmed, on one line, at most `CREDIT_ROLE_MAX_LENGTH` characters, with no separator. */
function parseCreditRole(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("A role must be text.");
    }
    const text = value.trim();
    if (text === "") {
        return refuse("A role cannot be blank.");
    }
    if (hasControlCharacter(text)) {
        return refuse("A role must be on one line.");
    }
    if (text.length > CREDIT_ROLE_MAX_LENGTH) {
        return refuse(`A role is at most ${CREDIT_ROLE_MAX_LENGTH} characters.`);
    }
    if (CREDIT_SEPARATORS.test(text)) {
        return refuse(
            `The role ${quoted(text)} has a colon, semicolon, comma or "&" in it, which separate the credits in Planning Center.`
        );
    }
    return { ok: true, value: text };
}

/**
 * The credit roles, in order: at least two (the words' and the music's
 * first) and at most `CREDIT_ROLES_MAX`, each a role `parseCreditRole`
 * takes, none listed twice (without regard to case).
 */
function parseCreditRoles(value: unknown): SettingParse<readonly string[]> {
    if (!Array.isArray(value)) {
        return refuse("The roles must be a list.");
    }
    if (value.length < 2) {
        return refuse("List at least two roles: the words' and the music's, in that order.");
    }
    if (value.length > CREDIT_ROLES_MAX) {
        return refuse(`List at most ${CREDIT_ROLES_MAX} roles.`);
    }
    const roles: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const parsed = parseCreditRole(item);
        if (!parsed.ok) {
            return parsed;
        }
        const key = parsed.value.toLowerCase();
        if (seen.has(key)) {
            return refuse(`The role ${quoted(parsed.value)} is listed twice.`);
        }
        seen.add(key);
        roles.push(parsed.value);
    }
    return { ok: true, value: roles };
}

/**
 * A credit phrase's key: one role, or two joined with "&", each as
 * `parseCreditRole` takes it. Two roles are written "Words & Music".
 */
function parseCreditPhraseKey(key: string): SettingParse<string> {
    const parts = key.split("&");
    if (parts.length > 2) {
        return refuse(`${quoted(key.trim())} names more than two roles; a phrase is for one role, or two joined with "&".`);
    }
    const roles: string[] = [];
    for (const part of parts) {
        const parsed = parseCreditRole(part);
        if (!parsed.ok) {
            return parsed;
        }
        roles.push(parsed.value);
    }
    return { ok: true, value: roles.join(" & ") };
}

/** A credit phrase: trimmed, not blank, on one line, at most `CREDIT_PHRASE_MAX_LENGTH` characters. */
function parseCreditPhrase(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("A phrase must be text.");
    }
    const text = value.trim();
    if (text === "") {
        return refuse('A phrase cannot be blank: it is what goes before the names, such as "Words by".');
    }
    if (hasControlCharacter(text)) {
        return refuse("A phrase must be on one line.");
    }
    if (text.length > CREDIT_PHRASE_MAX_LENGTH) {
        return refuse(`A phrase is at most ${CREDIT_PHRASE_MAX_LENGTH} characters.`);
    }
    return { ok: true, value: text };
}

/**
 * The credit phrases: an object of at most `CREDIT_PHRASES_MAX` phrases,
 * each under a key `parseCreditPhraseKey` takes ("Words&Music" is stored as
 * "Words & Music"), no key given twice (without regard to case).
 */
function parseCreditPhrases(value: unknown): SettingParse<CreditPhrases> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return refuse("The phrases must be a phrase for each role.");
    }
    const entries = Object.entries(value);
    if (entries.length > CREDIT_PHRASES_MAX) {
        return refuse(`Give at most ${CREDIT_PHRASES_MAX} phrases.`);
    }
    const phrases: [string, string][] = [];
    const seen = new Set<string>();
    for (const [rawKey, rawPhrase] of entries) {
        const key = parseCreditPhraseKey(rawKey);
        if (!key.ok) {
            return key;
        }
        if (seen.has(key.value.toLowerCase())) {
            return refuse(`There are two phrases for ${quoted(key.value)}.`);
        }
        seen.add(key.value.toLowerCase());
        const phrase = parseCreditPhrase(rawPhrase);
        if (!phrase.ok) {
            return phrase;
        }
        phrases.push([key.value, phrase.value]);
    }
    // Object.fromEntries defines own properties, so even a "__proto__" key stays a key.
    return { ok: true, value: Object.fromEntries(phrases) };
}

/**
 * A plain email address, local@domain.tld: no whitespace, and none of the
 * characters that would let one entry name more than one address or add to
 * a header (quotes, commas, semicolons, angle brackets, parentheses,
 * square brackets, backslashes).
 */
const EMAIL_ADDRESS = /^[^\s@",;<>()[\]\\]+@[^\s@",;<>()[\]\\.]+(?:\.[^\s@",;<>()[\]\\.]+)+$/;

/** One recipient: an address `EMAIL_ADDRESS` matches, trimmed, at most `EMAIL_ADDRESS_MAX_LENGTH` characters. */
function parseEmailAddress(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("An email address must be text.");
    }
    const text = value.trim();
    if (text === "") {
        return refuse("An email address cannot be blank.");
    }
    if (
        text.length > EMAIL_ADDRESS_MAX_LENGTH ||
        hasControlCharacter(text) ||
        !EMAIL_ADDRESS.test(text)
    ) {
        return refuse(`${quoted(text)} is not an email address, such as name@example.org.`);
    }
    return { ok: true, value: text };
}

/**
 * The recipients: a list of at most `EMAIL_RECIPIENTS_MAX` addresses, each
 * one `parseEmailAddress` takes, none listed twice (without regard to case).
 * An empty list is fine: no email is sent until there are recipients.
 */
function parseEmailRecipients(value: unknown): SettingParse<readonly string[]> {
    if (!Array.isArray(value)) {
        return refuse("The recipients must be a list of email addresses.");
    }
    if (value.length > EMAIL_RECIPIENTS_MAX) {
        return refuse(`List at most ${EMAIL_RECIPIENTS_MAX} recipients.`);
    }
    const recipients: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const parsed = parseEmailAddress(item);
        if (!parsed.ok) {
            return parsed;
        }
        const key = parsed.value.toLowerCase();
        if (seen.has(key)) {
            return refuse(`${quoted(parsed.value)} is listed twice.`);
        }
        seen.add(key);
        recipients.push(parsed.value);
    }
    return { ok: true, value: recipients };
}

/**
 * A plan email's subject: trimmed, not blank, on one line, at most
 * `EMAIL_SUBJECT_MAX_LENGTH` characters, and every `{name}` in it one of
 * `EMAIL_SUBJECT_PLACEHOLDERS`.
 */
function parseEmailSubjectTemplate(value: unknown): SettingParse<string> {
    if (typeof value !== "string") {
        return refuse("The subject must be text.");
    }
    const text = value.trim();
    if (text === "") {
        return refuse("Enter the subject, such as Songs for {date} · {service}.");
    }
    if (hasControlCharacter(text)) {
        return refuse("The subject must be on one line.");
    }
    if (text.length > EMAIL_SUBJECT_MAX_LENGTH) {
        return refuse(`The subject is at most ${EMAIL_SUBJECT_MAX_LENGTH} characters.`);
    }
    const known: readonly string[] = EMAIL_SUBJECT_PLACEHOLDERS;
    for (const [placeholder, name] of text.matchAll(/\{([^{}]*)\}/g)) {
        if (!known.includes(name)) {
            return refuse(
                `${quoted(placeholder)} is not a placeholder the subject can hold: use {date} or {service}.`
            );
        }
    }
    return { ok: true, value: text };
}

/** Every setting's default and parser, by key. */
export const SETTINGS: { readonly [K in SettingKey]: SettingDefinition<AppSettings[K]> } = {
    ccliLicenseNumber: {
        defaultValue: DEFAULT_SETTINGS.ccliLicenseNumber,
        parse: parseCcliLicenseNumber,
    },
    scheduleHeaderLabels: {
        defaultValue: DEFAULT_SETTINGS.scheduleHeaderLabels,
        parse: parseScheduleHeaderLabels,
    },
    numberSeparator: {
        defaultValue: DEFAULT_SETTINGS.numberSeparator,
        parse: parseNumberSeparator,
    },
    hymnNoteCategoryName: {
        defaultValue: DEFAULT_SETTINGS.hymnNoteCategoryName,
        parse: parseCategoryName,
    },
    hymnNoteIncludesTune: {
        defaultValue: DEFAULT_SETTINGS.hymnNoteIncludesTune,
        parse: parseIncludesTune,
    },
    creditRoles: {
        defaultValue: DEFAULT_SETTINGS.creditRoles,
        parse: parseCreditRoles,
    },
    creditPhrases: {
        defaultValue: DEFAULT_SETTINGS.creditPhrases,
        parse: parseCreditPhrases,
    },
    emailRecipients: {
        defaultValue: DEFAULT_SETTINGS.emailRecipients,
        parse: parseEmailRecipients,
    },
    emailSubjectTemplate: {
        defaultValue: DEFAULT_SETTINGS.emailSubjectTemplate,
        parse: parseEmailSubjectTemplate,
    },
};

/** Every key, in the registry's order. */
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(value: unknown): value is SettingKey {
    return typeof value === "string" && Object.hasOwn(SETTINGS, value);
}

/** Parse a value for setting `key` (see `SETTINGS`). */
export function parseSetting<K extends SettingKey>(
    key: K,
    value: unknown
): SettingParse<AppSettings[K]> {
    const definition = SETTINGS[key] as SettingDefinition<AppSettings[K]>;
    return definition.parse(value);
}

/** A setting as stored: its key and its value as JSON text. */
export interface StoredSetting {
    key: string;
    value: string;
}

/** A stored setting whose value no longer parses, so its default is used. */
export interface SettingIssue {
    key: SettingKey;
    /** The value as stored (JSON text). */
    stored: string;
    /** Why it does not parse. */
    message: string;
}

/** What the stored settings come to. */
export interface ResolvedSettings {
    /** Every setting: its stored value where it parses, else its default. */
    settings: AppSettings;
    /** The stored values that do not parse, in the order given. */
    issues: SettingIssue[];
}

function assign<K extends SettingKey>(settings: AppSettings, key: K, value: AppSettings[K]): void {
    settings[key] = value;
}

/**
 * Every setting from what is stored: a stored value that parses, or else
 * the default. A stored value that does not parse (not JSON, or not valid
 * for its key) is an issue; a key this build does not know (a newer
 * build's) is left alone.
 */
export function resolveSettings(stored: readonly StoredSetting[]): ResolvedSettings {
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    const issues: SettingIssue[] = [];
    for (const { key, value } of stored) {
        if (!isSettingKey(key)) {
            continue;
        }
        let json: unknown;
        try {
            json = JSON.parse(value);
        } catch {
            issues.push({ key, stored: value, message: "It is not JSON." });
            continue;
        }
        const parsed = parseSetting(key, json);
        if (parsed.ok) {
            assign(settings, key, parsed.value);
        } else {
            issues.push({ key, stored: value, message: parsed.message });
        }
    }
    return { settings, issues };
}

/**
 * The labels the schedule text always gave the church's two service types,
 * by name, kept for a type that has no label of its own.
 */
const LABELS_BY_NAME: Readonly<Record<string, string>> = {
    "Sunday Morning": "Sunday AM",
    "Sunday Evening": "Sunday PM",
};

/**
 * The header label a service type gets without one of its own, as before
 * settings existed: "Sunday AM" for a type named exactly "Sunday Morning",
 * "Sunday PM" for "Sunday Evening", and null (no header) for any other.
 */
export function defaultScheduleHeaderLabel(serviceTypeName: string): string | null {
    return Object.hasOwn(LABELS_BY_NAME, serviceTypeName) ? LABELS_BY_NAME[serviceTypeName] : null;
}

/**
 * The schedule text's header label for a service type: its own from
 * `labels` (null when that is "", for no header), or else the default for
 * its name (`defaultScheduleHeaderLabel`).
 */
export function scheduleHeaderLabel(
    labels: ScheduleHeaderLabels,
    serviceType: Pick<ServiceType, "id" | "name">
): string | null {
    if (Object.hasOwn(labels, serviceType.id)) {
        const label = labels[serviceType.id];
        return label === "" ? null : label;
    }
    return defaultScheduleHeaderLabel(serviceType.name);
}

/**
 * What the copyright text reads of the settings: the CCLI license number,
 * and the credit roles and phrases, which are the defaults when left out.
 */
export type CopyrightSettings = Pick<AppSettings, "ccliLicenseNumber"> & Partial<CreditSettings>;

/** What the hymnal notes read of the settings. */
export type HymnNoteSettings = Pick<AppSettings, "numberSeparator" | "hymnNoteIncludesTune">;

/** What reading and writing songs' credits follows of the settings. */
export type CreditSettings = Pick<AppSettings, "creditRoles" | "creditPhrases">;

/** What a plan's email follows of the settings. */
export type EmailSettings = Pick<AppSettings, "emailRecipients" | "emailSubjectTemplate">;

/** The settings a plan's pages follow, resolved for the plan's service type. */
export interface PlanTextSettings {
    /** The schedule text's header label, or null for no header. */
    headerLabel: string | null;
    /** What goes between a song's numbers. */
    numberSeparator: string;
    /** The CCLI license number for the copyright blocks. */
    ccliLicenseNumber: string;
}

/** The settings a plan of `serviceType` follows (see `PlanTextSettings`). */
export function planTextSettings(
    settings: AppSettings,
    serviceType: Pick<ServiceType, "id" | "name">
): PlanTextSettings {
    return {
        headerLabel: scheduleHeaderLabel(settings.scheduleHeaderLabels, serviceType),
        numberSeparator: settings.numberSeparator,
        ccliLicenseNumber: settings.ccliLicenseNumber,
    };
}
