import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LINK_CLASS } from "@/app/components/Catalog/CatalogCard";
import IgnoredSongs from "@/app/components/Catalog/Reconcile/IgnoredSongs";
import RecentAutoLinks from "@/app/components/Catalog/Reconcile/RecentAutoLinks";
import ReconcileView from "@/app/components/Catalog/Reconcile/ReconcileView";
import SyncNowButton from "@/app/components/Settings/SyncNowButton";
import SyncRunStatus from "@/app/components/Settings/SyncRunStatus";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { describeNotInPcoCount, describeUnlinkedCount } from "@/lib/catalog/linkText";
import { RECENT_AUTO_LINK_DAYS, getReconcileData } from "@/lib/queries/reconcile";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Reconcile" };

/** The look of a section's heading on this page. */
const SECTION_HEADING = "text-lg font-semibold text-gray-900 dark:text-gray-100";

/** The look of the sentence under a section's heading. */
const SECTION_TEXT = "mt-1 text-sm text-gray-600 dark:text-gray-300";

/**
 * Reconcile: linking Planning Center songs to catalog songs. It lists the
 * Planning Center songs not in the catalog, each with its suggestions,
 * Link, a search over every catalog song, a new catalog song made from it
 * and Ignore; the links syncs made lately, with Undo; the ignored songs,
 * with Unignore; and the last sync, with Sync now, and how many catalog
 * songs are not in Planning Center. Everything it reads is in the local
 * database (`getReconcileData`); its changes are server actions that
 * revalidate every page that shows links.
 */
export default function ReconcilePage() {
    const data = getReconcileData();
    const syncedOnce = data.lastSync !== null;

    return (
        <>
            <PageHeader
                title="Reconcile"
                description="Link each Planning Center song to the catalog song it is."
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Reconcile" },
                ]}
            />
            <div className="space-y-10">
                <section
                    aria-labelledby="sync-heading"
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6 space-y-4"
                >
                    <div>
                        <h2 id="sync-heading" className={SECTION_HEADING}>
                            Planning Center sync
                        </h2>
                        <p className={SECTION_TEXT}>
                            Last sync: <SyncRunStatus run={data.lastSync} />
                        </p>
                    </div>
                    <SyncNowButton />
                    {data.catalogSongs.length > 0 && (
                        <p className="border-t border-gray-100 dark:border-gray-700 pt-4 text-sm text-gray-700 dark:text-gray-300">
                            {describeNotInPcoCount(data.catalogSongsNotInPco)}{" "}
                            {data.catalogSongsNotInPco > 0 && (
                                // Default prefetch: the songs list reads only the local database.
                                <Link
                                    href={routes.catalogFiltered({ linked: "no" })}
                                    className={LINK_CLASS}
                                >
                                    Show them in the catalog
                                </Link>
                            )}
                        </p>
                    )}
                </section>

                <section aria-labelledby="unlinked-heading" className="space-y-4">
                    <div>
                        <h2 id="unlinked-heading" className={SECTION_HEADING}>
                            Not in the catalog
                        </h2>
                        <p className={SECTION_TEXT}>
                            {syncedOnce
                                ? describeUnlinkedCount(data.unlinked.length)
                                : "No Planning Center songs yet: Sync now reads the song library."}
                        </p>
                        {data.catalogSongs.length === 0 && (
                            <p className={SECTION_TEXT}>
                                The catalog is empty, so there is nothing to link to yet.{" "}
                                <Link href={routes.catalogImport()} className={LINK_CLASS}>
                                    Go to Import
                                </Link>
                            </p>
                        )}
                    </div>
                    {/* The view reads the query string, which needs a Suspense boundary. */}
                    <Suspense fallback={<LoadingState label="Loading the Planning Center songs…" />}>
                        <ReconcileView unlinked={data.unlinked} catalogSongs={data.catalogSongs} />
                    </Suspense>
                </section>

                <section aria-labelledby="auto-links-heading" className="space-y-4">
                    <div>
                        <h2 id="auto-links-heading" className={SECTION_HEADING}>
                            Recent auto-links
                        </h2>
                        <p className={SECTION_TEXT}>
                            The links syncs made in the last {RECENT_AUTO_LINK_DAYS} days, newest
                            first. Undo one that is wrong: no sync will make it again, and its
                            Planning Center song goes back on the list above.
                        </p>
                    </div>
                    <RecentAutoLinks links={data.recentAutoLinks} />
                </section>

                <section aria-labelledby="ignored-heading" className="space-y-4">
                    <div>
                        <h2 id="ignored-heading" className={SECTION_HEADING}>
                            Ignored
                        </h2>
                        <p className={SECTION_TEXT}>
                            Planning Center songs set aside as not hymnal material. Plan pages
                            suggest nothing for them.
                        </p>
                    </div>
                    <IgnoredSongs songs={data.ignored} />
                </section>
            </div>
        </>
    );
}
