import Link from "next/link";
import { routes } from "@/lib/routes";

// Renders for any URL that matches no route. It sits outside the (app) layout,
// so there is no navigation bar: this page brings its own full-screen frame.
export default function NotFound() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-2 sm:px-6">
            <div className="max-w-md w-full space-y-8">
                <div>
                    <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                        Page not found
                    </h1>
                    <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
                        The page you are looking for does not exist or may have
                        moved.
                    </p>
                </div>
                <div className="mt-8 text-center">
                    <Link
                        href={routes.plans()}
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Back to Plans
                    </Link>
                </div>
            </div>
        </main>
    );
}
