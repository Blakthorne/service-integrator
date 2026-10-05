interface ExportCsvButtonProps {
    /** Whether there is anything to export. */
    canExport: boolean;
    /** What the button does, said as its tooltip while there is something to export. */
    title: string;
    /** Its tooltip while there is nothing to export. */
    emptyTitle: string;
    /** Called to download the rows as a CSV file. */
    onExport: () => void;
}

/**
 * The "Export CSV" button of a list that can be narrowed (the songs list,
 * the reports). Like `SubmitButton`, it is `aria-disabled` rather than
 * `disabled` when there is nothing to export, so it keeps focus when the
 * filters leave no rows.
 */
export default function ExportCsvButton({
    canExport,
    title,
    emptyTitle,
    onExport,
}: ExportCsvButtonProps) {
    return (
        <button
            type="button"
            aria-disabled={!canExport}
            title={canExport ? title : emptyTitle}
            onClick={() => {
                if (canExport) {
                    onExport();
                }
            }}
            className={`px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                canExport
                    ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-600"
                    : "opacity-50 cursor-not-allowed"
            }`}
        >
            Export CSV
        </button>
    );
}
