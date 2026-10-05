import Link from "next/link";
import {
    NEXT_PLAN_FAILED_TEXT,
    NO_NEXT_PLAN_TEXT,
    planNotesSummary,
    type PlanNotesSummary,
} from "@/lib/dashboard";
import { planLabel } from "@/lib/planLabel";
import type { DashboardServiceType } from "@/lib/queries/dashboard";
import { routes } from "@/lib/routes";
import PlanSongs from "./PlanSongs";
import { CARD_CLASS, HEADING_LINK_CLASS, LINK_CLASS } from "./styles";

/** The colour of each tone of a plan card's line on its hymnal notes. */
const SUMMARY_CLASSES: Readonly<Record<PlanNotesSummary["tone"], string>> = {
    ok: "text-green-700 dark:text-green-300",
    attention: "text-amber-700 dark:text-amber-300",
    warning: "text-amber-700 dark:text-amber-300",
    muted: "text-gray-600 dark:text-gray-300",
};

/** The top of a card, holding its heading. */
function CardHeader({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-4 sm:px-6 py-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
            {children}
        </div>
    );
}

interface NextPlanCardProps {
    /** A service type and its next plan, or why it has none to show. */
    entry: DashboardServiceType;
}

/**
 * A service type's next plan, as a card named by its heading:
 *
 * - with a plan: the plan's label, linking to the plan; its song items in
 *   order, each with its numbers and hymnal note (`PlanSongs`); a line on
 *   the hymnal notes; and a link to the Schedule tab;
 * - without one: the service type's name and "No upcoming plan";
 * - when its next plan could not be read: the name and a quiet warning,
 *   as the plans list gives.
 *
 * Its links to the plan's pages do not prefetch (convention 13): a plan
 * page loads the plan from Planning Center.
 */
export default function NextPlanCard({ entry }: NextPlanCardProps) {
    const headingId = `next-plan-${entry.serviceType.id}`;

    if (entry.status !== "plan") {
        return (
            <section aria-labelledby={headingId} className={CARD_CLASS}>
                <CardHeader>
                    <h3
                        id={headingId}
                        className="text-lg font-semibold text-gray-900 dark:text-gray-100"
                    >
                        {entry.serviceType.name}
                    </h3>
                </CardHeader>
                {entry.status === "failed" ? (
                    <p className="m-4 sm:mx-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {NEXT_PLAN_FAILED_TEXT}
                    </p>
                ) : (
                    <p className="px-4 sm:px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {NO_NEXT_PLAN_TEXT}
                    </p>
                )}
            </section>
        );
    }

    const { serviceType, plan, songs } = entry;
    const label = planLabel(plan, serviceType);
    const scheduleHref = routes.planSchedule(serviceType.id, plan.id);
    const summary = planNotesSummary(entry);

    return (
        <section aria-labelledby={headingId} className={CARD_CLASS}>
            <CardHeader>
                <h3 id={headingId} className="text-lg font-semibold">
                    <Link
                        prefetch={false}
                        href={routes.plan(serviceType.id, plan.id)}
                        className={HEADING_LINK_CLASS}
                    >
                        {label}
                    </Link>
                </h3>
                {plan.title && (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{plan.title}</p>
                )}
            </CardHeader>
            <PlanSongs songs={songs} scheduleHref={scheduleHref} />
            <div className="px-4 sm:px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                {summary && <p className={`text-sm ${SUMMARY_CLASSES[summary.tone]}`}>{summary.text}</p>}
                <Link
                    prefetch={false}
                    href={scheduleHref}
                    className={`ml-auto text-sm font-medium whitespace-nowrap ${LINK_CLASS}`}
                >
                    Service Schedule
                    <span className="sr-only">, {label}</span>
                    <span aria-hidden="true"> →</span>
                </Link>
            </div>
        </section>
    );
}
