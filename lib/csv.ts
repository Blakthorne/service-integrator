/**
 * CSV text as RFC 4180 writes it, for a file a spreadsheet opens: fields
 * separated by commas, records by CRLF. Pure and safe on both sides.
 */

/** What ends every record: RFC 4180's line break. */
const RECORD_END = "\r\n";

/**
 * A field that starts with one of these is read by a spreadsheet as a
 * formula (or, with a tab or carriage return in front, may be): = + - @, tab
 * and carriage return (OWASP's list for CSV injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A field with one of these must be in double quotes: a comma, a double quote or a line break. */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * A field with a `'` in front when it would start a formula (see
 * `FORMULA_START`), so a spreadsheet opens it as the text it is. The
 * apostrophe stays visible in the cell: the price of a file that cannot run
 * a formula nobody wrote.
 */
function neutralize(value: string): string {
    return FORMULA_START.test(value) ? `'${value}` : value;
}

/**
 * One field as it is written. A field that would start a spreadsheet formula
 * (it begins with =, +, -, @, a tab or a carriage return) gets a `'` in
 * front, so a title can never run as one when the file is opened. A field
 * with a comma, a double quote, a carriage return or a line feed is then
 * wrapped in double quotes, with each double quote inside it doubled.
 */
export function csvField(value: string): string {
    const text = neutralize(value);
    return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Records, each a list of fields, as CSV text: every record ends with CRLF,
 * the last one too, and no records make an empty string. The first record
 * is conventionally the header.
 */
export function toCsv(records: readonly (readonly string[])[]): string {
    return records
        .map((record) => record.map(csvField).join(",") + RECORD_END)
        .join("");
}

/** The media type of a CSV download. */
export const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/**
 * The byte order mark. Put in front of a CSV download it tells Excel that
 * the file is UTF-8; without it, Excel reads a title with a curly quote or an
 * accent as mojibake. (`toCsv` does not write it: a program reading the text
 * does not want it.)
 */
export const UTF8_BOM = String.fromCharCode(0xfeff);
