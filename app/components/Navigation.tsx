import { signOut } from "@/auth";
import React from "react";
import NavHomeLink from "./Navigation/NavHomeLink";
import NavLinks from "./Navigation/NavLinks";
import NavUtilityLinks from "./Navigation/NavUtilityLinks";

export default function Navigation() {
    return (
        <nav
            aria-label="Main"
            className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700"
        >
            {/* At 320 px the house, the two section links, the gear and
                Sign Out need the narrow gutter phones use for <main> too. */}
            <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                    <div className="flex items-center">
                        {/* The dashboard: the app's name from md, a house
                            below it, where the name would crowd the links
                            into the gear and Sign Out. */}
                        <NavHomeLink />
                        <NavLinks />
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                        <NavUtilityLinks />
                        <form
                            action={async () => {
                                "use server";
                                await signOut({ redirectTo: "/auth/signin" });
                            }}
                        >
                            <button
                                type="submit"
                                aria-label="Sign out"
                                className="inline-flex items-center justify-center size-10 sm:size-auto sm:px-4 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer whitespace-pre"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    aria-hidden="true"
                                    className="h-4 w-4 sm:mr-2"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                                    />
                                </svg>
                                <span className="hidden sm:inline">Sign Out</span>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </nav>
    );
}
