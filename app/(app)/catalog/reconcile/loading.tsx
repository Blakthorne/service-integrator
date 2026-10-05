import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server renders Reconcile. The page reads only the local
 * database, but it builds every unlinked song's suggestions, which takes a
 * moment with a large library.
 */
export default function ReconcileLoading() {
    return <LoadingState label="Loading Reconcile…" />;
}
