"use client";

import { useMemo, useRef } from "react";
import DateField from "@/app/components/ui/DateField";
import ExportCsvButton from "@/app/components/ui/ExportCsvButton";
import Pagination from "@/app/components/ui/Pagination";
import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import { useUrlState } from "@/app/hooks/useUrlState";
import { MOST_SUNG_PERIOD_LABELS, type MostSungPeriod } from "@/lib/reports";
import {
    DEFAULT_PERIOD,
    DEFAULT_REPORT,
    PERIOD_OPTIONS,
    REPORTS,
    REPORT_DESCRIPTIONS,
    REPORT_LABELS,
    describeReport,
    notSinceDate,
    pageReportRows,
    parseReportsQuery,
    reportCsv,
    reportCsvFilename,
    selectReportRows,
    type ReportData,
    type ReportKind,
} from "@/lib/reportsView";
import { downloadCsv } from "../Catalog/Songs/downloadCsv";
import ReportTable from "./ReportTable";

const GROUP_LABEL =
    "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

const REPORT_OPTIONS: readonly SegmentedOption<ReportKind>[] = REPORTS.map((report) => ({
    value: report,
    label: REPORT_LABELS[report],
    title: REPORT_DESCRIPTIONS[report],
}));

/** What a table says when its report has no rows. */
const EMPTY_MESSAGES: Readonly<Record<ReportKind, string>> = {
    "most-sung": "No song was sung in this period.",
    "last-sung": "No catalog song is linked to a Planning Center song yet.",
    "not-sung": "Every song was sung since this date.",
};

interface ReportsViewProps {
    /** What the page sends: the date it is as of, and the rows of "most sung" and "last sung". */
    data: ReportData;
}

/**
 * The reports, in the browser: one at a time, chosen with a picker
 * (`?report=`), each with a table of its songs in pages (`?page=`) and
 * Export CSV, which downloads every row of the report, not only the page
 * shown. "Most sung" has a period (`?period=`: the last 12 months, this year
 * or all time), and "not sung since" a date (`?notSince=`, a year ago until
 * one is chosen) that it works out from the rows of "last sung" as it is
 * typed, with no round trip. All of it lives in the URL, so a view can be
 * linked to and survives Back. A choice replaces the history entry and sends
 * the table back to page 1; pages push one, so Back steps through them. A
 * value at its default (the most sung, the last 12 months, a year ago, page
 * 1) leaves the URL.
 */
export default function ReportsView({ data }: ReportsViewProps) {
    const { searchParams, setSearchParams } = useUrlState();
    const listRef = useRef<HTMLDivElement>(null);

    const { report, period, notSince, page } = parseReportsQuery(searchParams);
    const since = notSinceDate(notSince, data.today);
    const rows = useMemo(
        () => selectReportRows(data, { report, period }, since),
        [data, report, period, since]
    );
    const shown = pageReportRows(rows, page);

    function handleReportChange(next: ReportKind) {
        setSearchParams(
            { report: next === DEFAULT_REPORT ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handlePeriodChange(next: MostSungPeriod) {
        setSearchParams(
            { period: next === DEFAULT_PERIOD ? null : next, page: null },
            { history: "replace" }
        );
    }

    function handleDateChange(next: string) {
        // An emptied field leaves the report as it is, on the date it has;
        // the field shows that date again when it is left.
        if (next !== "") {
            setSearchParams({ notSince: next, page: null }, { history: "replace" });
        }
    }

    function handleExport() {
        // Every row of the report, in the order shown, from the same
        // function as the page: what is exported is what is listed.
        downloadCsv(
            reportCsvFilename(report, { period, since }, new Date()),
            reportCsv(report, rows)
        );
    }

    function handlePageChange(next: number) {
        setSearchParams({ page: next === 1 ? null : String(next) }, { history: "push" });
        // Paging from the bottom of a long page: bring the new page's first
        // rows into view.
        const list = listRef.current;
        if (list && list.getBoundingClientRect().top < 0) {
            list.scrollIntoView({ block: "start" });
        }
    }

    const caption =
        report === "most-sung" ? `Most sung, ${MOST_SUNG_PERIOD_LABELS[period].toLowerCase()}` : REPORT_LABELS[report];

    return (
        <div className="space-y-6">
            <div
                role="group"
                aria-label="Report"
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 space-y-4"
            >
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div className="max-w-full space-y-1">
                        <span className={GROUP_LABEL}>Report</span>
                        <Segmented
                            value={report}
                            options={REPORT_OPTIONS}
                            onChange={handleReportChange}
                            ariaLabel="Choose a report"
                        />
                    </div>
                    {report === "most-sung" && (
                        <div className="max-w-full space-y-1">
                            <span className={GROUP_LABEL}>Period</span>
                            <Segmented
                                value={period}
                                options={PERIOD_OPTIONS}
                                onChange={handlePeriodChange}
                                ariaLabel="Period"
                            />
                        </div>
                    )}
                    {report === "not-sung" && (
                        <DateField
                            label="Not sung since"
                            hint="A song sung on this date counts as sung."
                            value={since}
                            onChange={handleDateChange}
                        />
                    )}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400">{REPORT_DESCRIPTIONS[report]}</p>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                    <p
                        aria-live="polite"
                        className="text-sm font-medium text-gray-900 dark:text-gray-100"
                    >
                        {describeReport(report, rows, { period, since })}
                    </p>
                    <ExportCsvButton
                        canExport={rows.length > 0}
                        title="Download every row of this report, on every page, as a CSV file"
                        emptyTitle="No rows to export"
                        onExport={handleExport}
                    />
                </div>
            </div>
            <div
                ref={listRef}
                className="scroll-mt-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden"
            >
                <ReportTable
                    report={report}
                    rows={shown.rows}
                    caption={caption}
                    firstPlace={shown.firstPlace}
                    emptyMessage={EMPTY_MESSAGES[report]}
                />
                {shown.totalPages > 1 && (
                    <div className="px-4 border-t border-gray-200 dark:border-gray-700">
                        <Pagination
                            currentPage={shown.page}
                            totalPages={shown.totalPages}
                            onPageChange={handlePageChange}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
