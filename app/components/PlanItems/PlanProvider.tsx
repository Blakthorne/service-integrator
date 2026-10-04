"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
} from "react";
import { saveScheduleSelection } from "@/app/(app)/plans/[serviceTypeId]/[planId]/actions";
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
    type ChooseOption,
    type SetCustomText,
} from "@/lib/scheduleSelections";
import {
    createPlanSelectionsRegistry,
    createPlanSelectionsStore,
    type PlanSelectionsStore,
    type SelectionSaveState,
} from "@/lib/scheduleSelectionsStore";

/** Save the choice of a song after its save failed. */
export type RetrySave = (itemId: string) => void;

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
     * Why the saved choices could not be read, or null. Every song then
     * starts on its default, and no choice is saved.
     */
    selectionsError: string | null;
    /**
     * `items` with the Schedule tab's selections merged in: a song with
     * numbers starts on Numbers, every other item on Leave blank, unless a
     * choice was made or saved for it (see `mergeScheduleSelections`).
     */
    scheduleItems: (PlanItemWithSong & ScheduleSelection)[];
    /**
     * How the saves of the songs whose choices changed stand, by item ID: a
     * song with no entry is saved (see `SelectionSaveState`).
     */
    saves: Readonly<Record<string, SelectionSaveState>>;
    /** Choose a song's option: Numbers, Leave blank or Custom, and save it. Stable across renders. */
    chooseOption: ChooseOption;
    /** Set a song's custom text, and save it while Custom is chosen. Stable across renders. */
    setCustomText: SetCustomText;
    /** Save a song's choice again after its save failed. Stable across renders. */
    retrySave: RetrySave;
}

const PlanContext = createContext<PlanContextValue | null>(null);

/**
 * The stores of the plans visited in this tab, by plan, each with the
 * `detail` it was last shown with (see `createPlanSelectionsRegistry`). It
 * is used in the browser only: on the server it would be shared by every
 * request.
 */
const registry = createPlanSelectionsRegistry<PlanDetail>();

/** The registry's key for a plan. */
function planKey({ serviceType, plan }: PlanDetail): string {
    return `${serviceType.id}/${plan.id}`;
}

/**
 * The choices' store for a provider that starts with `detail`: the one this
 * tab last showed with that very object, when Back brings the plan's pages
 * back as they were rendered; else a new one seeded with the saved choices,
 * which saves each change through `saveScheduleSelection`, unless the saved
 * choices could not be read.
 */
function storeFor(detail: PlanDetail): PlanSelectionsStore {
    const remembered =
        typeof window === "undefined" ? undefined : registry.find(planKey(detail), detail);
    if (remembered !== undefined) {
        return remembered;
    }
    const serviceTypeId = detail.serviceType.id;
    const planId = detail.plan.id;
    return createPlanSelectionsStore({
        selections: detail.selections,
        save:
            detail.selectionsError === null
                ? (itemId, { option, customText }) =>
                      saveScheduleSelection(serviceTypeId, planId, itemId, option, customText)
                : null,
    });
}

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
 * through. The selections are the exception. They start from the plan's
 * saved choices (`detail.selections`), once, and from then on the provider
 * owns them: each change applies at once and is saved
 * (`saveScheduleSelection`), and a fresh `detail` does not replace them. They
 * live in a store (`createPlanSelectionsStore`) read with
 * `useSyncExternalStore`, which outlives the provider: a save on its way
 * when the plan's pages go still lands, and Back, which shows the plan as it
 * was rendered, saved choices and all, finds the store again with the
 * changes made since. The merged `scheduleItems` are derived from the
 * selections and `detail` on render. The layout keys the provider by plan,
 * so another plan has its own.
 */
export default function PlanProvider({ detail, children }: PlanProviderProps) {
    const {
        plan,
        serviceType,
        items,
        catalog,
        suggestions,
        catalogError,
        selectionsError,
    } = detail;
    const [store] = useState(() => storeFor(detail));
    const { selections, saves } = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );

    // So that Back, which shows the plan with this very `detail`, finds the store.
    useEffect(() => {
        registry.remember(planKey(detail), detail, store);
    }, [detail, store]);

    // The defaults follow the catalog links, so a song linked from the tab
    // turns to its numbers when the layout re-renders with the new `catalog`.
    const scheduleItems = useMemo(
        () => mergeScheduleSelections(items, selections, catalog),
        [items, selections, catalog]
    );

    const chooseOption = useCallback<ChooseOption>(
        (itemId, option) => store.dispatch({ type: "chooseOption", itemId, option }),
        [store]
    );

    const setCustomText = useCallback<SetCustomText>(
        (itemId, text) => store.dispatch({ type: "setCustomText", itemId, text }),
        [store]
    );

    const retrySave = useCallback<RetrySave>((itemId) => store.retry(itemId), [store]);

    const value = useMemo<PlanContextValue>(
        () => ({
            plan,
            serviceType,
            items,
            catalog,
            suggestions,
            catalogError,
            selectionsError,
            scheduleItems,
            saves,
            chooseOption,
            setCustomText,
            retrySave,
        }),
        [
            plan,
            serviceType,
            items,
            catalog,
            suggestions,
            catalogError,
            selectionsError,
            scheduleItems,
            saves,
            chooseOption,
            setCustomText,
            retrySave,
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
