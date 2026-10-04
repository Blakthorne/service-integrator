"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useReducer,
} from "react";
import type {
    CatalogMatch,
    LinkSuggestion,
    Plan,
    PlanItemWithSong,
    ScheduleSelection,
    ServiceType,
} from "@/lib/domain";
// Type-only, so nothing server-only reaches the client bundle.
import type { PlanDetail } from "@/lib/queries/plans";
import {
    mergeScheduleSelections,
    scheduleSelectionsReducer,
    type ChooseOption,
    type SetCustomText,
} from "@/lib/scheduleSelections";

/** What `usePlan()` gives the plan's pages. */
export interface PlanContextValue {
    plan: Plan;
    serviceType: ServiceType;
    /** The plan's items sorted by sequence, each joined to its song. */
    items: PlanItemWithSong[];
    /**
     * The catalog song each song item's Planning Center song is linked to,
     * by Planning Center song id.
     */
    catalog: Record<string, CatalogMatch>;
    /**
     * The best few catalog songs for each song item's Planning Center song
     * that is not linked and not set aside, by Planning Center song id.
     */
    suggestions: Record<string, LinkSuggestion[]>;
    /**
     * Why the catalog could not be read, or null. `catalog` is then empty,
     * and the plan's pages work without it.
     */
    catalogError: string | null;
    /**
     * `items` with the Schedule tab's selections merged in: a song with
     * numbers starts on Numbers, every other item on Leave blank (see
     * `mergeScheduleSelections`).
     */
    scheduleItems: (PlanItemWithSong & ScheduleSelection)[];
    /** Choose a song's option: Numbers, Leave blank or Custom. Stable across renders. */
    chooseOption: ChooseOption;
    /** Save a song's custom text. Stable across renders. */
    setCustomText: SetCustomText;
}

const PlanContext = createContext<PlanContextValue | null>(null);

interface PlanProviderProps {
    /** What the `[planId]` layout loaded with `getPlanDetail`. */
    detail: PlanDetail;
    children: React.ReactNode;
}

/**
 * Shares one plan with every page under the `[planId]` layout, so the tabs and
 * item pages never fetch it again, and keeps the Schedule tab's selections
 * while the user moves between those pages.
 *
 * The server data stays in props and is never copied into state:
 * `router.refresh()` re-runs the layout, and the fresh `detail` flows straight
 * through. The selections live in their own reducer, keyed by item ID, and
 * the merged `scheduleItems` are derived from both on render. The layout keys
 * the provider by plan, so another plan starts with no selections.
 */
export default function PlanProvider({ detail, children }: PlanProviderProps) {
    const { plan, serviceType, items, catalog, suggestions, catalogError } = detail;
    const [selections, dispatch] = useReducer(scheduleSelectionsReducer, {});

    // The defaults follow the catalog links, so a song linked from the tab
    // turns to its numbers when the layout re-renders with the new `catalog`.
    const scheduleItems = useMemo(
        () => mergeScheduleSelections(items, selections, catalog),
        [items, selections, catalog]
    );

    const chooseOption = useCallback<ChooseOption>(
        (itemId, option) => dispatch({ type: "chooseOption", itemId, option }),
        []
    );

    const setCustomText = useCallback<SetCustomText>(
        (itemId, text) => dispatch({ type: "setCustomText", itemId, text }),
        []
    );

    const value = useMemo<PlanContextValue>(
        () => ({
            plan,
            serviceType,
            items,
            catalog,
            suggestions,
            catalogError,
            scheduleItems,
            chooseOption,
            setCustomText,
        }),
        [
            plan,
            serviceType,
            items,
            catalog,
            suggestions,
            catalogError,
            scheduleItems,
            chooseOption,
            setCustomText,
        ]
    );

    return <PlanContext value={value}>{children}</PlanContext>;
}

/**
 * The plan of the page being shown, from the nearest `PlanProvider` (the
 * `[planId]` layout renders it). Throws when called outside one.
 */
export function usePlan(): PlanContextValue {
    const value = useContext(PlanContext);
    if (value === null) {
        throw new Error(
            "usePlan() was called outside a <PlanProvider>. Only components " +
                "under app/(app)/plans/[serviceTypeId]/[planId]/ can use it."
        );
    }
    return value;
}
