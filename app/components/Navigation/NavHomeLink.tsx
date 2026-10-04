"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_HOME_ITEM, navAriaCurrent } from "@/lib/routes";
import NavIcon from "./NavIcon";
import { NAV_FOCUS_CLASS, navIconLinkClassName } from "./classes";

/**
 * The link to the dashboard (`NAV_HOME_ITEM`), first in the top bar. From
 * `md` it is the app's name. Below `md` the name would crowd the section
 * links into the gear and Sign Out, so a house icon takes its place, named
 * by its `aria-label` and filled on the dashboard like the other links.
 * Only one of the two is displayed at any width, so the other is out of the
 * tab order and the accessibility tree; both are `aria-current="page"` on
 * the dashboard.
 */
export default function NavHomeLink() {
    const pathname = usePathname();
    const ariaCurrent = navAriaCurrent(NAV_HOME_ITEM, pathname);
    return (
        <>
            <Link
                href={NAV_HOME_ITEM.href}
                aria-label={NAV_HOME_ITEM.label}
                title={NAV_HOME_ITEM.label}
                aria-current={ariaCurrent}
                className={`md:hidden flex-shrink-0 mr-1 sm:mr-2 ${navIconLinkClassName(
                    ariaCurrent !== undefined
                )}`}
            >
                <NavIcon icon={NAV_HOME_ITEM.icon} />
            </Link>
            <Link
                href={NAV_HOME_ITEM.href}
                aria-current={ariaCurrent}
                className={`hidden md:flex flex-shrink-0 items-center rounded-md text-lg font-semibold text-gray-900 dark:text-gray-100 ${NAV_FOCUS_CLASS}`}
            >
                Service Integrator
            </Link>
        </>
    );
}
