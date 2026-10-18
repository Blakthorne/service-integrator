import type { Metadata } from "next";
import Link from "next/link";
import CreditLabelProblems from "@/app/components/Catalog/Credits/CreditLabelProblems";
import CreditLabelsProgress from "@/app/components/Catalog/Credits/CreditLabelsProgress";
import CreditLabelsView from "@/app/components/Catalog/Credits/CreditLabelsView";
import ManualCreditLabels from "@/app/components/Catalog/Credits/ManualCreditLabels";
import SyncRunStatus from "@/app/components/Settings/SyncRunStatus";
import PageHeader from "@/app/components/ui/PageHeader";
import { describeCreditLabelReview, toCreditLabelTierViews } from "@/lib/creditLabels";
import { getCreditLabelsPage } from "@/lib/queries/credits";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Credits" };

/** The look of a section's heading on this page. */
const SECTION_HEADING = "text-lg font-semibold text-gray-900 dark:text-gray-100";

/** The look of the sentence under a section's heading. */
const SECTION_TEXT = "mt-1 text-sm text-gray-600 dark:text-gray-300";

/** A link inside a line of text: underlined, not just coloured (convention 20). */
const TEXT_LINK_CLASS =
    "text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300";

/**
 * Credits: label the songs' authors in Planning Center in the credits
 * convention (`Words: …; Music: …`; see lib/creditLabels.ts). It shows how
 * the songs stand and the labels being written, with Stop; the songs the
 * app can label, by shape, to choose and Label; the songs that need a
 * person, with where to fix each; and the labels that lately did not go
 * through. Everything it reads is in the local database
 * (`getCreditLabelsPage`), so it has no loading state, and the background
 * job does the writing.
 */
export default function CreditLabelsPage() {
    const data = getCreditLabelsPage();
    const noSongs = data.lastSync === null && data.review.labelled === 0 && data.review.manual.length === 0;

    return (
        <div className="w-full max-w-4xl mx-auto">
            <PageHeader
                title="Credits"
                description="Label each song's author in Planning Center, as the credit editor writes it."
                breadcrumbs={[{ label: "Catalog", href: routes.catalog() }, { label: "Credits" }]}
            />
            <div className="space-y-10">
                <section
                    aria-labelledby="credits-status-heading"
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6 space-y-4"
                >
                    <div>
                        <h2 id="credits-status-heading" className={SECTION_HEADING}>
                            Where the songs stand
                        </h2>
                        <p className={SECTION_TEXT}>
                            {noSongs ? (
                                <>
                                    No Planning Center songs yet: Sync now on{" "}
                                    <Link href={routes.catalogReconcile()} className={TEXT_LINK_CLASS}>
                                        Reconcile
                                    </Link>{" "}
                                    reads the song library.
                                </>
                            ) : (
                                describeCreditLabelReview(data.review)
                            )}
                        </p>
                    </div>
                    <CreditLabelsProgress waiting={data.waiting} />
                    <p className="border-t border-gray-100 dark:border-gray-700 pt-4 text-sm text-gray-700 dark:text-gray-300">
                        Last writing: <SyncRunStatus run={data.lastRun} />
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        A label names the same people in the same roles as the copyright text
                        does now, so labelling a song changes what Planning Center&apos;s author
                        says, and the copyright text only where a song&apos;s row says so. Each
                        write is listed under Recent writes on{" "}
                        <Link href={routes.settings()} className={TEXT_LINK_CLASS}>
                            Settings
                        </Link>
                        .
                    </p>
                </section>

                <CreditLabelsView tiers={toCreditLabelTierViews(data.review)} />

                <section aria-labelledby="credits-manual-heading" className="space-y-3">
                    <div>
                        <h2 id="credits-manual-heading" className={SECTION_HEADING}>
                            Needs a person{" "}
                            <span className="font-normal text-gray-500 dark:text-gray-400 tabular-nums">
                                ({data.review.manual.length})
                            </span>
                        </h2>
                        <p className={SECTION_TEXT}>
                            The app cannot label these without dropping or guessing a name. Each
                            one says why: label it with the credit editor on its catalog song&apos;s
                            page, or in Planning Center for a song not in the catalog.
                        </p>
                    </div>
                    <ManualCreditLabels rows={data.review.manual} />
                </section>

                <section aria-labelledby="credits-problems-heading" className="space-y-3">
                    <div>
                        <h2 id="credits-problems-heading" className={SECTION_HEADING}>
                            Not written lately
                        </h2>
                        <p className={SECTION_TEXT}>
                            The latest labels that ended without being written, newest first.
                        </p>
                    </div>
                    <CreditLabelProblems problems={data.problems} />
                </section>
            </div>
        </div>
    );
}
