"use client";

import { useCallback, useMemo } from "react";
import { linkPcoSong } from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
import { planDateFromSortDate } from "@/lib/format";
import { warningsToShow } from "@/lib/repeatWarnings";
import { routes } from "@/lib/routes";
import type { LinkSong } from "./LinkToCatalogInline";
import { usePlan } from "./PlanProvider";
import ServiceSchedule from "./ServiceSchedule";

/**
 * The Service Schedule tab's connector: feeds ServiceSchedule the items with
 * their selections, how their saves stand, their catalog links and
 * suggestions, their hymnal notes, the plan's date and the settings its
 * text follows from `usePlan()`, and sends its changes back to the
 * provider, which keeps them while the user visits other tabs and items,
 * and saves them. A Link goes to the `linkPcoSong` action with this plan's
 * ids, and its revalidation brings the new numbers back through the
 * provider. The repeat warnings (songs sung lately) come with the plan, and
 * go to the cards only for a plan dated today or later (`warningsToShow`).
 */
export default function ScheduleTab() {
    const {
        plan,
        serviceType,
        catalog,
        suggestions,
        catalogError,
        selectionsError,
        scheduleSettings,
        settingsError,
        hymnNoteStatus,
        repeatWarnings,
        scheduleItems,
        saves,
        chooseOption,
        setCustomText,
        retrySave,
    } = usePlan();
    const planDate = planDateFromSortDate(plan.sortDate);
    const warnings = useMemo(
        () => warningsToShow(repeatWarnings, planDate),
        [repeatWarnings, planDate]
    );

    const onLink = useCallback<LinkSong>(
        (pcoSongId, songId) =>
            linkPcoSong(serviceType.id, plan.id, pcoSongId, String(songId)),
        [serviceType.id, plan.id]
    );

    return (
        <ServiceSchedule
            items={scheduleItems}
            catalog={catalog}
            suggestions={suggestions}
            catalogError={catalogError}
            selectionsError={selectionsError}
            settingsError={settingsError}
            hymnNoteStatus={hymnNoteStatus}
            saves={saves}
            repeatWarnings={warnings}
            serviceTypeName={serviceType.name}
            planDate={planDate}
            headerLabel={scheduleSettings.headerLabel}
            numberSeparator={scheduleSettings.numberSeparator}
            scheduleHref={routes.planSchedule(serviceType.id, plan.id)}
            onChooseOption={chooseOption}
            onCustomTextChange={setCustomText}
            onRetrySave={retrySave}
            onLink={onLink}
        />
    );
}
