import type { Book, CatalogSongDetail } from "@/lib/domain";
import EntriesCard from "./EntriesCard";
import HymnCard from "./HymnCard";
import TuneCard from "./TuneCard";

interface SongDetailViewProps {
    song: CatalogSongDetail;
    /** The catalog's books, for the Books card. */
    books: readonly Pick<Book, "id" | "name" | "numbered">[];
}

/**
 * The cards of a song's page: where it is in the books first (the numbers
 * are what a planner looks for), then its hymn and its tune side by side.
 * Server components only: the page has no interaction.
 */
export default function SongDetailView({ song, books }: SongDetailViewProps) {
    return (
        <div className="space-y-6">
            <EntriesCard entries={song.entries} books={books} />
            <div className="grid gap-6 md:grid-cols-2">
                <HymnCard hymn={song.hymn} otherTunes={song.otherTunes} />
                <TuneCard tune={song.tune} otherHymns={song.otherHymns} />
            </div>
            {/*
              Room for the cards that later phases add below, each full width
              and each only once it works (no placeholders):
              - PcoLinkCard (phase 2): the linked Planning Center song, or Link.
              - CreditsCard and TagsCard (phase 4): credits by role, and the
                song's Planning Center tags.
              - HistoryCard (phase 6): when the song was sung.
            */}
        </div>
    );
}
