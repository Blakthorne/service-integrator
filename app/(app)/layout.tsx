import Navigation from "@/app/components/Navigation";

export default function AppLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <Navigation />
            <main className="max-w-7xl mx-auto py-6 px-2 sm:px-6 lg:px-8">
                {children}
            </main>
        </div>
    );
}
