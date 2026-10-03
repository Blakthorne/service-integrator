import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
        dangerouslyAllowSVG: true,
        contentDispositionType: 'attachment',
        contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    },
    output: 'standalone', // Enable standalone output for Docker
    typedRoutes: true, // Type-check <Link href> and router calls against the app's routes
};

export default nextConfig;
