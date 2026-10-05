import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server loads the import runs. It sits in the `(list)` route
 * group so that it covers only the list, not the run pages below it.
 */
export default function ImportLoading() {
    return (
        <div className="font-sans">
            <LoadingState label="Loading import runs…" />
        </div>
    );
}
