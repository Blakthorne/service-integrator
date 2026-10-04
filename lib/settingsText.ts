import { formatCopyrightText } from "./copyright";
import type { ServiceType } from "./domain";
import { formatHymnNote } from "./hymnNotes";
import { formatScheduleNumbers, type ScheduleEntry } from "./serviceSchedule";
import {
    DEFAULT_SETTINGS,
    defaultScheduleHeaderLabel,
    parseSetting,
    type HymnNoteSettings,
    type ScheduleHeaderLabels,
    type SettingIssue,
    type SettingKey,
} from "./settings";

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

/** What the Schedule text card says when Planning Center could not give it the service types. */
export const SERVICE_TYPES_UNAVAILABLE_TEXT =
    "Planning Center could not be reached, so the service types are not listed and their header labels cannot be edited now. The labels already saved are kept when you save.";

/** What the Schedule text card says when Planning Center has no service types. */
export const NO_SERVICE_TYPES_TEXT = "Planning Center has no service types.";

/** What the Hymnal notes card says when Planning Center could not be reached at all. */
export const CATEGORIES_UNAVAILABLE_TEXT =
    "Planning Center could not be reached, so its item note categories were not checked. Reload the page to try again.";

/** How a service type's item note category stands: what `describeCategoryLookup` reads. */
export type CategoryLookupText =
    | { status: "found"; category: { name: string } }
    | { status: "missing"; message: string }
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
 * names the service type and the category), or not known because Planning
 * Center would not say.
 */
export function describeCategoryLookup(lookup: CategoryLookupText): CategoryStateText {
    switch (lookup.status) {
        case "found":
            return { tone: "ok", status: `Found as "${lookup.category.name}"`, detail: null };
        case "missing":
            return { tone: "warning", status: "Missing", detail: lookup.message };
        case "unavailable":
            return {
                tone: "error",
                status: "Could not be checked",
                detail: `Its item note categories could not be read: ${withFullStop(lookup.error)}`,
            };
    }
}

/**
 * How to make the category the hymnal notes go in, for a service type that
 * lacks it: the API cannot create one, so it is done in Planning Center's
 * web app, once for each service type. Says only what is known of where.
 */
export function missingCategoryHelp(categoryName: string): string {
    return `Planning Center does not let this app create an item note category, so create it in Planning Center's web app (Services › Plans › item notes): add one named "${categoryName}" to each service type marked Missing, then reload this page.`;
}
