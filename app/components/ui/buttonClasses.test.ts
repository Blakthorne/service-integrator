import { describe, expect, test } from "vitest";
import { buttonClasses, type ButtonVariant } from "./buttonClasses";

const BASE =
    "px-4 py-2 text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors";

/**
 * Every variant's classes, pinned as `SubmitButton` had them before they moved
 * here (the Settings page's Save and Sync now are the primary variant), so
 * the look of the app's buttons cannot change by accident.
 */
const EXPECTED: Record<ButtonVariant, { colour: string; hover: string }> = {
    primary: {
        colour: "text-white bg-blue-600 focus:ring-blue-600 dark:focus:ring-blue-400",
        hover: "hover:bg-blue-700",
    },
    danger: {
        colour: "text-white bg-red-600 focus:ring-red-500",
        hover: "hover:bg-red-700",
    },
    secondary: {
        colour: "text-gray-700 bg-white border border-gray-300 focus:ring-blue-600 dark:text-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:focus:ring-blue-400",
        hover: "hover:bg-gray-50 dark:hover:bg-gray-600",
    },
};

describe("buttonClasses", () => {
    test.each(Object.keys(EXPECTED) as ButtonVariant[])(
        "gives the %s variant its colours and its hover while it is available",
        (variant) => {
            const { colour, hover } = EXPECTED[variant];
            expect(buttonClasses(variant)).toBe(`${BASE} ${colour} cursor-pointer ${hover}`);
            expect(buttonClasses(variant, false)).toBe(buttonClasses(variant));
        }
    );

    test.each(Object.keys(EXPECTED) as ButtonVariant[])(
        "fades the %s variant and drops its hover while it is pending",
        (variant) => {
            const { colour, hover } = EXPECTED[variant];
            const pending = buttonClasses(variant, true);
            expect(pending).toBe(`${BASE} ${colour} opacity-60 cursor-not-allowed`);
            for (const hoverClass of hover.split(" ")) {
                expect(pending).not.toContain(hoverClass);
            }
        }
    );

    test("is the primary variant by default", () => {
        expect(buttonClasses()).toBe(buttonClasses("primary", false));
    });

    test("keeps white text on blue-600 and red-600, never the lighter blue-500 that falls under 4.5:1", () => {
        expect(buttonClasses("primary")).toContain("bg-blue-600");
        expect(buttonClasses("primary")).not.toContain("bg-blue-500");
        expect(buttonClasses("danger")).toContain("bg-red-600");
    });
});
