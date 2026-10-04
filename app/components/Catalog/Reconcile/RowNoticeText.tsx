import type { RowNotice } from "./useRowNotice";

interface RowNoticeTextProps {
    id: string;
    notice: RowNotice | null;
}

/**
 * What a list says after one of its rows left ("Linked …"). It is always in
 * the page, empty until there is something to say, so screen readers
 * announce it as it changes; focus comes here when the list is empty now.
 */
export default function RowNoticeText({ id, notice }: RowNoticeTextProps) {
    return (
        <p
            id={id}
            role="status"
            tabIndex={-1}
            className={
                notice
                    ? "rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 focus:outline-none dark:border-green-900 dark:bg-green-950 dark:text-green-200"
                    : "sr-only"
            }
        >
            {notice?.message}
        </p>
    );
}
