"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { urlWithSearchParams } from "@/lib/urlState";

/** How an update touches the browser history. */
export interface SetSearchParamsOptions {
    /**
     * "replace" rewrites the current entry. "push" adds one, so Back undoes the
     * change. Use "replace" for filters and sorting, "push" for pagination you
     * want Back to step through.
     */
    history: "replace" | "push";
}

/**
 * Shareable view state in the URL's query string (a filter, a sort order, a
 * page number), changed without a server round trip.
 *
 * Read values from the returned `searchParams`, which is `useSearchParams()`.
 * Do not read them from the server's `searchParams` prop: the prop is fixed
 * for the render that produced it and misses these updates. A parameter that
 * changes what the server fetches does not belong here; navigate with
 * `<Link>` or `router.push` so the server renders again.
 *
 * `setSearchParams` writes through `window.history.replaceState` or
 * `pushState` with a `null` state. Next.js patches both, keeps its own history
 * state and updates `useSearchParams()`, so there is no navigation. It starts
 * from the live URL (not the last render), so two calls in a row both apply,
 * and it keeps the pathname and hash. A call that would not change the query
 * string is ignored (a different spelling of the same parameters, such as
 * `a%20b` for `a+b`, does not count), so repeating an action does not stack
 * identical history entries.
 *
 * Call it only from event handlers, or from effects that react to later
 * changes. Next installs its history patch in an effect of its router, which
 * runs after the effects of the components below it, so a mount-time effect
 * may run too early and bypass the patch.
 *
 * `updates` maps a key to its new value, or to `null` to remove the key (see
 * `withSearchParams`).
 */
export function useUrlState() {
    const searchParams = useSearchParams();

    const setSearchParams = useCallback(
        (
            updates: Record<string, string | null>,
            options: SetSearchParamsOptions = { history: "replace" }
        ): void => {
            const url = urlWithSearchParams(window.location, updates);
            if (url === null) {
                return;
            }
            if (options.history === "push") {
                window.history.pushState(null, "", url);
            } else {
                window.history.replaceState(null, "", url);
            }
        },
        []
    );

    return { searchParams, setSearchParams };
}
