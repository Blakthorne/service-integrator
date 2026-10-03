import Navigation from "@/app/components/Navigation";

// CI builds without PCO credentials, and every page here is per-request.
export const dynamic = "force-dynamic";

export default function AppLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            <Navigation />
            <main className="flex-1 w-full max-w-7xl mx-auto py-6 px-2 sm:px-6 lg:px-8">
                {children}
            </main>
            <footer className="w-full px-4 pt-4 text-center border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 mt-8">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                    © {new Date().getFullYear()} David Polar
                </span>
            </footer>
        </div>
    );
}
