"use client";

import { useCallback } from "react";
import { linkPcoSong } from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
import { planDateFromSortDate } from "@/lib/format";
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
 * provider.
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
        scheduleItems,
        saves,
        chooseOption,
        setCustomText,
        retrySave,
    } = usePlan();

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
            serviceTypeName={serviceType.name}
            planDate={planDateFromSortDate(plan.sortDate)}
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
