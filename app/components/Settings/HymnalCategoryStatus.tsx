import type { HymnNoteCategories } from "@/lib/queries/hymnNotes";
import {
    CATEGORIES_UNAVAILABLE_TEXT,
    NO_SERVICE_TYPES_TEXT,
    categoryLookupIntro,
    describeCategoryLookup,
    missingCategoryHelp,
    type CategoryTone,
} from "@/lib/settingsText";
import { FormNotice } from "../Catalog/SongForm/Fields";

/** The colours of each state's dot and words: the words carry the state, the colour only backs them up. */
const TONE_CLASSES: Record<CategoryTone, { dot: string; text: string }> = {
    ok: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
    warning: { dot: "bg-amber-500", text: "text-amber-800 dark:text-amber-300" },
    error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
};

interface HymnalCategoryStatusProps {
    /** The category in each service type (`getHymnNoteCategories`, which never rejects). */
    categories: Promise<HymnNoteCategories>;
}

/**
 * Whether each service type has the item note category the hymnal notes go
 * in (the Hymnal notes card, below its form). A service type without it is
 * marked Missing, in words and not in colour alone, with the sentence that
 * names it and, once, how to create the category in Planning Center's web
 * app, which this app cannot do. When Planning Center cannot be reached it
 * says so, and never fails the page. It is an async server component under
 * a Suspense boundary, so the card's form is on screen while Planning Center
 * is asked.
 */
export default async function HymnalCategoryStatus({ categories }: HymnalCategoryStatusProps) {
    const read = await categories;
    if (!read.ok) {
        return (
            <FormNotice tone="warning">
                <p>{CATEGORIES_UNAVAILABLE_TEXT}</p>
                <p className="break-words">The reason: {read.error}</p>
            </FormNotice>
        );
    }
    if (read.serviceTypes.length === 0) {
        return <p className="text-sm text-gray-600 dark:text-gray-300">{NO_SERVICE_TYPES_TEXT}</p>;
    }
    const anyMissing = read.serviceTypes.some(({ category }) => category.status === "missing");

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
                {categoryLookupIntro(read.categoryName)}
            </p>
            <ul role="list" className="divide-y divide-gray-200 dark:divide-gray-700">
                {read.serviceTypes.map(({ serviceType, category }) => {
                    const state = describeCategoryLookup(category);
                    const { dot, text } = TONE_CLASSES[state.tone];
                    return (
                        <li key={serviceType.id} className="py-3 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                <span className="font-medium text-gray-900 dark:text-gray-100">
                                    {serviceType.name}
                                </span>
                                <span
                                    className={`inline-flex items-center gap-2 text-sm font-medium ${text}`}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`size-2.5 shrink-0 rounded-full ${dot}`}
                                    />
                                    {state.status}
                                </span>
                            </div>
                            {state.detail && (
                                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 break-words">
                                    {state.detail}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>
            {anyMissing && (
                <FormNotice tone="warning">
                    <p>{missingCategoryHelp(read.categoryName)}</p>
                </FormNotice>
            )}
        </div>
    );
}
