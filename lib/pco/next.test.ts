import { describe, expect, test, vi } from "vitest";

// notFound() throws a Next-internal error; a sentinel keeps the test independent
// of how Next encodes it.
const NOT_FOUND = vi.hoisted(() => new Error("notFound() was called"));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw NOT_FOUND;
    },
}));

import { PcoError } from "./client";
import { InvalidPcoIdError } from "./ids";
import { orNotFound } from "./next";

describe("orNotFound", () => {
    test("passes a resolved value through", async () => {
        await expect(orNotFound(Promise.resolve({ id: "1" }))).resolves.toEqual({
            id: "1",
        });
    });

    test("turns a 404 PcoError into notFound()", async () => {
        await expect(
            orNotFound(Promise.reject(new PcoError(404, "/services/v2/plans/1")))
        ).rejects.toBe(NOT_FOUND);
    });

    test("turns an invalid ID into notFound()", async () => {
        await expect(
            orNotFound(Promise.reject(new InvalidPcoIdError("abc")))
        ).rejects.toBe(NOT_FOUND);
    });

    test.each([
        ["a 500", new PcoError(500, "/services/v2/plans/1")],
        ["a 429", new PcoError(429, "/services/v2/plans/1")],
        ["a 401", new PcoError(401, "/services/v2/plans/1")],
        ["any other error", new Error("network down")],
    ])("rethrows %s unchanged", async (_case, error) => {
        await expect(orNotFound(Promise.reject(error))).rejects.toBe(error);
    });
});
