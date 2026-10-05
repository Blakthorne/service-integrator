import type { Book } from "@/lib/domain";
import EditBookForm from "./EditBookForm";

interface EditBookCardProps {
    book: Pick<Book, "id" | "code" | "name" | "shortName" | "labelFormat" | "numbered" | "active">;
}

/**
 * A book's Edit form on its page, behind a disclosure: the page is for
 * browsing the book's entries, which can run to hundreds, and an open form
 * would push them off the first screen. It is the browser's own
 * `<details>`, so it works without script; the form inside keeps its state
 * while the disclosure is closed.
 */
export default function EditBookCard({ book }: EditBookCardProps) {
    return (
        <details className="group bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-700 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span>
                    <span className="block text-base font-semibold text-gray-900 dark:text-gray-100">
                        Edit this book
                    </span>
                    <span className="block text-sm text-gray-600 dark:text-gray-300">
                        Its name, label, and whether it is in use.
                    </span>
                </span>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180 dark:text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                    />
                </svg>
            </summary>
            <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700 sm:px-6 sm:py-6">
                <EditBookForm book={book} />
            </div>
        </details>
    );
}
