/**
 * What the Schedule tab shows around its song cards. Pure and safe on both
 * sides: the tab's components take these decisions from here, so they are
 * tested without a browser.
 */

/**
 * What the Schedule tab says when the catalog cannot be read (see
 * `PlanDetail.catalogError`): "The catalog is unavailable: <why>. Numbers
 * can't be shown." A reason that already ends a sentence gets no second
 * full stop, and an empty one is left out.
 */
export function catalogUnavailableMessage(error: string): string {
    const reason = error.trim();
    if (reason === "") {
        return "The catalog is unavailable. Numbers can't be shown.";
    }
    const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    return `The catalog is unavailable: ${sentence} Numbers can't be shown.`;
}
