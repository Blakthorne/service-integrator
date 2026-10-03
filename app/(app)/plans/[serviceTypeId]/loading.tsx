import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the `[planId]` layout loads the plan. It sits one level up
 * because a segment's own loading.tsx does not cover its own layout.
 */
export default function PlanLoading() {
    return (
        <div className="font-sans">
            <LoadingState label="Loading plan…" />
        </div>
    );
}
