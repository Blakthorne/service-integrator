import { formatCopyrightText } from "./copyright";
import { renderCreditLine } from "./credits";
import type { ServiceType } from "./domain";
import { formatHymnNote } from "./hymnNotes";
import { formatPlanEmailSubject } from "./planEmail";
import { recipientCount } from "./planEmailText";
import { formatScheduleNumbers, type ScheduleEntry } from "./serviceSchedule";
import {
    DEFAULT_SETTINGS,
    defaultScheduleHeaderLabel,
    parseCreditPhrase,
    parseCreditRole,
    parseEmailAddress,
    parseSetting,
    type HymnNoteSettings,
    type ScheduleHeaderLabels,
    type SettingIssue,
    type SettingKey,
} from "./settings";
import { splitRecipients } from "./settingsForms";

/**
 * The Settings page's words: the previews of what a setting makes, the
 * header labels' defaults, how a service type's item note category stands,
 * and what a stored setting that no longer parses is. Pure and safe on both
 * sides: the forms preview as the person types, and the cards are built from
 * what these return.
 */

/** The headings of the Settings page's cards that edit a setting, which the issues name. */
export const SETTINGS_CARD_TITLES = {
    copyright: "Copyright",
    scheduleText: "Schedule text",
    hymnalNotes: "Hymnal notes",
    credits: "Credits",
    email: "Email",
} as const;

/** What each setting is called on the page, and the card that edits it. */
export const SETTING_DESCRIPTIONS: Readonly<
    Record<SettingKey, { label: string; card: string }>
> = {
    ccliLicenseNumber: { label: "CCLI license number", card: SETTINGS_CARD_TITLES.copyright },
    scheduleHeaderLabels: {
        label: "Schedule header labels",
        card: SETTINGS_CARD_TITLES.scheduleText,
    },
    numberSeparator: { label: "Number separator", card: SETTINGS_CARD_TITLES.scheduleText },
    hymnNoteCategoryName: {
        label: "Hymnal note category",
        card: SETTINGS_CARD_TITLES.hymnalNotes,
    },
    hymnNoteIncludesTune: {
        label: "Tune in hymnal notes",
        card: SETTINGS_CARD_TITLES.hymnalNotes,
    },
    creditRoles: { label: "Credit roles", card: SETTINGS_CARD_TITLES.credits },
    creditPhrases: { label: "Credit phrases", card: SETTINGS_CARD_TITLES.credits },
    emailRecipients: { label: "Email recipients", card: SETTINGS_CARD_TITLES.email },
    emailSubjectTemplate: { label: "Email subject", card: SETTINGS_CARD_TITLES.email },
};

/** The longest stored value an issue shows. */
const STORED_TEXT_MAX_LENGTH = 120;

/** A setting's default, in words. */
function defaultInWords(key: SettingKey): string {
    switch (key) {
        case "scheduleHeaderLabels":
            return "no labels of its own, so each service type gets its default header";
        case "hymnNoteIncludesTune":
            return DEFAULT_SETTINGS.hymnNoteIncludesTune ? "yes" : "no";
        case "creditRoles":
            return DEFAULT_SETTINGS.creditRoles.join(", ");
        case "creditPhrases":
            return Object.entries(DEFAULT_SETTINGS.creditPhrases)
                .map(([role, phrase]) => `${role}: "${phrase}"`)
                .join(", ");
        case "emailRecipients":
            return "no recipients";
        default:
            return JSON.stringify(DEFAULT_SETTINGS[key]);
    }
}

/** A stored setting that no longer parses, as the Settings page tells it. */
export interface SettingIssueText {
    /** What the setting is called: "CCLI license number". */
    label: string;
    /** The heading of the card that edits it: "Copyright". */
    card: string;
    /** What is stored, as JSON text, cut short. */
    stored: string;
    /** Why it does not parse. */
    message: string;
    /** What is used until it is saved again. */
    usingDefault: string;
}

export function describeSettingIssue(issue: SettingIssue): SettingIssueText {
    const { label, card } = SETTING_DESCRIPTIONS[issue.key];
    return {
        label,
        card,
        stored:
            issue.stored.length > STORED_TEXT_MAX_LENGTH
                ? `${issue.stored.slice(0, STORED_TEXT_MAX_LENGTH)}…`
                : issue.stored,
        message: issue.message,
        usingDefault: `The default is in use: ${defaultInWords(issue.key)}.`,
    };
}

/** The two numbers a preview uses, as a song in both books has them. */
const SAMPLE_ENTRIES: readonly ScheduleEntry[] = [
    { label: "R-396", variantNote: null },
    { label: "G-317", variantNote: null },
];

/** The tune a preview names. */
const SAMPLE_TUNE = "ST. ANNE";

/**
 * A song's numbers as the schedule text and the hymnal notes write them,
 * with `separator` between: "R-396 / G-317". Null when `separator` is not
 * one the setting accepts (empty, too long), so there is nothing to show.
 */
export function previewNumbers(separator: string): string | null {
    const parsed = parseSetting("numberSeparator", separator);
    return parsed.ok ? formatScheduleNumbers(SAMPLE_ENTRIES, parsed.value) : null;
}

/** A hymnal note as `settings` would write it: "R-396 / G-317", or "R-396 / G-317 · ST. ANNE" with the tune. */
export function previewHymnNote(settings: HymnNoteSettings): string {
    return formatHymnNote({ tuneName: SAMPLE_TUNE, entries: SAMPLE_ENTRIES }, settings) ?? "";
}

/**
 * The last line of a copyright block with this CCLI license number, as the
 * copyright text writes it ("Used by permission. CCLI Streaming License
 * 1564484."): the line itself, from the copyright text's own function, so
 * the preview cannot drift from it. Null when `ccliLicenseNumber` is not one
 * the setting accepts.
 */
export function previewCopyrightFooter(ccliLicenseNumber: string): string | null {
    const parsed = parseSetting("ccliLicenseNumber", ccliLicenseNumber);
    if (!parsed.ok) {
        return null;
    }
    const text = formatCopyrightText(
        { title: "Amazing Grace", author: null, copyright: null },
        { ccliLicenseNumber: parsed.value }
    );
    return text.split("\n").at(-1) ?? null;
}

/** A service type in the Schedule text card: the header label it has of its own, and the one it gets without. */
export interface HeaderLabelRow {
    serviceTypeId: string;
    serviceTypeName: string;
    /** Its own label as saved; "" when it has none. */
    label: string;
    /**
     * What it gets with none (`defaultScheduleHeaderLabel`): "Sunday AM" for
     * a type named exactly "Sunday Morning", and null, no header, for most.
     */
    defaultLabel: string | null;
}

/** A row for each of `serviceTypes`, in the order given, with its saved label. */
export function headerLabelRows(
    serviceTypes: readonly Pick<ServiceType, "id" | "name">[],
    labels: ScheduleHeaderLabels
): HeaderLabelRow[] {
    return serviceTypes.map(({ id, name }) => ({
        serviceTypeId: id,
        serviceTypeName: name,
        label: Object.hasOwn(labels, id) ? labels[id] : "",
        defaultLabel: defaultScheduleHeaderLabel(name),
    }));
}

/** What a blank label does, under its field: `Left blank, the header is "Sunday AM".` */
export function headerLabelHint(defaultLabel: string | null): string {
    return defaultLabel === null
        ? "Left blank, the text has no header."
        : `Left blank, the header is "${defaultLabel}".`;
}

/**
 * How long the Settings page waits for Planning Center before it says so and
 * goes on without it. A page response that is still open holds up leaving
 * the page (the router's navigation waits for it), so a Planning Center
 * that hangs must not hold the page open for the 15 s of each of its
 * timeouts.
 */
export const PCO_WAIT_MS = 5000;

/** Why the Settings page stopped waiting for Planning Center: it is shown as the reason, beside what could not be read. */
export function pcoTimedOutReason(ms: number): string {
    return `Planning Center did not answer within ${Math.round(ms / 1000)} seconds.`;
}

/**
 * What the Schedule text card says when Planning Center could not give it
 * the service types. "Could not read", not "could not be reached": Planning
 * Center may have answered with an error.
 */
export const SERVICE_TYPES_UNAVAILABLE_TEXT =
    "Could not read the service types from Planning Center, so they are not listed and their header labels cannot be edited now. The labels already saved are kept when you save.";

/** What the Schedule text card says when Planning Center has no service types. */
export const NO_SERVICE_TYPES_TEXT = "Planning Center has no service types.";

/** What the Hymnal notes card says when Planning Center could not give it the service types or their categories. */
export const CATEGORIES_UNAVAILABLE_TEXT =
    "Could not read the item note categories from Planning Center, so it is not known whether each service type has one. Reload the page to try again.";

/** How a service type's item note category stands: what `describeCategoryLookup` reads. */
export type CategoryLookupText =
    | { status: "found"; category: { name: string } }
    | { status: "missing"; message: string }
    | { status: "ambiguous"; message: string }
    | { status: "unavailable"; error: string };

/** Shown as a state: fine, to be fixed, or not known. */
export type CategoryTone = "ok" | "warning" | "error";

/** How a service type's category is shown: a short status, and the sentence under it. */
export interface CategoryStateText {
    tone: CategoryTone;
    /** A word or two that does not rely on colour: `Found as "Hymnal"`, "Missing". */
    status: string;
    /** What to know or do, or null when the status says it all. */
    detail: string | null;
}

/** `text` as a sentence: a full stop is added unless it ends with one, or a ! or ?. */
function withFullStop(text: string): string {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * A service type's item note category for the hymnal notes, in words: found
 * (as Planning Center spells its name), missing (`lookup.message`, which
 * names the service type and the category), more than one of the name
 * (`lookup.message`, which names them; the sync refuses until all but one
 * are renamed), or not known because Planning Center would not say.
 */
export function describeCategoryLookup(lookup: CategoryLookupText): CategoryStateText {
    switch (lookup.status) {
        case "found":
            return { tone: "ok", status: `Found as "${lookup.category.name}"`, detail: null };
        case "missing":
            return { tone: "warning", status: "Missing", detail: lookup.message };
        case "ambiguous":
            return { tone: "warning", status: "More than one", detail: lookup.message };
        case "unavailable":
            return {
                tone: "error",
                status: "Could not be checked",
                detail: `Its item note categories could not be read: ${withFullStop(lookup.error)}`,
            };
    }
}

/** The sentence over the list of service types: which category is being looked for. */
export function categoryLookupIntro(categoryName: string): string {
    return `Looking for an item note category named "${categoryName}" in each service type.`;
}

/**
 * How to make the category the hymnal notes go in, for a service type that
 * lacks it: the API cannot create one, so it is done in Planning Center's
 * web app, once for each service type. Says only what is known of where.
 */
export function missingCategoryHelp(categoryName: string): string {
    return `Planning Center does not let this app create an item note category, so create it in Planning Center's web app (Services › Plans › item notes): add one named "${categoryName}" to each service type marked Missing, then reload this page.`;
}

/** What each credit role's fieldset is called: the first two are the words' and the music's. */
export function creditRoleLegend(index: number): string {
    return index === 0 ? "Role 1 (the words)" : index === 1 ? "Role 2 (the music)" : `Role ${index + 1}`;
}

/** What a blank phrase does, under its field: `Left blank, it reads "Words by".` */
export function creditPhraseHint(role: string): string {
    const name = role.trim();
    return `Left blank, it reads "${name === "" ? "the role" : name} by".`;
}

/**
 * What a blank phrase for the first two roles together does, under its
 * field: `Left blank, it reads "Words and Music by".`
 */
export function creditPairPhraseHint(firstRole: string, secondRole: string): string {
    const first = firstRole.trim() === "" ? "the first role" : firstRole.trim();
    const second = secondRole.trim() === "" ? "the second role" : secondRole.trim();
    return `Left blank, it reads "${first} and ${second} by".`;
}

/** The names a credit preview gives each role in turn: no two next to each other are the same. */
const SAMPLE_CREDIT_NAMES = ["Isaac Watts", "Lowell Mason", "John Doe", "Jane Roe", "Sam Poe"];

/** The one person a preview has hold both the words and the music. */
const SAMPLE_SAME_PERSON = "John Newton";

/** A credit line as the copyright text prints it, for two sample songs. */
export interface CreditPreview {
    /** A song with a different person for each role: "Words by Isaac Watts. Music by Lowell Mason." */
    apart: string;
    /** A song whose words and music are by the same person: "Words and Music by John Newton." */
    together: string;
}

/**
 * The credit line the copyright text prints with these rows (the role and
 * the phrase typed for each, in order) and the phrase for the first two
 * roles together, as the form holds them: the text itself, from the credits'
 * own function (`renderCreditLine`), so the preview cannot drift from it. A
 * role that is not one the setting takes, or is listed twice, is left out,
 * and so is a phrase that is blank or not one the setting takes (the text
 * prints "<role> by" for it). Null when fewer than two roles are left.
 */
export function previewCreditLines(
    rows: readonly { role: string; phrase: string }[],
    pairPhrase: string
): CreditPreview | null {
    const roles: string[] = [];
    const phrases: Record<string, string> = {};
    const seen = new Set<string>();
    for (const row of rows) {
        const role = parseCreditRole(row.role);
        if (!role.ok || seen.has(role.value.toLowerCase())) {
            continue;
        }
        seen.add(role.value.toLowerCase());
        roles.push(role.value);
        const phrase = parseCreditPhrase(row.phrase);
        if (phrase.ok) {
            phrases[role.value] = phrase.value;
        }
    }
    if (roles.length < 2) {
        return null;
    }
    const pair = parseCreditPhrase(pairPhrase);
    if (pair.ok) {
        phrases[`${roles[0]} & ${roles[1]}`] = pair.value;
    }
    return {
        apart: renderCreditLine(
            roles.map((role, i) => ({
                role,
                names: [SAMPLE_CREDIT_NAMES[i % SAMPLE_CREDIT_NAMES.length]],
            })),
            phrases
        ),
        together: renderCreditLine(
            [
                { role: roles[0], names: [SAMPLE_SAME_PERSON] },
                { role: roles[1], names: [SAMPLE_SAME_PERSON] },
            ],
            phrases
        ),
    };
}

/** How many songs' authors read as each status, as `rederiveAllCredits` counts them. */
export interface RederivedCreditCounts {
    songs: number;
    ok: number;
    legacy: number;
    unparsed: number;
}

/** What the Credits form says when the roles are saved but the songs' credits could not be read again. */
export const CREDITS_NOT_REREAD_MESSAGE =
    "The roles were saved, but the songs' credits could not be read again. They follow the new roles at the next song sync, within the hour.";

/** "1 song", "397 songs". */
function songCount(count: number): string {
    return `${count} ${count === 1 ? "song" : "songs"}`;
}

/** "a", "a and b", "a, b and c". */
function listedParts(parts: readonly string[]): string {
    return parts.length <= 1
        ? parts.join("")
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What the Credits form says once it is saved: how many songs' credits were
 * read again with the new roles, and how they read: following the roles,
 * with no labels at all (read as the copyright text always read them), or
 * with labels that no role matches (a role renamed or removed: they keep
 * their copyright text and are flagged on the song's page).
 */
export function describeRederivedCredits(counts: RederivedCreditCounts): string {
    if (counts.songs === 0) {
        return "Saved. No songs have been synced from Planning Center yet, so there were no credits to read again.";
    }
    const parts: string[] = [];
    if (counts.ok > 0) {
        parts.push(`${counts.ok} follow${counts.ok === 1 ? "s" : ""} the roles`);
    }
    if (counts.legacy > 0) {
        parts.push(`${counts.legacy} ${counts.legacy === 1 ? "has" : "have"} no labels`);
    }
    if (counts.unparsed > 0) {
        parts.push(
            `${counts.unparsed} ${counts.unparsed === 1 ? "has" : "have"} labels that no role matches`
        );
    }
    return `Saved. Read the credits of ${songCount(counts.songs)} again: ${listedParts(parts)}.`;
}

/** What the subject field explains: its two placeholders. */
export const EMAIL_SUBJECT_HINT =
    "{date} becomes the plan's date, such as 10/4/26, and {service} its service type's name, such as Sunday Morning.";

/** What the recipients field explains: how to list them. */
export const EMAIL_RECIPIENTS_HINT =
    "One email address on each line, or separated by commas. Email this plan sends to all of them.";

/** The plan a subject preview is for. */
const SAMPLE_PLAN = { dates: "October 4, 2026", sortDate: "2026-10-04T11:00:00Z" } as const;
const SAMPLE_SERVICE_TYPE = { name: "Sunday Morning" } as const;

/** What a subject preview is about, in words: "a Sunday Morning plan for October 4, 2026". */
export const EMAIL_SUBJECT_SAMPLE_PLAN = `a ${SAMPLE_SERVICE_TYPE.name} plan for ${SAMPLE_PLAN.dates}`;

/**
 * The subject of a plan's email with this template, for a sample plan (see
 * `EMAIL_SUBJECT_SAMPLE_PLAN`): "Songs for 10/4/26 · Sunday Morning", from
 * the email's own function (`formatPlanEmailSubject`). Null when
 * `template` is not one the setting accepts (blank, too long, an unknown
 * placeholder), so there is nothing to show.
 */
export function previewEmailSubject(template: string): string | null {
    const parsed = parseSetting("emailSubjectTemplate", template);
    return parsed.ok ? formatPlanEmailSubject(parsed.value, SAMPLE_PLAN, SAMPLE_SERVICE_TYPE) : null;
}

/** What the recipients field says under it while nothing is typed. */
export const NO_RECIPIENTS_PREVIEW =
    "No recipients yet: Email this plan sends nothing until there is at least one.";

/** The most entries a preview names. */
const NAMED_ENTRIES_MAX = 3;

/**
 * What the recipients typed come to, as they are typed: how many people the
 * email goes to, or which entries are not email addresses, or what is wrong
 * with the list (an address twice, too many). Said quietly under the field:
 * the save marks the field.
 */
export function previewRecipients(text: string): string {
    const entries = splitRecipients(text);
    if (entries.length === 0) {
        return NO_RECIPIENTS_PREVIEW;
    }
    const refused = entries.filter((entry) => !parseEmailAddress(entry).ok);
    if (refused.length > 0) {
        const named = refused
            .slice(0, NAMED_ENTRIES_MAX)
            .map((entry) => JSON.stringify(entry.length > 40 ? `${entry.slice(0, 40)}…` : entry));
        const more =
            refused.length > NAMED_ENTRIES_MAX ? ` and ${refused.length - NAMED_ENTRIES_MAX} more` : "";
        return `Not an email address: ${named.join(", ")}${more}.`;
    }
    const parsed = parseSetting("emailRecipients", entries);
    return parsed.ok ? `The email goes to ${recipientCount(entries.length)}.` : parsed.message;
}
