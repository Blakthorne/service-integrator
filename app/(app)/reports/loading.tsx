import LoadingState from "@/app/components/ui/LoadingState";

/** Shown while the server reads the history and builds the reports. */
export default function ReportsLoading() {
    return <LoadingState label="Loading reports…" />;
}
