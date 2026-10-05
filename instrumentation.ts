/**
 * Next calls `register()` once as each server runtime starts: in the Node.js
 * server (`next start`, `next dev`) and in the Edge runtime that runs the
 * middleware.
 *
 * Only the Node.js server boots the app (`lib/boot.ts`: open the database,
 * start the background jobs), and never during `next build`, which CI runs
 * without a database. Keep the `NEXT_RUNTIME` comparison a literal check
 * around the import: Next replaces it at compile time, which drops the import,
 * and node:sqlite with it, from the Edge bundle.
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        if (process.env.NEXT_PHASE === "phase-production-build") {
            return;
        }
        try {
            const { boot } = await import("./lib/boot");
            boot();
        } catch (error) {
            // Never let start-up fail the server: plan pages work without it.
            console.error("Boot failed:", error);
        }
    }
}
