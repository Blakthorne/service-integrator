import Link from "next/link";
import EmptyState from "@/app/components/ui/EmptyState";
import { routes } from "@/lib/routes";

/**
 * Shown when the run page calls notFound(): an id that is not a catalog id,
 * or a run the catalog does not have. It renders inside the catalog layout,
 * so the section navigation stays on screen.
 */
export default function ImportRunNotFound() {
    return (
        <div className="font-sans">
            <EmptyState
                title="Import run not found"
                description="The catalog has no import run at this address."
                action={
                    <Link
                        href={routes.catalogImport()}
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Back to Import
                    </Link>
                }
            />
        </div>
    );
}
