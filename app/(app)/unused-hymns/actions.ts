"use server";

import { auth } from "@/auth";
import { getUnusedHymns } from "@/lib/queries/unusedHymns";
import type { UnusedHymnsResult } from "@/lib/unusedHymns";

/**
 * Recompute the unused hymns from Planning Center, ignoring the cached result,
 * for the Refresh button.
 *
 * A server action is a public POST endpoint, so this checks the session
 * itself instead of relying on the middleware alone, and throws without one.
 * It also throws when Planning Center fails; the caller keeps what it shows.
 */
export async function refreshUnusedHymns(): Promise<UnusedHymnsResult> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    return getUnusedHymns({ refresh: true });
}
