import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import { routes } from "@/lib/routes";

/**
 * Shown when the book page calls notFound(): a code that is not a book code,
 * or one no book has. It renders inside the catalog layout, so the section
 * navigation stays on screen.
 */
export default function BookNotFound() {
    return (
        <div className="font-sans">
            <EmptyState
                title="Book not found"
                description="The catalog has no book at this address."
                action={
                    <Link
                        href={routes.catalogBooks()}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Back to Books
                    </Link>
                }
            />
        </div>
    );
}
