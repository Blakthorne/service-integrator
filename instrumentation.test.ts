import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { boot } = vi.hoisted(() => ({ boot: vi.fn() }));
vi.mock("./lib/boot", () => ({ boot }));

import { register } from "./instrumentation";

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    boot.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("register", () => {
    test("boots the Node.js server", async () => {
        vi.stubEnv("NEXT_RUNTIME", "nodejs");
        vi.stubEnv("NEXT_PHASE", "phase-production-server");
        await register();
        expect(boot).toHaveBeenCalledOnce();
    });

    test("does nothing in the Edge runtime", async () => {
        vi.stubEnv("NEXT_RUNTIME", "edge");
        await register();
        expect(boot).not.toHaveBeenCalled();
    });

    test("does nothing during next build", async () => {
        vi.stubEnv("NEXT_RUNTIME", "nodejs");
        vi.stubEnv("NEXT_PHASE", "phase-production-build");
        await register();
        expect(boot).not.toHaveBeenCalled();
    });

    test("logs a failure instead of throwing", async () => {
        vi.stubEnv("NEXT_RUNTIME", "nodejs");
        const failure = new Error("boom");
        boot.mockImplementation(() => {
            throw failure;
        });
        await expect(register()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith("Boot failed:", failure);
    });
});
