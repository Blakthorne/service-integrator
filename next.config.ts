import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
        dangerouslyAllowSVG: true,
        contentDispositionType: 'attachment',
        contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    },
    output: 'standalone', // Enable standalone output for Docker
    typedRoutes: true, // Type-check <Link href> and router calls against the app's routes
    experimental: {
        // A book CSV may be up to 1 MB (lib/catalog/validation.ts); Next's
        // default limit of 1 MB for a server action's whole request would
        // refuse one that size before the action could explain why.
        serverActions: { bodySizeLimit: "2mb" },
    },
};

export default nextConfig;
