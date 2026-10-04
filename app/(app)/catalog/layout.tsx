import CatalogSectionNav from "@/app/components/Catalog/CatalogSectionNav";

/**
 * The frame of every catalog page: the section nav (Songs · Tunes · Books ·
 * Reconcile · Import, from `CATALOG_SECTIONS`) above the page. It fetches
 * nothing, so no boundary has to sit one level up: each page's own
 * `loading.tsx`, `error.tsx` and `not-found.tsx` cover everything it reads,
 * and the nav stays on screen while they show.
 *
 * It leaves the width to each page. Most wrap their header and content in
 * `max-w-4xl`, the width of the nav; the import report's content takes
 * `max-w-5xl`, under a header as wide as the nav.
 */
export default function CatalogLayout({ children }: LayoutProps<"/catalog">) {
    return (
        <div className="font-sans">
            <div className="w-full max-w-4xl mx-auto">
                <CatalogSectionNav />
            </div>
            {children}
        </div>
    );
}
