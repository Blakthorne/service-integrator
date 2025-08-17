import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function SignIn() {
    const session = await auth();

    // Redirect to home if already signed in
    if (session?.user) {
        redirect("/");
    }

    return (
        <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-900 mx-2">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                        Welcome to Service Integrator
                    </h1>
                    <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
                        Access Planning Center service plans and song
                        information
                    </p>
                </div>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white dark:bg-gray-800 py-8 px-4 shadow rounded-lg sm:px-10">
                    <div className="space-y-6">
                        <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-6">
                                Sign in with an authorized Google account to
                                continue
                            </p>
                            <form
                                className="space-y-3"
                                action={async () => {
                                    "use server";
                                    await signIn("google", {
                                        redirectTo: "/",
                                    });
                                }}
                            >
                                <button
                                    type="submit"
                                    className="w-full flex justify-center items-center gap-3 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                                >
                                    <div className="w-6 h-6 relative flex items-center justify-center">
                                        {/* Use inline SVG instead of Image component */}
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="w-full h-full"
                                        >
                                            <path
                                                d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                                                fill="#4285F4"
                                            />
                                            <path
                                                d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09c1.97 3.92 6.02 6.62 10.71 6.62z"
                                                fill="#34A853"
                                            />
                                            <path
                                                d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29v-3.09h-3.98c-.8 1.6-1.27 3.41-1.27 5.38 0 1.97.47 3.78 1.27 5.38l3.98-3.09z"
                                                fill="#FBBC05"
                                            />
                                            <path
                                                d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                                                fill="#EA4335"
                                            />
                                        </svg>
                                    </div>
                                    Continue with Google
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
