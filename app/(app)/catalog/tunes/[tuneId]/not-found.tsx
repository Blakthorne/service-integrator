import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import { routes } from "@/lib/routes";

/**
 * Shown when the tune page calls notFound(): an ID that is not a catalog ID,
 * or one no tune has. It renders inside the catalog layout, so the section
 * navigation stays on screen.
 */
export default function CatalogTuneNotFound() {
    return (
        <EmptyState
            title="Tune not found"
            description="The catalog has no tune at this address."
            action={
                <Link
                    href={routes.catalogTunes()}
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                    Back to Tunes
                </Link>
            }
        />
    );
}
