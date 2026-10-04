import { buildCopyrightCopyAllText, type CopyrightSong } from "./copyright";
import type { Plan, PlanItem, ServiceType } from "./domain";
import { formatShortDate, planDateFromSortDate } from "./format";
import { planLabel } from "./planLabel";
import { mergeScheduleSelections, type ScheduleSelections } from "./scheduleSelections";
import { buildScheduleCopyText, type ScheduleCatalog } from "./serviceSchedule";
import type { AppSettings, PlanTextSettings } from "./settings";

/**
 * A plan's email to the staff: its subject and its plain-text body, built
 * from what a plan's pages hold (`PlanDetail`) and the subject template.
 * Pure and safe on both sides: lib/queries/email.ts previews and sends it,
 * and a page may build it in the browser from the same data.
 */

/** What a plan's email reads of one of its items. A `PlanItemWithSong` fits. */
export type PlanEmailItem = Pick<PlanItem, "id" | "title" | "itemType" | "sequence" | "songId"> & {
    /** The song joined to it by its Planning Center id, for its copyright block. */
    song: CopyrightSong | null;
};

/** What a plan's email reads of the plan. `PlanDetail` fits. */
export interface PlanEmailDetail {
    plan: Pick<Plan, "dates" | "sortDate">;
    serviceType: Pick<ServiceType, "name">;
    /** Every item of the plan; the song items make the text. */
    items: readonly PlanEmailItem[];
    /** The catalog songs the song items' Planning Center songs are linked to, by that id. */
    catalog: ScheduleCatalog;
    /** The Schedule tab's saved choices, by item id. */
    selections: ScheduleSelections;
    /** The settings the plan's text follows, resolved for its service type. */
    scheduleSettings: PlanTextSettings;
}

/** What a plan's email reads of the settings. */
export type PlanEmailSettings = Pick<AppSettings, "emailSubjectTemplate">;

/** A plan's email. */
export interface PlanEmail {
    subject: string;
    text: string;
}

/**
 * `text` on one line: each control character (a line break, a tab) becomes
 * a space, and each run of spaces one space.
 */
function oneLine(text: string): string {
    let spaced = "";
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        spaced += code < 0x20 || (code >= 0x7f && code < 0xa0) ? " " : character;
    }
    return spaced.split(/\s+/).join(" ").trim();
}

/**
 * A plan email's subject: `template` (the `emailSubjectTemplate` setting)
 * with `{date}` replaced by the plan's short date ("10/4/26", from the date
 * part of its `sortDate`, the same in every time zone; its `dates` text when
 * it has no date) and `{service}` by its service type's name, each on one
 * line. Any other `{…}` is left as typed.
 */
export function formatPlanEmailSubject(
    template: string,
    plan: Pick<Plan, "dates" | "sortDate">,
    serviceType: Pick<ServiceType, "name">
): string {
    const planDate = planDateFromSortDate(plan.sortDate);
    const values: Readonly<Record<string, string>> = {
        date: oneLine(planDate === null ? plan.dates : formatShortDate(planDate)),
        service: oneLine(serviceType.name),
    };
    return template
        .replace(/\{([^{}]*)\}/g, (placeholder, name: string) =>
            Object.hasOwn(values, name) ? values[name] : placeholder
        )
        .trim();
}

/** `text` without the line breaks at its end. */
function withoutTrailingLineBreaks(text: string): string {
    return text.replace(/\n+$/, "");
}

/**
 * A plan's email: the subject from the `emailSubjectTemplate` setting (see
 * `formatPlanEmailSubject`), and a plain-text body of
 *
 * 1. the plan's label ("October 4, 2026 · Sunday Morning"),
 * 2. the Schedule tab's copy text: its header and a line per song item,
 *    each with its saved choice (or its default) and the plan's text
 *    settings, as Copy All copies it,
 * 3. each song's copyright block, as the Copyright tab's Copy All copies
 *    them,
 *
 * with a blank line between them, and a line break at the end. A part with
 * nothing to say is left out: a plan with no songs and no header is its
 * label alone.
 */
export function buildPlanEmail(detail: PlanEmailDetail, settings: PlanEmailSettings): PlanEmail {
    const { plan, serviceType, items, catalog, selections, scheduleSettings } = detail;
    const schedule = buildScheduleCopyText({
        items: mergeScheduleSelections(items, selections, catalog),
        catalog,
        serviceTypeName: serviceType.name,
        planDate: planDateFromSortDate(plan.sortDate),
        headerLabel: scheduleSettings.headerLabel,
        numberSeparator: scheduleSettings.numberSeparator,
    });
    const copyright = buildCopyrightCopyAllText([...items], scheduleSettings);
    const parts = [planLabel(plan, serviceType), withoutTrailingLineBreaks(schedule), copyright];
    return {
        subject: formatPlanEmailSubject(settings.emailSubjectTemplate, plan, serviceType),
        text: `${parts.filter((part) => part !== "").join("\n\n")}\n`,
    };
}
