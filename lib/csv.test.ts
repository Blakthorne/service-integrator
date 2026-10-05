import { describe, expect, test } from "vitest";
import { CSV_MIME_TYPE, UTF8_BOM, csvField, toCsv } from "./csv";

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
