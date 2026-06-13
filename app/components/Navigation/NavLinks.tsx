"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
    { href: "/", label: "Plans" },
    { href: "/unused-hymns", label: "Unused Hymns" },
];

export default function NavLinks() {
    const pathname = usePathname();
    return (
        <div className="flex items-center space-x-1 sm:space-x-2 ml-4 sm:ml-8">
            {LINKS.map((link) => {
                const isActive =
                    link.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(link.href);
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            isActive
                                ? "bg-blue-500 text-white"
                                : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        }`}
                    >
                        {link.label}
                    </Link>
                );
            })}
        </div>
    );
}
