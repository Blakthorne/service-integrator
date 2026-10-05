import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import CatalogTunesView from "@/app/components/Catalog/Tunes/CatalogTunesView";
import EmptyState from "@/app/components/ui/EmptyState";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { toCatalogTuneRow } from "@/lib/catalog/tuneFilter";
import { getCatalogTunes } from "@/lib/queries/catalog";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Tunes" };

/**
 * Every tune with how many songs use it, which the view searches and pages
 * in the browser. It sits in a `(list)` route group so that its
 * `loading.tsx` covers the list and not the tune pages below it.
 */
export default function CatalogTunesPage() {
    const tunes = getCatalogTunes().map(toCatalogTuneRow);

    return (
        <div className="w-full max-w-4xl mx-auto">
            <PageHeader
                title="Tunes"
                description="Every tune in the catalog, with how many songs use it."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Tunes" },
                ]}
            />
            {tunes.length === 0 ? (
                <EmptyState
                    title="No tunes yet"
                    description="Import the hymnals to fill the catalog."
                    action={
                        <Link
                            href={routes.catalogImport()}
                            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                            Go to Import
                        </Link>
                    }
                />
            ) : (
                // The view reads the query string, which needs a Suspense boundary.
                <Suspense fallback={<LoadingState label="Loading tunes…" />}>
                    <CatalogTunesView tunes={tunes} />
                </Suspense>
            )}
        </div>
    );
}
