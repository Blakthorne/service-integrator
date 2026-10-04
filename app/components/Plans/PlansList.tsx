"use client";

import Pagination from "../ui/Pagination";
import { useUrlState } from "@/app/hooks/useUrlState";
import {
    PLAN_DATES_PER_PAGE,
    jumpToMonth,
    planMonths,
    splitPlanDates,
    type MonthJump,
} from "@/lib/plansByDate";
import { parsePage } from "@/lib/urlState";
import type { PlanSummary } from "@/lib/domain";
import JumpToMonth from "./JumpToMonth";
import PlanDateCard from "./PlanDateCard";

interface PlansListProps {
    /** The dates (`YYYY-MM-DD`) that have plans, newest first. */
    dates: string[];
    /** The plans on each date, in service-type order. */
    plansByDate: Record<string, PlanSummary[]>;
    /**
     * Today, `YYYY-MM-DD`, by the server's calendar (`localYmd`). It comes from
     * the page, not from the browser's clock, so the list renders the same on
     * the server and in the browser, and a plan dated today is upcoming for
     * the whole day.
     */
    today: string;
}

const SECTION_HEADING = "text-xl font-semibold text-gray-900 dark:text-gray-100";

/**
 * Every plan, in two sections. Upcoming (the plans dated today or later,
 * soonest first) is at the top of the first page. Past plans, newest first,
 * are paged 25 dates a page, with Jump to month, a choice of the months that
 * have past plans, which takes the list to the page that holds the month's
 * first date. The server loads the plans; this only splits and pages them.
 *
 * The page number lives in `?page=` (page 1 has none), changed without a
 * server round trip, and each page change, a jump too, adds a history entry,
 * so Back returns to the previous page. Each row links to the plan's page:
 * the service type is a real link stretched over the row.
 */
export default function PlansList({
    dates,
    plansByDate,
    today,
}: PlansListProps): React.ReactElement {
    const { searchParams, setSearchParams } = useUrlState();

    const { upcoming, past } = splitPlanDates(dates, today);
    const totalPages = Math.ceil(past.length / PLAN_DATES_PER_PAGE);
    const currentPage = parsePage(searchParams.get("page"), totalPages);

    const startIndex = (currentPage - 1) * PLAN_DATES_PER_PAGE;
    const currentDates = past.slice(startIndex, startIndex + PLAN_DATES_PER_PAGE);

    function goToPage(page: number) {
        setSearchParams(
            { page: page === 1 ? null : String(page) },
            { history: "push" }
        );
    }

    function handleJump(month: string): MonthJump {
        const jump = jumpToMonth(past, month);
        if (jump.ok) {
            goToPage(jump.page);
        }
        return jump;
    }

    return (
        <div className="w-full space-y-10">
            {currentPage === 1 && (
                <section aria-labelledby="upcoming-heading" className="space-y-4">
                    <h2 id="upcoming-heading" className={SECTION_HEADING}>
                        Upcoming
                    </h2>
                    {upcoming.length === 0 ? (
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            No plans are dated today or later.
                        </p>
                    ) : (
                        upcoming.map((date) => (
                            <PlanDateCard key={date} date={date} plans={plansByDate[date]} />
                        ))
                    )}
                </section>
            )}

            <section aria-labelledby="past-heading" className="space-y-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <h2 id="past-heading" className={SECTION_HEADING}>
                        Past plans
                    </h2>
                    {past.length > 0 && (
                        <JumpToMonth
                            months={planMonths(past)}
                            currentPage={currentPage}
                            onJump={handleJump}
                        />
                    )}
                </div>

                {past.length === 0 && (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        No plans are dated before today.
                    </p>
                )}

                {totalPages > 1 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden px-4">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={goToPage}
                        />
                    </div>
                )}

                {currentDates.map((date) => (
                    <PlanDateCard key={date} date={date} plans={plansByDate[date]} />
                ))}

                {totalPages > 1 && (
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden px-4 mt-8">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={goToPage}
                        />
                    </div>
                )}
            </section>
        </div>
    );
}
