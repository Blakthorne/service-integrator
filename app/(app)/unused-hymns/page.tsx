import { Suspense } from "react";
import UnusedHymnsView from "@/app/components/UnusedHymns/UnusedHymnsView";
import LoadingState from "@/app/components/ui/LoadingState";
import PageHeader from "@/app/components/ui/PageHeader";
import { getUnusedHymns } from "@/lib/queries/unusedHymns";

export const metadata = {
    title: "Unused Hymns",
};

/**
 * The unused hymns page. The server loads the result (cached for an hour);
 * the view filters, sorts and pages it in the browser.
 */
export default async function UnusedHymnsPage() {
    const result = await getUnusedHymns();

    return (
        <div className="font-sans">
            <PageHeader
                title="Unused Hymns"
                description="Hymns from each hymnbook that have never been scheduled in a Planning Center service plan."
            />
            {/* The view reads the query string, which needs a Suspense boundary. */}
            <Suspense fallback={<LoadingState label="Loading unused hymns…" />}>
                <UnusedHymnsView initialResult={result} />
            </Suspense>
        </div>
    );
}
