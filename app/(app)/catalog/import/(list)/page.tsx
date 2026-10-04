import type { Metadata } from "next";
import ImportCsvCard from "@/app/components/Catalog/Import/ImportCsvCard";
import ImportNotice from "@/app/components/Catalog/Import/ImportNotice";
import ImportRunsList from "@/app/components/Catalog/Import/ImportRunsList";
import { countOf } from "@/lib/catalog/counts";
import PreviewSeedForm from "@/app/components/Catalog/Import/PreviewSeedForm";
import PageHeader from "@/app/components/ui/PageHeader";
import { getCatalogBooks, getCatalogCounts } from "@/lib/queries/catalog";
import { getCatalogImportRuns } from "@/lib/queries/catalogImport";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Import" };

/**
 * Import a book from a CSV file, the button that previews the seed from
 * hymns.json, and the import runs. The queries read the local database, so a
 * failure falls through to the shell's error boundary. A preview always
 * works; applying the seed refuses once the catalog has books, which the
 * page says up front.
 */
export default function ImportPage() {
    const runs = getCatalogImportRuns();
    const counts = getCatalogCounts();
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
                description="Import a book's songs from a CSV file, seed the catalog from hymns.json, and review each run."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Import" },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto space-y-8">
                <ImportCsvCard books={books} />
                <section
                    aria-labelledby="seed-heading"
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 sm:p-6"
                >
                    <h2
                        id="seed-heading"
                        className="text-lg font-semibold text-gray-900 dark:text-gray-100"
                    >
                        Seed from hymns.json
                    </h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        Reads the hymn data that ships with the app and plans the
                        catalog&apos;s books, hymns, tunes, songs and entries. A
                        preview changes nothing: review its report, then apply it or
                        discard it.
                    </p>
                    {counts.books > 0 && (
                        <div className="mt-4">
                            <ImportNotice tone="warning">
                                The catalog already has{" "}
                                {countOf(counts.books, "book")} and{" "}
                                {countOf(counts.songs, "song")}. You can still preview
                                the seed, but Apply will refuse.
                            </ImportNotice>
                        </div>
                    )}
                    <div className="mt-4">
                        <PreviewSeedForm />
                    </div>
                </section>
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
