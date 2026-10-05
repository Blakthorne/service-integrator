import { PreviewSample } from "@/app/components/Settings/SettingsFields";
import type { BookLabelPreview } from "@/lib/catalog/bookForms";

interface LabelPreviewTextProps {
    preview: Exclude<BookLabelPreview, null>;
}

/**
 * The line under a book's label field that shows how the book would label an
 * entry (the sample is set apart), or what is wrong with the label as typed.
 * It is the field's `preview`, so the field is described by it.
 */
export default function LabelPreviewText({ preview }: LabelPreviewTextProps) {
    if (preview.kind === "problem") {
        return <span className="text-red-600 dark:text-red-400">{preview.message}</span>;
    }
    return (
        <>
            {preview.lead} <PreviewSample>{preview.label}</PreviewSample>.
        </>
    );
}
