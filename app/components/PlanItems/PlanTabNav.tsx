"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { PLAN_TABS } from "@/lib/routes";
import { usePlan } from "./PlanProvider";

/**
 * The plan's tabs, one link per entry of `PLAN_TABS`, with
 * `aria-current="page"` on the tab being shown.
 *
 * Render it from the `(overview)` layout: there `useSelectedLayoutSegment()`
 * returns the tab's segment (null for the default tab, "schedule"), while one
 * level up it would return "(overview)".
 */
export default function PlanTabNav() {
    const { plan, serviceType } = usePlan();
    const segment = useSelectedLayoutSegment();

    return (
        <nav aria-label="Plan sections" className="flex space-x-4 mb-6">
            {PLAN_TABS.map((tab) => {
                const isActive = tab.segment === segment;
                return (
                    <Link
                        key={tab.label}
                        href={tab.href(serviceType.id, plan.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                            isActive
                                ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        }`}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
