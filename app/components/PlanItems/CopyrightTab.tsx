"use client";

import { useMemo } from "react";
import type { Song } from "@/lib/domain";
import CopyrightInformation from "./CopyrightInformation";
import { usePlan } from "./PlanProvider";

/**
 * The Copyright Information tab's connector: feeds the plan's items from
 * `usePlan()` to CopyrightInformation.
 */
export default function CopyrightTab() {
    const { items } = usePlan();

    // CopyrightInformation still looks each item's song up by title in the
    // songs that came with the items, as it did with /api/plan-items.
    const includedSongs = useMemo(() => {
        const songsById = new Map<string, Song>();
        for (const item of items) {
            if (item.song !== null && !songsById.has(item.song.id)) {
                songsById.set(item.song.id, item.song);
            }
        }
        return [...songsById.values()];
    }, [items]);

    return <CopyrightInformation items={items} includedSongs={includedSongs} />;
}
