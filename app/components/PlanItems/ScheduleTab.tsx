"use client";

import { planDateFromSortDate } from "@/lib/format";
import { usePlan } from "./PlanProvider";
import ServiceSchedule from "./ServiceSchedule";

/**
 * The Service Schedule tab's connector: feeds ServiceSchedule the items with
 * their selections, the hymn matches and the plan's date from `usePlan()`,
 * and sends its changes back to the provider, which keeps them while the
 * user visits other tabs and items.
 */
export default function ScheduleTab() {
    const {
        plan,
        serviceType,
        hymns,
        scheduleItems,
        chooseOption,
        setCustomText,
    } = usePlan();

    return (
        <ServiceSchedule
            items={scheduleItems}
            hymnData={hymns}
            serviceTypeName={serviceType.name}
            planDate={planDateFromSortDate(plan.sortDate)}
            onChooseOption={chooseOption}
            onCustomTextChange={setCustomText}
        />
    );
}
