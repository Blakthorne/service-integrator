/**
 * `promise`'s value, or what `onTimeout` returns when `promise` has not
 * settled within `ms` milliseconds, whichever comes first. A promise that
 * rejects in time rejects the result; one that settles late is ignored (and
 * a late rejection is handled, so it is never reported as unhandled). The
 * timer is cleared as soon as `promise` settles. `onTimeout` that throws
 * rejects the result.
 *
 * It does not cancel `promise`: whatever it is doing carries on. It is for a
 * caller that must stop waiting, such as a page that streams a card from
 * Planning Center, whose open response holds up leaving the page.
 */
export function withDeadline<T>(
    promise: PromiseLike<T>,
    ms: number,
    onTimeout: () => T
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            try {
                resolve(onTimeout());
            } catch (error) {
                reject(error);
            }
        }, ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
