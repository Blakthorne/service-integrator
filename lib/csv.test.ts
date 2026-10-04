import { describe, expect, test } from "vitest";
import { CSV_MIME_TYPE, UTF8_BOM, csvField, parseCsv, toCsv } from "./csv";

describe("csvField", () => {
    test("writes plain text as it is", () => {
        expect(csvField("Amazing Grace")).toBe("Amazing Grace");
        expect(csvField("R-396")).toBe("R-396");
        expect(csvField("2026-09-27")).toBe("2026-09-27");
        expect(csvField("It's a tune; really")).toBe("It's a tune; really");
        expect(csvField("")).toBe("");
    });

    test("quotes a field with a comma", () => {
        expect(csvField("Come, Thou Fount")).toBe('"Come, Thou Fount"');
    });

    test("quotes a field with a double quote, and doubles the quote", () => {
        expect(csvField('He said "go"')).toBe('"He said ""go"""');
        expect(csvField('"')).toBe('""""');
    });

    test("quotes a field with a line feed or a carriage return, keeping it", () => {
        expect(csvField("one\ntwo")).toBe('"one\ntwo"');
        expect(csvField("one\r\ntwo")).toBe('"one\r\ntwo"');
        expect(csvField("one\rtwo")).toBe('"one\rtwo"');
    });

    test("does not quote spaces or other punctuation", () => {
        expect(csvField(" padded ")).toBe(" padded ");
        expect(csvField("a;b:c.d")).toBe("a;b:c.d");
    });

    describe("formula injection", () => {
        test.each([
            ["=", "=SUM(A1:A9)", "'=SUM(A1:A9)"],
            ["+", "+1+1", "'+1+1"],
            ["-", "-2+3", "'-2+3"],
            ["@", "@SUM(A1)", "'@SUM(A1)"],
            ["a tab", "\t=1", "'\t=1"],
        ])("puts a ' before a field that starts with %s", (_name, field, written) => {
            expect(csvField(field)).toBe(written);
        });

        test("puts a ' before a field that starts with a carriage return, which also quotes it", () => {
            expect(csvField("\r=1")).toBe("\"'\r=1\"");
        });

        test("guards a field that needs quotes too, outside them", () => {
            expect(csvField('=HYPERLINK("http://example.com","hi")')).toBe(
                "\"'=HYPERLINK(\"\"http://example.com\"\",\"\"hi\"\")\""
            );
            expect(csvField("-a, b")).toBe("\"'-a, b\"");
        });

        test("leaves a field alone when the character is not its first", () => {
            expect(csvField("a=b")).toBe("a=b");
            expect(csvField("1+1")).toBe("1+1");
            expect(csvField("R-396")).toBe("R-396");
            expect(csvField("x@y.example")).toBe("x@y.example");
            expect(csvField(" =1")).toBe(" =1");
        });

        test("does not guard a field that already starts with a '", () => {
            expect(csvField("'=1")).toBe("'=1");
        });
    });
});

describe("toCsv", () => {
    test("separates fields with commas and ends every record, the last too, with CRLF", () => {
        expect(
            toCsv([
                ["Title", "Tune"],
                ["Amazing Grace", "NEW BRITAIN"],
            ])
        ).toBe("Title,Tune\r\nAmazing Grace,NEW BRITAIN\r\n");
    });

    test("writes empty fields as nothing", () => {
        expect(toCsv([["a", "", "c"], ["", "", ""]])).toBe("a,,c\r\n,,\r\n");
    });

    test("quotes and guards field by field", () => {
        expect(toCsv([["Come, Thou Fount", '"Hi"', "=1", "plain"]])).toBe(
            "\"Come, Thou Fount\",\"\"\"Hi\"\"\",'=1,plain\r\n"
        );
    });

    test("keeps a line break inside a quoted field in the one record", () => {
        expect(toCsv([["a\nb", "c"], ["d", "e"]])).toBe('"a\nb",c\r\nd,e\r\n');
    });

    test("makes no records an empty string, and one empty record an empty line", () => {
        expect(toCsv([])).toBe("");
        expect(toCsv([[]])).toBe("\r\n");
    });
});

describe("the download's constants", () => {
    test("name UTF-8 for the media type and the byte order mark", () => {
        expect(CSV_MIME_TYPE).toBe("text/csv;charset=utf-8");
        expect(UTF8_BOM).toHaveLength(1);
        expect(UTF8_BOM.charCodeAt(0)).toBe(0xfeff);
    });
});

describe("parseCsv", () => {
    /** The fields of each record, for a parse that must succeed. */
    function fields(text: string): string[][] {
        const parsed = parseCsv(text);
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        return parsed.records.map((record) => record.fields);
    }

    test("reads records of comma-separated fields, keeping spaces", () => {
        expect(fields("number,title\r\n396, A Charge to Keep \r\n")).toEqual([
            ["number", "title"],
            ["396", " A Charge to Keep "],
        ]);
    });

    test("ends records at CRLF, LF or a lone CR", () => {
        expect(fields("a,b\nc,d\r\ne,f\rg,h")).toEqual([
            ["a", "b"],
            ["c", "d"],
            ["e", "f"],
            ["g", "h"],
        ]);
    });

    test("ends the last record at a final line break, or at the end without one", () => {
        expect(fields("a,b\r\n")).toEqual([["a", "b"]]);
        expect(fields("a,b\n")).toEqual([["a", "b"]]);
        expect(fields("a,b")).toEqual([["a", "b"]]);
    });

    test("reads an empty line as a record of one empty field, and empty fields as empty", () => {
        expect(fields("a\n\nb\n")).toEqual([["a"], [""], ["b"]]);
        expect(fields(",x,\n")).toEqual([["", "x", ""]]);
    });

    test("reads a quoted field whole: commas, line breaks and doubled quotes", () => {
        expect(fields('396,"Come, Thou Fount","He said ""go""\r\nthen ""stop"""\n')).toEqual([
            ["396", "Come, Thou Fount", 'He said "go"\r\nthen "stop"'],
        ]);
        expect(fields('"",""""\n')).toEqual([["", '"']]);
    });

    test("skips a byte order mark at the start, and only there", () => {
        expect(fields(`${UTF8_BOM}number,title\n1,A\n`)).toEqual([
            ["number", "title"],
            ["1", "A"],
        ]);
        expect(fields(`a,${UTF8_BOM}b`)).toEqual([["a", `${UTF8_BOM}b`]]);
    });

    test("gives each record the line it starts on, a quoted line break counting", () => {
        const parsed = parseCsv('h\n"two\nlines"\nthree\r\n\r\nfive');
        expect(parsed.ok && parsed.records.map(({ line }) => line)).toEqual([1, 2, 4, 5, 6]);
    });

    test("has no records for an empty text, or one that is only a byte order mark", () => {
        expect(parseCsv("")).toEqual({ ok: true, records: [] });
        expect(parseCsv(UTF8_BOM)).toEqual({ ok: true, records: [] });
    });

    test("reads back what toCsv writes", () => {
        const records = [
            ["number", "title", "tune", "variant"],
            ["108", "Amazing Grace", "NEW BRITAIN", ""],
            ["109", 'Amazing "Grace", again', "NEW\nBRITAIN", "Descant - last stanza only"],
        ];
        expect(fields(toCsv(records))).toEqual(records);
    });

    test("refuses a quoted field that is never closed, with the line it starts on", () => {
        expect(parseCsv('a\nb,"open\nstill open')).toEqual({
            ok: false,
            line: 2,
            message: "Line 2: a field that starts with a double quote is never closed.",
        });
    });

    test("refuses text between a closing quote and the next comma", () => {
        expect(parseCsv('a\n"quoted" then more,b')).toEqual({
            ok: false,
            line: 2,
            message: "Line 2: a field in double quotes must end at a comma or the end of the line.",
        });
    });

    test("refuses a double quote inside a field that does not start with one", () => {
        expect(parseCsv('1,The "Old" Cross')).toEqual({
            ok: false,
            line: 1,
            message: "Line 1: a field with a double quote in it must be in double quotes, with the quote doubled.",
        });
    });
});
