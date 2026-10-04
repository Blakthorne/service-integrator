import { describe, expect, test } from "vitest";
import { NOT_UTF8_MESSAGE, csvTextProblem } from "./csvUpload";

describe("csvTextProblem", () => {
    test("text with a replacement character was not UTF-8, and says how to save the file again", () => {
        // What decoding a Windows code page's curly quote as UTF-8 gives.
        const text = `number,title\n1,Jesus${String.fromCharCode(0xfffd)}s Name\n`;

        expect(csvTextProblem(text)).toBe(NOT_UTF8_MESSAGE);
        expect(NOT_UTF8_MESSAGE).toContain("CSV UTF-8");
    });

    test("UTF-8 text is fine, with accents and curly quotes in it", () => {
        const accents = "number,title\n1,Cantique de J\u00e9sus\n2,Jesus\u2019 Name\n";

        expect(csvTextProblem(accents)).toBeNull();
        expect(csvTextProblem("")).toBeNull();
    });

    test("a byte order mark is not a problem: the parser takes it off", () => {
        expect(csvTextProblem(`${String.fromCharCode(0xfeff)}number,title\n1,A\n`)).toBeNull();
    });
});
