import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDebouncedSave } from "./debouncedSave";

describe("createDebouncedSave", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("saves a value once the delay has passed, not before", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        saver.schedule("a");
        vi.advanceTimersByTime(499);
        expect(save).not.toHaveBeenCalled();
        expect(saver.isPending()).toBe(true);

        vi.advanceTimersByTime(1);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith("a");
        expect(saver.isPending()).toBe(false);
    });

    test("each schedule restarts the wait, and only the last value is saved", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        saver.schedule("a");
        vi.advanceTimersByTime(400);
        saver.schedule("ab");
        vi.advanceTimersByTime(400);
        saver.schedule("abc");
        vi.advanceTimersByTime(499);
        expect(save).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(save.mock.calls).toEqual([["abc"]]);
    });

    test("flush saves the waiting value at once, and the timer does not save it again", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        saver.schedule("typed");
        vi.advanceTimersByTime(100);
        expect(saver.flush()).toBe(true);
        expect(save.mock.calls).toEqual([["typed"]]);
        expect(saver.isPending()).toBe(false);

        vi.advanceTimersByTime(1000);
        expect(save).toHaveBeenCalledTimes(1);
    });

    test("flush does nothing when nothing is waiting", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        expect(saver.flush()).toBe(false);
        saver.schedule("a");
        vi.advanceTimersByTime(500);
        expect(saver.flush()).toBe(false);
        expect(save).toHaveBeenCalledTimes(1);
    });

    test("an empty string is a value like any other", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        saver.schedule("");
        expect(saver.flush()).toBe(true);
        expect(save).toHaveBeenCalledWith("");
    });

    test("cancel drops the waiting value", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        saver.schedule("a");
        saver.cancel();
        expect(saver.isPending()).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(saver.flush()).toBe(false);
        expect(save).not.toHaveBeenCalled();
    });

    test("scheduling works again after a flush or a cancel", () => {
        const save = vi.fn();
        const saver = createDebouncedSave(save, 500);

        saver.schedule("a");
        saver.flush();
        saver.schedule("b");
        saver.cancel();
        saver.schedule("c");
        vi.advanceTimersByTime(500);
        expect(save.mock.calls).toEqual([["a"], ["c"]]);
    });

    test("unmount-style flush: a value typed just before leaving is saved", () => {
        // What CustomTextInput does when it unmounts mid-wait (Back, a tab
        // switch): no blur event arrives, so the cleanup flushes instead.
        const saved: string[] = [];
        const saver = createDebouncedSave((text: string) => saved.push(text), 500);

        saver.schedule("Holy");
        saver.schedule("Holy Night");
        // ...the component unmounts 200 ms later:
        vi.advanceTimersByTime(200);
        saver.flush();
        vi.advanceTimersByTime(1000);
        expect(saved).toEqual(["Holy Night"]);
    });
});
