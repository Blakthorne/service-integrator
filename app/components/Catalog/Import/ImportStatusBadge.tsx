import type { ImportRunStatus } from "@/lib/domain";
import { STATUS_LABELS } from "@/lib/catalog/importText";

const STATUS_STYLES: Record<ImportRunStatus, string> = {
    preview: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    applied: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    discarded: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

interface ImportStatusBadgeProps {
    status: ImportRunStatus;
}

/** An import run's status as a small pill: Preview, Applied or Discarded. */
export default function ImportStatusBadge({ status }: ImportStatusBadgeProps) {
    return (
        <span
            className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
        >
            {STATUS_LABELS[status]}
        </span>
    );
}
