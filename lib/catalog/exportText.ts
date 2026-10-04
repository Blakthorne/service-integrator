/**
 * The words of Settings' Data card, where the catalog is exported as a JSON
 * file: what the export is for, and what the button says as it goes. Pure and
 * safe on both sides.
 */

/** The export button's text. */
export const EXPORT_BUTTON_LABEL = "Export catalog (JSON)";

/** What the button says while the catalog is being read. */
export const EXPORT_PENDING_LABEL = "Exporting…";

/** What the card says an export holds, and why it is worth keeping in git. */
export const EXPORT_DESCRIPTION =
    "Downloads the song catalog as a JSON file: its books, its hymns and tunes with their other names, its songs with their Planning Center links, its entries and its marks. The same catalog always gives the same text, with its rows and keys in a fixed order, so two exports diff cleanly in git: keep them in a repository as a backup you can read, and see exactly what changed between two days.";

/** What the card says about how the export relates to the database's own backups. */
export const EXPORT_BACKUP_NOTE =
    "The database is backed up every day on its own (see Database). The export is the readable copy: it holds the catalog only, not the settings, the Planning Center song copy or the schedule choices.";

/** What the status says while the catalog is being read. */
export const EXPORT_PENDING_STATUS = "Reading the catalog…";

/** What the card says when the catalog could not be read. */
export const EXPORT_FAILED_MESSAGE =
    "The catalog could not be exported, so nothing was downloaded. Try again; the server log has the details.";

/** What the card says when the action could not even be called (no session, a lost connection). */
export const EXPORT_COULD_NOT_START_MESSAGE =
    "The export could not be started. Reload the page and try again.";

/** What the card says once the file has been handed to the browser to save. */
export function describeExported(fileName: string): string {
    return `Downloaded ${fileName}.`;
}
