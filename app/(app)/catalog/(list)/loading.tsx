import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server renders the songs list. It sits in the `(list)`
 * route group so that it covers only the list: the song, tune, book and
 * import pages beside it read little, and a link to one keeps the previous
 * page on screen until it is ready.
 */
export default function CatalogLoading() {
    return <LoadingState label="Loading songs…" />;
}
