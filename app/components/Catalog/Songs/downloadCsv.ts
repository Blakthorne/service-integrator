import { CSV_MIME_TYPE, UTF8_BOM } from "@/lib/csv";

/**
 * How long the object URL lives after the click. The browser has the file by
 * then; the wait is for the browsers (Safari, older Firefox) that lose a
 * download whose URL was revoked at once.
 */
const REVOKE_AFTER_MS = 30 * 1000;

/**
 * Save CSV text as a file called `filename`, entirely in the browser: a Blob
 * behind an object URL that a temporary link downloads, with the URL revoked
 * afterwards. The file starts with the byte order mark, so Excel reads it as
 * UTF-8. Browser only: call it from an event handler, never while rendering.
 */
export function downloadCsv(filename: string, csv: string): void {
    const url = URL.createObjectURL(
        new Blob([UTF8_BOM, csv], { type: CSV_MIME_TYPE })
    );
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
