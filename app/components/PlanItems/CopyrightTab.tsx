"use client";

import CopyrightInformation from "./CopyrightInformation";
import { usePlan } from "./PlanProvider";

/**
 * The Copyright Information tab's connector: feeds the plan's items from
 * `usePlan()` to CopyrightInformation.
 */
export default function CopyrightTab() {
    const { items } = usePlan();
    return <CopyrightInformation items={items} />;
}
