"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/routes";

export default function NavLinks() {
    const pathname = usePathname();
    return (
        <div className="flex items-center space-x-1 sm:space-x-2 ml-4 sm:ml-8">
            {NAV_ITEMS.map((item) => {
                const isActive = item.isActive(pathname);
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
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
