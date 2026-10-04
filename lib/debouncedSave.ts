/** A value waiting to be saved, and the controls for when it is. */
export interface DebouncedSave<T> {
    /**
     * Wait `delayMs` and then save `value`. Scheduling again before then
     * replaces the value and restarts the wait.
     */
    schedule(value: T): void;
    /**
     * Save the waiting value now, if there is one, instead of when the wait
     * ends. Returns whether anything was saved.
     */
    flush(): boolean;
    /** Drop the waiting value without saving it. */
    cancel(): void;
    /** Whether a value is waiting to be saved. */
    isPending(): boolean;
}

/**
 * A debounced save: only the last of a burst of `schedule` calls is saved,
 * once `delayMs` has passed without another. `flush` saves early, for moments
 * when the wait would be cut short and the value lost: the field loses focus,
 * or the component holding it unmounts (its timer would otherwise be cleared,
 * or fire after it is gone). Each value is saved at most once.
 */
export function createDebouncedSave<T>(
    save: (value: T) => void,
    delayMs: number
): DebouncedSave<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: T;

    function clear(): boolean {
        if (timer === null) {
            return false;
        }
        clearTimeout(timer);
        timer = null;
        return true;
    }

    return {
        schedule(value) {
            clear();
            pendingValue = value;
            timer = setTimeout(() => {
                timer = null;
                save(pendingValue);
            }, delayMs);
        },
        flush() {
            if (!clear()) {
                return false;
            }
            save(pendingValue);
            return true;
        },
        cancel() {
            clear();
        },
        isPending() {
            return timer !== null;
        },
    };
}
