import Link from "next/link";

export default async function AuthError({
    searchParams,
}: {
    searchParams: Promise<{ error?: string | string[] }>;
}) {
    const error: { error?: string | string[] } = await searchParams;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8 mx-2">
            <div className="max-w-md w-full space-y-8">
                <div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                        Access Denied
                    </h2>
                    <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
                        {error.error === "AccessDenied"
                            ? "You are not authorized to access this application. Please contact the administrator if you believe this is a mistake."
                            : "An error occurred during authentication. Please try again."}
                    </p>
                </div>
                <div className="mt-8 text-center">
                    <Link
                        href="/"
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                        Return to Home
                    </Link>
                </div>
            </div>
        </div>
    );
}
