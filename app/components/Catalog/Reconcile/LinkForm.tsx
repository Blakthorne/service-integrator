"use client";

import SubmitButton from "@/app/components/ui/SubmitButton";

interface LinkFormProps {
    /** The row's link action, from `useActionState`. */
    action: (formData: FormData) => void;
    songId: number;
    pcoSongId: string;
    /** The catalog song's label, which names the button for screen readers: "Link to …". */
    songLabel: string;
}

/**
 * Link one catalog song to the row's Planning Center song: a form of the two
 * ids and its submit button. Each suggestion and each picker match has one;
 * they share the row's action, and each shows its own pending state.
 */
export default function LinkForm({ action, songId, pcoSongId, songLabel }: LinkFormProps) {
    return (
        <form action={action} className="shrink-0">
            <input type="hidden" name="songId" value={songId} />
            <input type="hidden" name="pcoSongId" value={pcoSongId} />
            <SubmitButton pendingLabel="Linking…">
                Link<span className="sr-only"> to {songLabel}</span>
            </SubmitButton>
        </form>
    );
}
