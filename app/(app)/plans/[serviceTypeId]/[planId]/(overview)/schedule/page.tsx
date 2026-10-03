import type { Metadata } from "next";
import ScheduleTab from "@/app/components/PlanItems/ScheduleTab";

/** "Schedule · <plan label> · Service Integrator", through the `[planId]` layout's template. */
export const metadata: Metadata = {
    title: "Schedule",
};

/** The plan's Service Schedule tab. */
export default function PlanSchedulePage() {
    return <ScheduleTab />;
}
