import CopyButton from "./ui/CopyButton";
import SongCopyright from "./SongCopyright";
import { formatCopyrightText } from "@/lib/copyright";
import type { PlanItemWithSong } from "@/lib/domain";
import type { CopyrightSettings } from "@/lib/settings";

interface SongDetailsProps {
    /** The plan item to show, with its song (null for items without one). */
    item: PlanItemWithSong;
    /** The settings its copyright block follows: the CCLI license number. */
    settings: CopyrightSettings;
}

/**
 * The details card of a plan item's page: the item's title and, when it has a
 * song, the song's author, CCLI number, copyright, administration, notes and
 * themes, then its copyright block with a copy button, naming the CCLI
 * license number from `settings` as the Copyright tab does. The page header
 * (breadcrumbs, title, Planning Center link) is the page's job.
 */
export default function SongDetails({
    item,
    settings,
}: SongDetailsProps): React.ReactElement {
    const song = item.song;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                        Song Details
                    </h2>
                    <dl className="space-y-4">
                        <div>
                            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                Title
                            </dt>
                            <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                {item.title}
                            </dd>
                        </div>
                        {song && (
                            <>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Author
                                    </dt>
                                    <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                        {song.author}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        CCLI Number
                                    </dt>
                                    <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                        {song.ccliNumber || "-"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Copyright
                                    </dt>
                                    <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                        {song.copyright || "-"}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Administration
                                    </dt>
                                    <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                        {song.admin || "-"}
                                    </dd>
                                </div>
                            </>
                        )}
                    </dl>
                </div>

                {song && (
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                            Additional Information
                        </h2>
                        <dl className="space-y-4">
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Notes
                                </dt>
                                <dd className="mt-1 text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                                    {song.notes || "-"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    Themes
                                </dt>
                                <dd className="mt-1 text-gray-900 dark:text-gray-100">
                                    {song.themes || "-"}
                                </dd>
                            </div>
                        </dl>
                    </div>
                )}
            </div>

            {song && (
                <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Copyright Information
                        </h2>
                        <div className="flex items-center gap-4">
                            <CopyButton
                                label="Copy"
                                text={formatCopyrightText(
                                    {
                                        title: song.title,
                                        author: song.author,
                                        admin: song.admin,
                                        copyright: song.copyright,
                                    },
                                    settings
                                )}
                            />
                        </div>
                    </div>
                    <SongCopyright
                        title={song.title}
                        author={song.author}
                        copyright={song.copyright}
                        admin={song.admin}
                        settings={settings}
                    />
                </div>
            )}
        </div>
    );
}
