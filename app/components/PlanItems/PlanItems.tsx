"use client";

import { useEffect, useRef, useState } from "react";
import { canReorderItems } from "@/lib/planItemOrderText";
import { buttonClasses } from "../ui/buttonClasses";
import { usePlan } from "./PlanProvider";
import PlanItemsTable from "./PlanItemsTable";
import ReorderItems from "./ReorderItems";

/**
 * The plan page's items: the table of them, with "Reorder items" above it,
 * which swaps the table for the mode that puts them in another order in
 * Planning Center (`ReorderItems`). The button is offered only for a plan
 * with items to put in order (`canReorderItems`: two or more, up to the
 * most a reorder takes).
 *
 * Focus follows the swap. `ReorderItems` takes it when the mode starts, and
 * when the mode ends, the table having come back, it goes to the button that
 * started it, which would otherwise leave a keyboard user on the page's body.
 */
export default function PlanItems() {
    const { items } = usePlan();
    const [reordering, setReordering] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    /** True from the end of the mode until focus is back on the button that started it. */
    const returnFocus = useRef(false);

    useEffect(() => {
        if (!reordering && returnFocus.current) {
            returnFocus.current = false;
            buttonRef.current?.focus();
        }
    }, [reordering]);

    function endReordering() {
        returnFocus.current = true;
        setReordering(false);
    }

    if (reordering) {
        return <ReorderItems onDone={endReordering} />;
    }
    return (
        <>
            {canReorderItems(items.map(({ id }) => id)) && (
                <div className="mb-3 flex justify-end">
                    <button
                        ref={buttonRef}
                        type="button"
                        onClick={() => setReordering(true)}
                        className={buttonClasses("secondary")}
                    >
                        Reorder items
                    </button>
                </div>
            )}
            <PlanItemsTable />
        </>
    );
}
