import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server renders the tunes list. It sits in the `(list)`
 * route group so that it covers only the list, not the tune pages.
 */
export default function CatalogTunesLoading() {
    return <LoadingState label="Loading tunes…" />;
}
