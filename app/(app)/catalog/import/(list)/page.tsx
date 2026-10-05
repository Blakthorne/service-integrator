import type { Metadata } from "next";
import ImportCsvCard from "@/app/components/Catalog/Import/ImportCsvCard";
import ImportRunsList from "@/app/components/Catalog/Import/ImportRunsList";
import PageHeader from "@/app/components/ui/PageHeader";
import { getCatalogBooks } from "@/lib/queries/catalog";
import { getCatalogImportRuns } from "@/lib/queries/catalogImport";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Import" };

/**
 * Import a book from a CSV file, and the import runs: each book file's, and
 * the seed's from before the seed was removed. The queries read the local
 * database, so a failure falls through to the shell's error boundary.
 */
export default function ImportPage() {
    const runs = getCatalogImportRuns();
    // What the form needs of each book; the rest of a book's row stays on the server.
    const books = getCatalogBooks().map(({ id, name, code, numbered, active }) => ({
        id,
        name,
        code,
        numbered,
        active,
    }));

    return (
        <div className="font-sans w-full max-w-4xl mx-auto">
            <PageHeader
                title="Import"
                description="Import a book's songs from a CSV file, and review each run."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Import" },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto space-y-8">
                <ImportCsvCard books={books} />
                <section aria-labelledby="runs-heading">
                    <h2
                        id="runs-heading"
                        className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100"
                    >
                        Import runs
                    </h2>
                    <ImportRunsList runs={runs} />
                </section>
            </div>
        </div>
    );
}
