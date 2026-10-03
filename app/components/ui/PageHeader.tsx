import Breadcrumbs, { type BreadcrumbItem } from "./Breadcrumbs";

interface PageHeaderProps<T extends string> {
    /** The page's `<h1>`. Every page has exactly one. */
    title: string;
    /** One line under the title. Inline content only (text, links, `<LocalTime>`): it renders inside a `<p>`. */
    description?: React.ReactNode;
    breadcrumbs?: BreadcrumbItem<T>[];
    /** Buttons or links for the page, such as "View in Planning Center". Right of the title on desktop, stacked under it on phones. */
    actions?: React.ReactNode;
}

/**
 * The top of a page: optional breadcrumbs, then a centered title and
 * description, with any actions on the right.
 */
export default function PageHeader<T extends string = string>({
    title,
    description,
    breadcrumbs,
    actions,
}: PageHeaderProps<T>) {
    const heading = (
        <div className="text-center">
            <h1 className="text-3xl sm:text-4xl font-bold mb-2">{title}</h1>
            {description && (
                <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                    {description}
                </p>
            )}
        </div>
    );

    return (
        <header className="mb-8">
            {breadcrumbs && breadcrumbs.length > 0 && (
                <Breadcrumbs items={breadcrumbs} />
            )}
            {actions ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    {/* Balances the actions so the title stays centered. */}
                    <div aria-hidden="true" className="hidden sm:block sm:flex-1" />
                    <div className="min-w-0">{heading}</div>
                    <div className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center sm:justify-end">
                        {actions}
                    </div>
                </div>
            ) : (
                heading
            )}
        </header>
    );
}
