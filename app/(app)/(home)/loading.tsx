import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server loads the dashboard from Planning Center. It sits
 * in the `(home)` route group so that it covers the dashboard alone: in
 * `app/(app)/` it would wrap every page.
 */
export default function DashboardLoading() {
    return (
        <div className="font-sans">
            <LoadingState label="Loading the dashboard…" />
        </div>
    );
}
