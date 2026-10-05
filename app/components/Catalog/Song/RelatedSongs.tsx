import Link from "next/link";
import type { CatalogSongSummary } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { LINK_CLASS, NoValue } from "../CatalogCard";
import EntryLabels from "../EntryLabels";

interface RelatedSongsProps {
    songs: readonly CatalogSongSummary[];
    /**
     * What names each song: its tune, for the hymn's other tunes, or its
     * title, for the other hymns sung to the tune.
     */
    by: "tune" | "title";
    /** What to say when there are none. */
    empty: string;
}

/** Songs related to the one shown, each a link to its page, with its entry labels. */
export default function RelatedSongs({ songs, by, empty }: RelatedSongsProps) {
    if (songs.length === 0) {
        return <NoValue>{empty}</NoValue>;
    }
    return (
        <ul className="space-y-2">
            {songs.map((song) => (
                <li key={song.id}>
                    {/* Default prefetch: a song's page reads the local database
                        and, cached for five minutes, the service types' names,
                        so prefetching costs at most one Planning Center request
                        (convention 13 guards those). */}
                    <Link href={routes.catalogSong(song.id)} className={LINK_CLASS}>
                        {by === "tune" ? (song.tuneName ?? "Tune unknown") : song.title}
                    </Link>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        <EntryLabels entries={song.entries} />
                    </div>
                </li>
            ))}
        </ul>
    );
}
