import { describe, expect, test } from "vitest";
import { normalizeTuneName } from "./normalize";

describe("normalizeTuneName", () => {
    test.each([
        ["DARWALL", "DARWALL"],
        ["Darwall", "DARWALL"],
        ["  ST.   ANNE \t", "ST. ANNE"],
        ["STEPHANOS (Baker)", "STEPHANOS (BAKER)"],
        ["jüngst", "JÜNGST"], // jüngst
        ["IL EST NÉ", "IL EST NÉ"],
        ["OLIVE'S BROW", "OLIVE'S BROW"],
        ["", ""],
    ])("%j becomes %j", (name, expected) => {
        expect(normalizeTuneName(name)).toBe(expected);
    });
});
