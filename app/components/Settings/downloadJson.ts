import { CATALOG_EXPORT_MIME_TYPE } from "@/lib/catalog/exportJson";

/**
 * How long the object URL lives after the click. The browser has the file by
 * then; the wait is for the browsers (Safari, older Firefox) that lose a
 * download whose URL was revoked at once.
 */
const REVOKE_AFTER_MS = 30 * 1000;

/**
 * Save JSON text as a file called `filename`, entirely in the browser: a Blob
 * behind an object URL that a temporary link downloads, with the URL revoked
 * afterwards. The text is saved exactly as it is: no byte order mark, so a
 * program that reads the file (git, `jq`) sees the document and nothing
 * else. Browser only: call it from an event handler, never while rendering.
 */
export function downloadJson(filename: string, json: string): void {
    const url = URL.createObjectURL(new Blob([json], { type: CATALOG_EXPORT_MIME_TYPE }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    // In the page while it is clicked: some browsers ignore a detached link.
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
