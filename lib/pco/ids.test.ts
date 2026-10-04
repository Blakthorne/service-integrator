import { describe, expect, test } from "vitest";
import { InvalidPcoIdError, assertPcoId, parsePcoId } from "./ids";

describe("parsePcoId", () => {
    test.each(["1", "123", "1405391", "9".repeat(20)])("accepts %j", (raw) => {
        expect(parsePcoId(raw)).toBe(raw);
    });

    test.each([
        "",
        "0",
        "01",
        "-1",
        "+1",
        "1.5",
        "1e3",
        "0x1",
        " 1",
        "1 ",
        "1\n",
        "../1",
        "1/2",
        "abc",
        "１２３", // full-width digits
        "1".repeat(21),
    ])("rejects %j", (raw) => {
        expect(parsePcoId(raw)).toBeNull();
    });

    test.each([1, 123, 0, null, undefined, true, {}, ["1"], BigInt(1)])(
        "rejects the non-string %o",
        (raw) => {
            expect(parsePcoId(raw)).toBeNull();
        }
    );
});

describe("assertPcoId", () => {
    test("returns a valid ID unchanged", () => {
        expect(assertPcoId("1405391")).toBe("1405391");
    });

    test.each(["", "0", "../../../people/v2/people%3F", undefined])(
        "throws InvalidPcoIdError for %j",
        (raw) => {
            expect(() => assertPcoId(raw)).toThrow(InvalidPcoIdError);
        }
    );

    test("quotes the bad value so it cannot inject lines into logs", () => {
        expect(() => assertPcoId("1\nFAKE LOG LINE")).toThrow(
            'Invalid Planning Center ID: "1\\nFAKE LOG LINE"'
        );
    });
});
