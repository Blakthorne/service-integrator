"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_UTILITY_ITEMS, navAriaCurrent, type NavIcon } from "@/lib/routes";

/** A gear (the Heroicons outline cog). */
function GearIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
        </svg>
    );
}

const ICONS: Record<NavIcon, () => React.ReactElement> = {
    gear: GearIcon,
};

/**
 * The icon links beside Sign Out (`NAV_UTILITY_ITEMS`). Each is named by its
 * `aria-label`, and gets `aria-current` like the section links.
 */
export default function NavUtilityLinks() {
    const pathname = usePathname();
    return (
        <>
            {NAV_UTILITY_ITEMS.map((item) => {
                const ariaCurrent = navAriaCurrent(item, pathname);
                const Icon = ICONS[item.icon];
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-label={item.label}
                        title={item.label}
                        aria-current={ariaCurrent}
                        className={`inline-flex items-center justify-center size-10 sm:size-9 rounded-md transition-colors ${
                            ariaCurrent !== undefined
                                ? "bg-blue-500 text-white"
                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                    >
                        <Icon />
                    </Link>
                );
            })}
        </>
    );
}
