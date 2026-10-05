"use client";

import Link from "next/link";
import { usePathname, useSelectedLayoutSegments } from "next/navigation";
import { catalogLayoutSegment } from "@/lib/catalog/sections";
import { CATALOG_SECTIONS, catalogSectionFor } from "@/lib/routes";

/**
 * The catalog's sections (Songs · Tunes · Books · Import), one link per entry
 * of `CATALOG_SECTIONS`. The section of the page shown is highlighted, and
 * gets `aria-current` as the top bar's links do: "page" on the section's own
 * page, and "true" on a page inside it (a song's page is in Songs), whose
 * breadcrumb is the current page.
 *
 * Render it from the catalog layout: the section comes from the segments
 * below that layout (see `catalogLayoutSegment`).
 */
export default function CatalogSectionNav() {
    const pathname = usePathname();
    const current = catalogSectionFor(
        catalogLayoutSegment(useSelectedLayoutSegments())
    );

    return (
        <nav
            aria-label="Catalog sections"
            className="mb-6 flex flex-wrap gap-1 sm:gap-2 border-b border-gray-200 dark:border-gray-700 pb-3"
        >
            {CATALOG_SECTIONS.map((section) => {
                const isActive = section === current;
                const ariaCurrent = isActive
                    ? pathname === section.href
                        ? "page"
                        : "true"
                    : undefined;
                return (
                    <Link
                        key={section.href}
                        href={section.href}
                        aria-current={ariaCurrent}
                        className={`px-3 sm:px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                            isActive
                                ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                        }`}
                    >
                        {section.label}
                    </Link>
                );
            })}
        </nav>
    );
}
