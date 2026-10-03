import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server loads the plans from Planning Center. It sits in the
 * `(list)` route group so that it covers only the list, not the plan routes.
 */
export default function PlansLoading() {
    return (
        <div className="font-sans">
            <LoadingState label="Loading plans…" />
        </div>
    );
}
