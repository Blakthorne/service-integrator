/**
 * Whether a layout segment is a route group, such as "(list)": a folder that
 * scopes files but is not part of the URL. Next tells them apart the same way.
 */
export function isRouteGroup(segment: string): boolean {
    return segment.startsWith("(") && segment.endsWith(")");
}

/**
 * The segment that says which catalog section a page belongs to, from
 * `useSelectedLayoutSegments()` in the catalog layout: the first one that is
 * not a route group, or null at `/catalog` itself. For `catalogSectionFor`.
 *
 * `useSelectedLayoutSegment()` alone is not enough, because it returns route
 * groups: the songs list sits in `catalog/(list)/`, so that its
 * `loading.tsx` covers the list and not the pages beside it, and there the
 * hook returns "(list)" rather than null.
 */
export function catalogLayoutSegment(segments: readonly string[]): string | null {
    return segments.find((segment) => !isRouteGroup(segment)) ?? null;
}
