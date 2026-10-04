import { PREVIEW_AFTER_FIXES, type CreditsPreview } from "@/lib/catalog/creditsEditor";
import { HINT_CLASS } from "../SongForm/Fields";
import { PREVIEW_BOX_CLASS } from "./styles";

/** Text a preview shows as it will be written, set apart; its spaces are kept. */
export function Sample({ children }: { children: React.ReactNode }) {
    return (
        <span className="whitespace-pre-wrap break-words font-semibold text-gray-900 dark:text-gray-100">
            {children}
        </span>
    );
}

interface CreditsPreviewBoxProps {
    /** What the credit editor's rows would write and print (`previewCredits`). */
    preview: CreditsPreview;
    /** The id of the line saying what the author will be: the button that writes it is described by it. */
    authorId: string;
    /**
     * Shown in place of the preview when there are no names, for a form that
     * needs some; without it, the empty author is shown.
     */
    emptyMessage?: string;
    /** True when names are marked with a problem: the marks say what is wrong, so the box only points at them. */
    namesMarked: boolean;
}

/**
 * Under the credit editor: the credit line the copyright text will print,
 * and the exact author Planning Center will be sent, as they are typed; or
 * why they cannot be written.
 */
export default function CreditsPreviewBox({
    preview,
    authorId,
    emptyMessage,
    namesMarked,
}: CreditsPreviewBoxProps) {
    if (!preview.ok && namesMarked) {
        return (
            <div className={PREVIEW_BOX_CLASS}>
                <p id={authorId} className={HINT_CLASS}>
                    {PREVIEW_AFTER_FIXES}
                </p>
            </div>
        );
    }
    if (!preview.ok || (emptyMessage !== undefined && preview.credits.length === 0)) {
        return (
            <div className={PREVIEW_BOX_CLASS}>
                <p id={authorId} className="text-sm text-red-600 dark:text-red-400">
                    {preview.ok ? emptyMessage : preview.message}
                </p>
            </div>
        );
    }
    return (
        <div className={PREVIEW_BOX_CLASS}>
            <p className={HINT_CLASS}>
                The copyright text will print: <Sample>{preview.creditLine}</Sample>
            </p>
            <p id={authorId} className={HINT_CLASS}>
                Planning Center&apos;s author will be:{" "}
                {preview.author === "" ? <Sample>nothing (no author)</Sample> : <Sample>{preview.author}</Sample>}
            </p>
        </div>
    );
}
