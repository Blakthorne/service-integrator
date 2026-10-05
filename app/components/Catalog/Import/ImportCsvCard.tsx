import Link from "next/link";
import {
    CSV_COLUMN_HELP,
    CSV_SAMPLE_NUMBERED,
    CSV_SAMPLE_UNNUMBERED,
} from "@/lib/catalog/importText";
import { routes } from "@/lib/routes";
import { TEXT_LINK_CLASS } from "../Books/styles";
import ImportCsvForm, { type ImportBookOption } from "./ImportCsvForm";

interface ImportCsvCardProps {
    /** Every book, in book order. */
    books: ImportBookOption[];
}

interface SampleProps {
    caption: string;
    csv: string;
}

/**
 * A sample file in a box that scrolls sideways rather than widen the page. The
 * box takes focus (`tabIndex`), so a keyboard user can scroll it, and is named
 * for what it shows.
 */
function Sample({ caption, csv }: SampleProps) {
    return (
        <div>
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{caption}</p>
            <pre
                tabIndex={0}
                role="region"
                aria-label={caption}
                className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100"
            >
                {csv}
            </pre>
        </div>
    );
}

/**
 * The Import a book from CSV section of the Import page: what the file needs
 * (its columns, and a small sample for each kind of book), then the form. A
 * catalog with no books has nothing to import into, and says to add one
 * first. The section reads only what the page gives it, so it never waits.
 */
export default function ImportCsvCard({ books }: ImportCsvCardProps) {
    return (
        <section
            aria-labelledby="csv-heading"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 sm:p-6"
        >
            <h2 id="csv-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Import a book from CSV
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Adds a book&apos;s songs from a spreadsheet saved as a CSV file, one row for each
                place a song has in the book. A preview checks the file against the catalog and
                lists everything wrong with it; nothing is added until you apply it.
            </p>
            <h3 className="mt-5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                What the file needs
            </h3>
            <dl className="mt-2 space-y-2 text-sm">
                {CSV_COLUMN_HELP.map((column) => (
                    <div key={column.name}>
                        <dt className="inline">
                            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-900 dark:bg-gray-700 dark:text-gray-100">
                                {column.name}
                            </code>
                        </dt>{" "}
                        <dd className="inline text-gray-600 dark:text-gray-300">{column.text}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Sample caption="A numbered book" csv={CSV_SAMPLE_NUMBERED} />
                <Sample caption="A book without numbers" csv={CSV_SAMPLE_UNNUMBERED} />
            </div>
            <div className="mt-6">
                {books.length === 0 ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        The catalog has no books to import into.{" "}
                        <Link href={routes.catalogBookAdd()} className={TEXT_LINK_CLASS}>
                            Add a book first
                        </Link>
                        , then come back here.
                    </p>
                ) : (
                    <ImportCsvForm books={books} />
                )}
            </div>
        </section>
    );
}
