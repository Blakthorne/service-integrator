import Link from "next/link";
import type { PlanSummary } from "@/lib/domain";
import { formatPlanDateHeading } from "@/lib/format";
import { routes } from "@/lib/routes";

interface PlanDateCardProps {
    /** The date, `YYYY-MM-DD`. */
    date: string;
    /** The plans on that date, in service-type order. */
    plans: PlanSummary[];
}

/**
 * One date of the plans list: its heading, and a row for each plan on it. A
 * row's service type is a real link stretched over the row, so it works from
 * the keyboard and with cmd-click. The heading is an `<h3>`: the list's
 * sections (Upcoming, Past plans) own the `<h2>`s.
 */
export default function PlanDateCard({ date, plans }: PlanDateCardProps) {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {formatPlanDateHeading(date)}
                </h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-2/3">
                                Service Type
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/3">
                                Items
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {plans.map((plan) => (
                            // `relative` makes the row the box the link's
                            // overlay fills; `transform-gpu` does the same in
                            // Safari, which ignored `relative` on table rows
                            // until 2026 (WebKit bug 240961).
                            <tr
                                key={plan.id}
                                className="relative transform-gpu hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                            >
                                <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                    {/* No prefetch: a page of rows would each load a plan from PCO. */}
                                    <Link
                                        prefetch={false}
                                        href={routes.plan(plan.serviceType.id, plan.id)}
                                        className="after:absolute after:inset-0"
                                    >
                                        {plan.serviceType.name}
                                    </Link>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                                    {plan.itemsCount} items
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
