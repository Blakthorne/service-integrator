import { NO_SERVICE_TYPES_TEXT, databaseNotice, serviceTypesNotice } from "@/lib/dashboard";
import type { Dashboard } from "@/lib/queries/dashboard";
import HistoryStats from "./HistoryStats";
import NextPlanCard from "./NextPlanCard";
import TodoList from "./TodoList";
import { NOTICE_CLASS, SECTION_HEADING_CLASS } from "./styles";

interface DashboardViewProps {
    dashboard: Dashboard;
}

/**
 * The dashboard below its header: a warning when the database cannot be
 * read, each service type's next plan as a card (side by side from `lg`
 * when there are two or more), then the to-dos, then the song history's
 * figures (the year's songs, each active book's coverage, the last history
 * sync). What could not be read is said where it is missing, and the rest is
 * still shown: without the database the plans come without numbers or notes,
 * and there are no history figures; without Planning Center's service types,
 * a warning stands in place of the cards.
 */
export default function DashboardView({ dashboard }: DashboardViewProps) {
    const { serviceTypes } = dashboard;
    const databaseWarning = databaseNotice(dashboard);
    const serviceTypesWarning = serviceTypesNotice(dashboard);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-8">
            {databaseWarning && <p className={NOTICE_CLASS}>{databaseWarning}</p>}
            <section aria-labelledby="next-plans-heading">
                <h2 id="next-plans-heading" className={SECTION_HEADING_CLASS}>
                    Next plans
                </h2>
                {serviceTypesWarning ? (
                    <p className={NOTICE_CLASS}>{serviceTypesWarning}</p>
                ) : serviceTypes.length === 0 ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">{NO_SERVICE_TYPES_TEXT}</p>
                ) : (
                    <div
                        className={`grid gap-6 items-start ${
                            serviceTypes.length > 1 ? "lg:grid-cols-2" : ""
                        }`}
                    >
                        {serviceTypes.map((entry) => (
                            <NextPlanCard key={entry.serviceType.id} entry={entry} />
                        ))}
                    </div>
                )}
            </section>
            <TodoList dashboard={dashboard} />
            {dashboard.history && <HistoryStats history={dashboard.history} />}
        </div>
    );
}
