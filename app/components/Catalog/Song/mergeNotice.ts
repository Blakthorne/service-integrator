/**
 * What a merge says on the page it lands on. A merge's action redirects to
 * the page of what the merge made (the song the page's song is now, or the
 * target tune), so the form that confirmed it is gone by the time the merge
 * is done, and the page it lands on cannot know what was merged. The form
 * leaves its words here first, keyed by that page, and the card there takes
 * them once, says them in its status region and moves focus to them.
 *
 * It lives in the browser's copy of this module: a merge's redirect is a
 * client-side navigation, so the module, and what was left in it, are still
 * there when the page lands. A full reload starts it empty, which loses
 * nothing that matters: the page itself shows the merged hymn or tune.
 */

const notices = new Map<string, string>();

/** The key a song's page or a tune's page takes its notice by. */
export function mergeNoticeKey(kind: "song" | "tune", id: number): string {
    return `${kind}:${id}`;
}

/** Leave `message` for the page `key` names, replacing any left there before. */
export function leaveMergeNotice(key: string, message: string): void {
    notices.set(key, message);
}

/** Take the notice left for the page `key` names: it is said once, so it is gone after. */
export function takeMergeNotice(key: string): string | null {
    const message = notices.get(key) ?? null;
    notices.delete(key);
    return message;
}
