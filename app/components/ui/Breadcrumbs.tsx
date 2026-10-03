import Link from "next/link";
import type { Route } from "next";

export interface BreadcrumbItem<T extends string = string> {
    label: string;
    /** Where the crumb links to. Leave it out for the current page, which is never a link. */
    href?: Route<T>;
}

interface BreadcrumbsProps<T extends string> {
    /** From the top of the hierarchy down to the current page, which comes last. */
    items: BreadcrumbItem<T>[];
}

/**
 * "Plans › Sunday Morning › Song": links to each ancestor, then the current
 * page (`aria-current="page"`). On phones it collapses to a single
 * "← Plans" link to the nearest ancestor that has an `href`.
 *
 * The `href`s are checked against the real routes: pass `routes.*` builders.
 */
export default function Breadcrumbs<T extends string>({
    items,
}: BreadcrumbsProps<T>) {
    if (items.length === 0) {
        return null;
    }

    let parentIndex = -1;
    for (let i = items.length - 2; i >= 0; i--) {
        if (items[i].href) {
            parentIndex = i;
            break;
        }
    }

    return (
        <nav
            aria-label="Breadcrumb"
            className={`mb-4${parentIndex === -1 ? " hidden sm:block" : ""}`}
        >
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                {items.map((item, index) => {
                    const isLast = index === items.length - 1;
                    const isParent = index === parentIndex;
                    return (
                        <li
                            key={index}
                            className={`${isParent ? "flex" : "hidden sm:flex"} items-center gap-2`}
                        >
                            {isLast ? (
                                <span
                                    aria-current="page"
                                    className="font-medium text-gray-900 dark:text-gray-100"
                                >
                                    {item.label}
                                </span>
                            ) : item.href ? (
                                <Link
                                    href={item.href}
                                    className="hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
                                >
                                    {isParent && (
                                        <span
                                            aria-hidden="true"
                                            className="sm:hidden"
                                        >
                                            ←{" "}
                                        </span>
                                    )}
                                    {item.label}
                                </Link>
                            ) : (
                                <span>{item.label}</span>
                            )}
                            {!isLast && (
                                <span
                                    aria-hidden="true"
                                    className="hidden sm:inline"
                                >
                                    ›
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
