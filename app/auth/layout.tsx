export default function AuthLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-2 sm:px-6">
            {children}
        </div>
    );
}
