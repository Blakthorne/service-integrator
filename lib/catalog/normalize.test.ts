import { describe, expect, test } from "vitest";
import { normalizeTuneName } from "./normalize";

describe("normalizeTuneName", () => {
    test.each([
        ["DARWALL", "DARWALL"],
        ["Darwall", "DARWALL"],
        ["  ST.   ANNE \t", "ST. ANNE"],
        ["STEPHANOS (Baker)", "STEPHANOS (BAKER)"],
        ["j\u00FCngst", "J\u00DCNGST"], // jüngst
        ["IL EST N\u00C9", "IL EST N\u00C9"],
        ["OLIVE'S BROW", "OLIVE'S BROW"],
        ["", ""],
    ])("%j becomes %j", (name, expected) => {
        expect(normalizeTuneName(name)).toBe(expected);
    });
});
