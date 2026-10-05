"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, navAriaCurrent } from "@/lib/routes";
import { NAV_FOCUS_CLASS } from "./classes";

/**
 * The section links of the top bar (`NAV_ITEMS`). Below 360 px they are set
 * closer (6 px of padding at the sides and 2 px between them, instead of 10
 * and 4): the house, the three links, the gear and Sign Out come to 296 px
 * there, which leaves 8 px to spare at 320 px, where the usual spacing would
 * need 328 px of the 304 the bar has.
 */
export default function NavLinks() {
    const pathname = usePathname();
    return (
        <div className="flex items-center space-x-0.5 min-[360px]:space-x-1 sm:space-x-2 md:ml-8">
            {NAV_ITEMS.map((item) => {
                const ariaCurrent = navAriaCurrent(item, pathname);
                const isActive = ariaCurrent !== undefined;
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={ariaCurrent}
                        className={`px-1.5 min-[360px]:px-2.5 sm:px-3 py-2.5 sm:py-2 text-sm font-medium whitespace-nowrap rounded-md transition-colors ${NAV_FOCUS_CLASS} ${
                            isActive
                                ? "bg-blue-600 text-white"
                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </div>
    );
}
