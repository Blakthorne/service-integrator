/**
 * CSV text as RFC 4180 writes and reads it: fields separated by commas,
 * records by line breaks, a field with a comma, a double quote or a line
 * break in double quotes. `toCsv` writes a file a spreadsheet opens, and
 * `parseCsv` reads one a spreadsheet saved. Pure and safe on both sides.
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

/** One record of a CSV file, with the line it starts on (the first line is 1). */
export interface CsvRecord {
    line: number;
    fields: string[];
}

/** What `parseCsv` made of a text: its records, or where it stopped making sense. */
export type CsvParse =
    | { ok: true; records: CsvRecord[] }
    | {
          ok: false;
          /** The line the problem is on. */
          line: number;
          message: string;
      };

/**
 * Read CSV text as RFC 4180 has it, and as spreadsheets save it:
 *
 * - records end with CRLF, LF or a lone CR, and a line break at the very
 *   end of the text ends the last record rather than starting another, so
 *   the text "a,b\r\n" is one record; an empty line is a record of one
 *   empty field;
 * - fields are separated by commas, and kept exactly as written: spaces
 *   are not trimmed;
 * - a field that starts with a double quote runs to the next lone double
 *   quote, taking commas and line breaks into it, with each doubled quote
 *   ("") read as one;
 * - a byte order mark at the start (Excel writes one) is skipped.
 *
 * It refuses, with the line, a quoted field that is never closed, anything
 * between a closing quote and the next comma or line break, and a double
 * quote inside a field that does not start with one. An empty text has no
 * records.
 */
export function parseCsv(text: string): CsvParse {
    const records: CsvRecord[] = [];
    let fields: string[] = [];
    let field = "";
    let line = 1;
    let recordLine = 1;
    let i = text.startsWith(UTF8_BOM) ? UTF8_BOM.length : 0;

    const endField = () => {
        fields.push(field);
        field = "";
    };
    const endRecord = () => {
        endField();
        records.push({ line: recordLine, fields });
        fields = [];
    };
    /** The length of the line break at `at`, or 0 when there is none. */
    const lineBreak = (at: number) =>
        text[at] === "\r" ? (text[at + 1] === "\n" ? 2 : 1) : text[at] === "\n" ? 1 : 0;

    if (i >= text.length) {
        return { ok: true, records };
    }
    while (i <= text.length) {
        if (i === text.length) {
            endRecord();
            break;
        }
        if (field === "" && text[i] === '"') {
            // A quoted field, to the next lone quote.
            const startLine = line;
            i += 1;
            for (;;) {
                if (i >= text.length) {
                    return {
                        ok: false,
                        line: startLine,
                        message: `Line ${startLine}: a field that starts with a double quote is never closed.`,
                    };
                }
                if (text[i] === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                const length = lineBreak(i);
                if (length > 0) {
                    field += text.slice(i, i + length);
                    line += 1;
                    i += length;
                    continue;
                }
                field += text[i];
                i += 1;
            }
            const after = lineBreak(i);
            if (i < text.length && text[i] !== "," && after === 0) {
                return {
                    ok: false,
                    line,
                    message: `Line ${line}: a field in double quotes must end at a comma or the end of the line.`,
                };
            }
            continue;
        }
        const length = lineBreak(i);
        if (length > 0) {
            endRecord();
            line += 1;
            i += length;
            recordLine = line;
            if (i === text.length) {
                break;
            }
            continue;
        }
        if (text[i] === ",") {
            endField();
            i += 1;
            continue;
        }
        if (text[i] === '"') {
            return {
                ok: false,
                line,
                message: `Line ${line}: a field with a double quote in it must be in double quotes, with the quote doubled.`,
            };
        }
        field += text[i];
        i += 1;
    }
    return { ok: true, records };
}
