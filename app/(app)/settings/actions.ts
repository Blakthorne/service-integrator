"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { FORM_FAILURE_MESSAGE } from "@/lib/forms";
import { syncPcoSongsNow } from "@/lib/queries/reconcile";
import { routes } from "@/lib/routes";

/** What "Sync now" says when it is done: how the run went, in a sentence. */
export interface SyncNowResult {
    ok: boolean;
    message: string;
}

/**
 * "Sync now", on Settings and Reconcile: run the Planning Center song sync
 * (`syncPcoSongsNow`, which joins a run already in progress rather than
 * start another) and say how it went. Then every page that shows the sync
 * or what it changes is revalidated: Settings, the catalog's pages (the
 * mirror and the auto-links it made) and the plans' (their numbers come
 * from the links), whether it succeeded or not, since its run is recorded
 * either way.
 *
 * A sync can take a while (it is paced), so the button calls this directly
 * and keeps its pending state in `useState`, not in a transition held open
 * across the action, which would stall every navigation until it returned
 * (convention 15). It checks the session first and throws without one.
 */
export async function syncPcoSongsAction(): Promise<SyncNowResult> {
    const session = await auth();
    if (!session) {
        throw new Error("Not signed in");
    }
    let run: Awaited<ReturnType<typeof syncPcoSongsNow>>;
    try {
        run = await syncPcoSongsNow();
    } catch (error) {
        console.error("Failed to sync the Planning Center songs:", error);
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    revalidatePath(routes.settings());
    revalidatePath(routes.catalog(), "layout");
    revalidatePath(routes.plans(), "layout");
    if (run === null) {
        // runJob logged why: the run could not even be recorded.
        return { ok: false, message: FORM_FAILURE_MESSAGE };
    }
    return run.ok
        ? { ok: true, message: run.message ?? "Synced." }
        : { ok: false, message: `The sync failed: ${run.message ?? "no reason was recorded"}.` };
}
