"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_UTILITY_ITEMS, navAriaCurrent } from "@/lib/routes";
import NavIcon from "./NavIcon";
import { navIconLinkClassName } from "./classes";

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
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-label={item.label}
                        title={item.label}
                        aria-current={ariaCurrent}
                        className={navIconLinkClassName(ariaCurrent !== undefined)}
                    >
                        <NavIcon icon={item.icon} />
                    </Link>
                );
            })}
        </>
    );
}
