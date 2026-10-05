import type { Metadata } from "next";
import ImportNotice from "@/app/components/Catalog/Import/ImportNotice";
import ImportRunsList from "@/app/components/Catalog/Import/ImportRunsList";
import { countOf } from "@/lib/catalog/counts";
import PreviewSeedForm from "@/app/components/Catalog/Import/PreviewSeedForm";
import PageHeader from "@/app/components/ui/PageHeader";
import { getCatalogCounts } from "@/lib/queries/catalog";
import { getCatalogImportRuns } from "@/lib/queries/catalogImport";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Import" };

/**
 * The import runs, and the button that previews the seed from hymns.json.
 * Both queries read the local database, so a failure falls through to the
 * shell's error boundary. A preview always works; applying one refuses once
 * the catalog has books, which the page says up front.
 */
export default function ImportPage() {
    const runs = getCatalogImportRuns();
    const counts = getCatalogCounts();

    return (
        <div className="font-sans w-full max-w-4xl mx-auto">
            <PageHeader
                title="Import"
                description="Seed the catalog from hymns.json, and review each run."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Import" },
                ]}
            />
            <div className="w-full max-w-4xl mx-auto space-y-8">
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
