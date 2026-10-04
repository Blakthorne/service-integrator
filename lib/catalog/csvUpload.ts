/**
 * What the Import a book from CSV form says that needs no catalog: how a
 * file's text is told to be something other than UTF-8, which a spreadsheet
 * saves by default. Pure and safe on both sides.
 */

/** The character a decoder puts where the bytes were not valid UTF-8. */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

/**
 * What the form says when the file is not UTF-8. A spreadsheet's plain "CSV"
 * is often a Windows code page, in which a curly quote or an accent is a
 * byte that UTF-8 cannot read: reading it as UTF-8 puts a replacement
 * character in its place, and the title would be saved with it.
 */
export const NOT_UTF8_MESSAGE =
    'The file is not UTF-8 text, so some characters could not be read. In your spreadsheet, save it again as "CSV UTF-8", then choose that file.';

/** Why the text of an uploaded file cannot be previewed, or null when nothing is wrong with it. */
export function csvTextProblem(text: string): string | null {
    return text.includes(REPLACEMENT_CHARACTER) ? NOT_UTF8_MESSAGE : null;
}
