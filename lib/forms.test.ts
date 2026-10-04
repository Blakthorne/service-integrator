import { describe, expect, test } from "vitest";
import { parseCatalogId } from "./catalog/ids";
import {
    IDLE_FORM,
    fieldErrorOf,
    formError,
    formStateKey,
    formSuccess,
    readId,
    readOptionalPositiveInteger,
    readOptionalString,
    readString,
    readValues,
    type FormState,
} from "./forms";

/** A form with these fields, as the browser would post it. */
function formWith(fields: Record<string, string | File> = {}): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        formData.set(name, value);
    }
    return formData;
}

const FILE = new File(["396"], "396.txt");

describe("form states", () => {
    test("start idle", () => {
        expect(IDLE_FORM).toEqual({ status: "idle" });
    });

    test("an error carries its message, the fields to fix and what was posted", () => {
        expect(
            formError("Check the fields marked below.", {
                fieldErrors: {
                    entry: {
                        message: "R-396 is taken.",
                        link: { href: "/catalog/songs/7", label: "Holy, Holy, Holy" },
                    },
                },
                values: { number: "396" },
            })
        ).toEqual({
            status: "error",
            message: "Check the fields marked below.",
            fieldErrors: {
                entry: {
                    message: "R-396 is taken.",
                    link: { href: "/catalog/songs/7", label: "Holy, Holy, Holy" },
                },
            },
            values: { number: "396" },
        });
    });

    test("an error of the whole form has no field errors", () => {
        expect(formError("There is no such song.")).toEqual({
            status: "error",
            message: "There is no such song.",
            fieldErrors: {},
            values: {},
        });
    });

    test("a success carries its message", () => {
        expect(formSuccess("Linked.")).toEqual({
            status: "success",
            message: "Linked.",
            values: {},
        });
    });

    test("give a field's error only in an error state", () => {
        const error: FormState<"hymn" | "tune"> = formError("No.", {
            fieldErrors: { tune: { message: "Choose a tune." } },
        });
        expect(fieldErrorOf(error, "tune")).toEqual({ message: "Choose a tune." });
        expect(fieldErrorOf(error, "hymn")).toBeUndefined();
        expect(fieldErrorOf<"tune">(formSuccess("Done."), "tune")).toBeUndefined();
        expect(fieldErrorOf<"tune">(IDLE_FORM, "tune")).toBeUndefined();
    });
});

describe("formStateKey", () => {
    test("is the same for one state, however often it is asked", () => {
        const state = formError("The song was not added.");
        expect(formStateKey(state)).toBe(formStateKey(state));
    });

    test("is new for each state, even one word for word like the last", () => {
        const first = formError("Linked to another song.");
        const second = formError("Linked to another song.");
        expect(second).toEqual(first);
        expect(formStateKey(second)).not.toBe(formStateKey(first));
    });
});

describe("readString", () => {
    test("trims the field's text", () => {
        expect(readString(formWith({ title: "  Amazing Grace \n" }), "title")).toBe(
            "Amazing Grace"
        );
    });

    test("is empty for a field that is missing, blank or a file", () => {
        expect(readString(formWith(), "title")).toBe("");
        expect(readString(formWith({ title: "   " }), "title")).toBe("");
        expect(readString(formWith({ title: FILE }), "title")).toBe("");
    });
});

describe("readOptionalString", () => {
    test("trims the field's text", () => {
        expect(readOptionalString(formWith({ location: " front cover " }), "location")).toBe(
            "front cover"
        );
    });

    test("is null for a field that is missing, blank or a file", () => {
        expect(readOptionalString(formWith(), "location")).toBeNull();
        expect(readOptionalString(formWith({ location: " \t " }), "location")).toBeNull();
        expect(readOptionalString(formWith({ location: FILE }), "location")).toBeNull();
    });
});

describe("readOptionalPositiveInteger", () => {
    const read = (value: string | File | undefined, max?: number) =>
        readOptionalPositiveInteger(
            formWith(value === undefined ? {} : { number: value }),
            "number",
            max === undefined ? {} : { max }
        );

    test.each([
        ["396", 396],
        [" 396 ", 396],
        ["1", 1],
        ["007", 7],
    ])("reads %j as %d", (text, value) => {
        expect(read(text)).toEqual({ ok: true, value });
    });

    test("is null for a field that is missing or blank", () => {
        expect(read(undefined)).toEqual({ ok: true, value: null });
        expect(read("")).toEqual({ ok: true, value: null });
        expect(read("   ")).toEqual({ ok: true, value: null });
    });

    test.each([
        ["zero", "0"],
        ["a negative number", "-1"],
        ["a plus sign", "+1"],
        ["a decimal", "1.5"],
        ["an exponent", "1e3"],
        ["a space inside", "3 96"],
        ["a word", "abc"],
        ["full-width digits", "\uFF13\uFF19\uFF16"],
        ["a number past the safe integers", "9007199254740993"],
    ])("refuses %s", (_name, text) => {
        expect(read(text)).toEqual({ ok: false });
    });

    test("refuses a file", () => {
        expect(read(FILE)).toEqual({ ok: false });
    });

    test("refuses a number over the maximum, and takes the maximum itself", () => {
        expect(read("100000", 99_999)).toEqual({ ok: false });
        expect(read("99999", 99_999)).toEqual({ ok: true, value: 99_999 });
    });
});

describe("readId", () => {
    test("reads an id through its kind's parser", () => {
        expect(readId(formWith({ songId: "12" }), "songId", parseCatalogId)).toBe(12);
    });

    test("is null for a field that is missing, a file, or not an id of that kind", () => {
        expect(readId(formWith(), "songId", parseCatalogId)).toBeNull();
        expect(readId(formWith({ songId: FILE }), "songId", parseCatalogId)).toBeNull();
        expect(readId(formWith({ songId: "abc" }), "songId", parseCatalogId)).toBeNull();
        expect(readId(formWith({ songId: "012" }), "songId", parseCatalogId)).toBeNull();
    });

    test("does not trim: an id is never typed", () => {
        expect(readId(formWith({ songId: " 12" }), "songId", parseCatalogId)).toBeNull();
    });
});

describe("readValues", () => {
    test("gives each named field's text as posted, and nothing else", () => {
        expect(
            readValues(formWith({ title: " Amazing Grace ", number: "396", other: "x" }), [
                "title",
                "number",
            ])
        ).toEqual({ title: " Amazing Grace ", number: "396" });
    });

    test("gives an empty string for a field that is missing or a file", () => {
        expect(readValues(formWith({ number: FILE }), ["title", "number"])).toEqual({
            title: "",
            number: "",
        });
    });
});
