import { Suspense } from "react";
import UnusedHymnsView from "@/app/components/UnusedHymns/UnusedHymnsView";

export const metadata = {
    title: "Unused Hymns",
};

export default function UnusedHymnsPage() {
    return (
        <div className="font-sans">
            <div className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-bold mb-2">
                    Unused Hymns
                </h1>
                <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                    Hymns from each hymnbook that have never been scheduled in a
                    Planning Center service plan.
                </p>
            </div>
            <Suspense
                fallback={
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                    </div>
                }
            >
                <UnusedHymnsView />
            </Suspense>
        </div>
    );
}
