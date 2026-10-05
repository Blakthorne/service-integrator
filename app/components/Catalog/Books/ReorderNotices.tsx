import type { Reorder } from "./useReorder";
import { ALERT_CLASS } from "./styles";

interface ReorderNoticesProps {
    reorder: Pick<Reorder, "status" | "failure">;
}

/**
 * What a list with Move buttons says about its last move: where the row is
 * now, in a status region that is always rendered (a live region that is
 * added with its text already in it may not be announced), and what was
 * refused as an alert keyed per attempt (`Reorder.failure`), so a refusal
 * that repeats word for word is announced again.
 */
export default function ReorderNotices({ reorder: { status, failure } }: ReorderNoticesProps) {
    return (
        <>
            <p
                role="status"
                className={status === "" ? "sr-only" : "mt-3 text-sm text-gray-600 dark:text-gray-300"}
            >
                {status}
            </p>
            {failure && (
                <p key={failure.attempt} role="alert" className={`mt-3 ${ALERT_CLASS}`}>
                    {failure.message}
                </p>
            )}
        </>
    );
}
