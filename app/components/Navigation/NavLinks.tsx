"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, navAriaCurrent } from "@/lib/routes";

export default function NavLinks() {
    const pathname = usePathname();
    return (
        <div className="flex items-center space-x-1 sm:space-x-2 sm:ml-8">
            {NAV_ITEMS.map((item) => {
                const ariaCurrent = navAriaCurrent(item, pathname);
                const isActive = ariaCurrent !== undefined;
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={ariaCurrent}
                        className={`px-3 py-2.5 sm:py-2 text-sm font-medium whitespace-nowrap rounded-md transition-colors ${
                            isActive
                                ? "bg-blue-500 text-white"
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
