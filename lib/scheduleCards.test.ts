import { describe, expect, test } from "vitest";
import { catalogUnavailableMessage } from "./scheduleCards";

describe("catalogUnavailableMessage", () => {
    test("says why the catalog is unavailable, and what that means for the numbers", () => {
        expect(
            catalogUnavailableMessage(
                "Could not open the database at /srv/data/app.sqlite: unable to open database file"
            )
        ).toBe(
            "The catalog is unavailable: Could not open the database at /srv/data/app.sqlite: unable to open database file. Numbers can't be shown."
        );
    });

    test("does not add a second full stop to a reason that ends a sentence", () => {
        expect(catalogUnavailableMessage("The disk is full.")).toBe(
            "The catalog is unavailable: The disk is full. Numbers can't be shown."
        );
        expect(catalogUnavailableMessage("Locked!")).toBe(
            "The catalog is unavailable: Locked! Numbers can't be shown."
        );
    });

    test("trims the reason, and leaves out an empty one", () => {
        expect(catalogUnavailableMessage("  locked  ")).toBe(
            "The catalog is unavailable: locked. Numbers can't be shown."
        );
        expect(catalogUnavailableMessage(" ")).toBe(
            "The catalog is unavailable. Numbers can't be shown."
        );
    });
});
