"use client";

import CopyrightInformation from "./CopyrightInformation";
import { usePlan } from "./PlanProvider";

/**
 * The Copyright Information tab's connector: feeds the plan's items and the
 * settings its text follows (the CCLI license number) from `usePlan()` to
 * CopyrightInformation.
 */
export default function CopyrightTab() {
    const { items, scheduleSettings, settingsError } = usePlan();
    return (
        <CopyrightInformation
            items={items}
            settings={scheduleSettings}
            settingsError={settingsError}
        />
    );
}
