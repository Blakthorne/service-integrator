import LoadingState from "@/app/components/ui/LoadingState";

/**
 * Shown while the server loads the books. It sits in the `(list)` route group
 * so that it covers only the list, not the book pages below it.
 */
export default function BooksLoading() {
    return (
        <div className="font-sans">
            <LoadingState label="Loading books…" />
        </div>
    );
}
