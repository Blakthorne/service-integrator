import { describe, expect, test } from "vitest";
import { parseBookCode, parseCatalogId } from "./ids";

describe("parseCatalogId", () => {
    test.each([
        ["1", 1],
        ["42", 42],
        ["1247", 1247],
        ["9".repeat(10), 9_999_999_999],
    ])("accepts %j as %i", (raw, expected) => {
        expect(parseCatalogId(raw)).toBe(expected);
    });

    test.each([
        "",
        "0",
        "00",
        "01",
        "-1",
        "+1",
        "1.5",
        "1.0",
        "1e3",
        "0x1",
        " 1",
        "1 ",
        "1\n",
        "../1",
        "1/2",
        "abc",
        "１２３", // full-width digits
        "١٢", // Arabic-Indic digits
        "1".repeat(11),
    ])("rejects %j", (raw) => {
        expect(parseCatalogId(raw)).toBeNull();
    });

    test.each([1, 0, null, undefined, true, {}, ["1"], BigInt(1)])(
        "rejects the non-string %o",
        (raw) => {
            expect(parseCatalogId(raw)).toBeNull();
        }
    );
});

describe("parseBookCode", () => {
    test.each(["R", "G", "g", "CB", "Chorus", "R2", "Hymns_2", "a-b", "ABCDEFGH"])(
        "accepts %j as given",
        (raw) => {
            expect(parseBookCode(raw)).toBe(raw);
        }
    );

    test.each([
        "",
        "1",
        "2R",
        "-R",
        "_R",
        "ABCDEFGHI",
        "R G",
        " R",
        "R ",
        "R\n",
        "R.1",
        "R/1",
        "../R",
        "%52",
        "É", // É
        "Ré", // Ré
        "Ｒ", // full-width R
    ])("rejects %j", (raw) => {
        expect(parseBookCode(raw)).toBeNull();
    });

    test.each([1, null, undefined, true, {}, ["R"]])(
        "rejects the non-string %o",
        (raw) => {
            expect(parseBookCode(raw)).toBeNull();
        }
    );
});
