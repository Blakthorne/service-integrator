/**
 * A quiet banner at the top of a plan's tab: what the tab cannot do, or
 * does differently, and why (the catalog, the saved choices or the settings
 * could not be read).
 */
export default function PlanNotice({ children }: { children: React.ReactNode }) {
    return (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {children}
        </p>
    );
}
