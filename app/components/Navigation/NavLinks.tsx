"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, navAriaCurrent, routes } from "@/lib/routes";

/**
 * Shorter labels for phones, where the bar must fit three links, the gear
 * and Sign Out into 320 px. The full label stays the link's accessible name
 * (it begins with the short one, so voice control finds it by what it
 * shows) and its tooltip. Unused Hymns leaves the bar in phase 2, and its
 * entry with it.
 */
const PHONE_LABELS: Partial<Record<string, string>> = {
    [routes.unusedHymns()]: "Unused",
};

export default function NavLinks() {
    const pathname = usePathname();
    return (
        <div className="flex items-center space-x-1 sm:space-x-2 md:ml-8">
            {NAV_ITEMS.map((item) => {
                const ariaCurrent = navAriaCurrent(item, pathname);
                const isActive = ariaCurrent !== undefined;
                const phoneLabel = PHONE_LABELS[item.href];
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={ariaCurrent}
                        aria-label={phoneLabel && item.label}
                        title={phoneLabel && item.label}
                        className={`px-2.5 sm:px-3 py-2.5 sm:py-2 text-sm font-medium whitespace-nowrap rounded-md transition-colors ${
                            isActive
                                ? "bg-blue-600 text-white"
                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                    >
                        {phoneLabel ? (
                            <>
                                <span className="sm:hidden">{phoneLabel}</span>
                                <span className="hidden sm:inline">{item.label}</span>
                            </>
                        ) : (
                            item.label
                        )}
                    </Link>
                );
            })}
        </div>
    );
}
