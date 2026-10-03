"use client";

import { useSyncExternalStore } from "react";

interface LocalTimeProps {
    /** An ISO 8601 timestamp, such as the `computedAt` of a cached result. */
    iso: string;
    /** `toLocaleString` options. Defaults to a medium date and a short time. */
    options?: Intl.DateTimeFormatOptions;
}

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
};

// Nothing to subscribe to: the text only differs between server and client.
const subscribe = () => () => {};

/**
 * A point in time (not a calendar date, see `lib/format.ts` for those),
 * rendered in the viewer's time zone.
 *
 * The server does not know the viewer's zone, so the server HTML and the
 * hydration pass are formatted in UTC and the viewer's zone replaces that
 * right after hydration. Client-side navigations render the viewer's zone
 * straight away. The text therefore differs between server and client on
 * purpose, so the element sets `suppressHydrationWarning` (it also covers small
 * ICU formatting differences between Node and the browser).
 *
 * A plain `<time suppressHydrationWarning>` that formats in the viewer's zone
 * on the first client render is not enough: React 19 keeps the server's text
 * when a suppressed mismatch happens, so the server's zone would stay on screen.
 * `useSyncExternalStore` makes React render the client value in a second pass.
 */
export default function LocalTime({ iso, options }: LocalTimeProps) {
    const format = options ?? DEFAULT_OPTIONS;
    const text = useSyncExternalStore(
        subscribe,
        () => new Date(iso).toLocaleString("en-US", format),
        () =>
            new Date(iso).toLocaleString("en-US", {
                timeZone: "UTC",
                ...format,
            })
    );

    return (
        <time dateTime={iso} suppressHydrationWarning>
            {text}
        </time>
    );
}
