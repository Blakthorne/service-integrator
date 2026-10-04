import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import { routes } from "@/lib/routes";

/**
 * Shown when the song page calls notFound(): an ID that is not a catalog ID,
 * or one no song has. It renders inside the catalog layout, so the section
 * navigation stays on screen.
 */
export default function CatalogSongNotFound() {
    return (
        <EmptyState
            title="Song not found"
            description="The catalog has no song at this address."
            action={
                <Link
                    href={routes.catalog()}
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                    Back to Songs
                </Link>
            }
        />
    );
}
