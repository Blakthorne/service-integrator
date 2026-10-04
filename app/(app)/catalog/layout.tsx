import CatalogSectionNav from "@/app/components/Catalog/CatalogSectionNav";

/**
 * The frame of every catalog page: the section nav (Songs · Tunes · Books ·
 * Import) above the page. It fetches nothing, so no boundary has to sit one
 * level up: each page's own `loading.tsx`, `error.tsx` and `not-found.tsx`
 * cover everything it reads, and the nav stays on screen while they show.
 */
export default function CatalogLayout({ children }: LayoutProps<"/catalog">) {
    return (
        <div className="font-sans w-full max-w-4xl mx-auto">
            <CatalogSectionNav />
            {children}
        </div>
    );
}
