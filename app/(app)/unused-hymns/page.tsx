import { permanentRedirect } from "next/navigation";
import { routes } from "@/lib/routes";

/**
 * Unused Hymns is a filter of the songs list now: the songs never scheduled,
 * `?used=never`. Links and bookmarks to the old page go there with a
 * permanent (308) redirect.
 */
export default function UnusedHymnsPage() {
    permanentRedirect(routes.catalogFiltered({ used: "never" }));
}
