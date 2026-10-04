"use client";

import { planDateFromSortDate } from "@/lib/format";
import { usePlan } from "./PlanProvider";
import ServiceSchedule from "./ServiceSchedule";

/**
 * The Service Schedule tab's connector: feeds ServiceSchedule the items with
 * their selections, their catalog links and the plan's date from `usePlan()`,
 * and sends its changes back to the provider, which keeps them while the
 * user visits other tabs and items.
 */
export default function ScheduleTab() {
    const {
        plan,
        serviceType,
        catalog,
        scheduleItems,
        chooseOption,
        setCustomText,
    } = usePlan();

    return (
        <ServiceSchedule
            items={scheduleItems}
            catalog={catalog}
            serviceTypeName={serviceType.name}
            planDate={planDateFromSortDate(plan.sortDate)}
            onChooseOption={chooseOption}
            onCustomTextChange={setCustomText}
        />
    );
}
