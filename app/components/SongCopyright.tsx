import { formatCopyrightText, type CopyrightSong } from "@/lib/copyright";
import type { CopyrightSettings } from "@/lib/settings";

interface SongCopyrightProps extends CopyrightSong {
    /** The settings the block follows: the CCLI license number. */
    settings: CopyrightSettings;
}

/**
 * A song's copyright block, as its copy button copies it: the text of
 * `formatCopyrightText`, with the CCLI license number from `settings`.
 */
export default function SongCopyright({
    title,
    author,
    copyright,
    admin,
    settings,
}: SongCopyrightProps): React.ReactElement {
    const copyrightText = formatCopyrightText(
        {
            title,
            author,
            copyright,
            admin,
        },
        settings
    );

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex justify-between items-start gap-4">
                <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-line">
                    {copyrightText}
                </p>
            </div>
        </div>
    );
}
