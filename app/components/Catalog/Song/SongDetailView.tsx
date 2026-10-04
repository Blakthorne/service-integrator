import { songOptionLabel } from "@/lib/catalog/pickers";
import type { Book, CatalogSongDetail, MirroredPcoSong } from "@/lib/domain";
import EntriesCard from "./EntriesCard";
import HymnCard from "./HymnCard";
import PcoLinkCard from "./PcoLinkCard";
import TuneCard from "./TuneCard";

interface SongDetailViewProps {
    song: CatalogSongDetail;
    /** The catalog's books, for the Books card. */
    books: readonly Pick<Book, "id" | "name" | "numbered">[];
    /** The linked Planning Center song as the mirror has it; null when the song is not linked or the mirror lacks it. */
    pcoSong: MirroredPcoSong | null;
}

/**
 * The cards of a song's page: where it is in the books first (the numbers
 * are what a planner looks for), then its hymn and its tune side by side,
 * then its link to Planning Center. Server components, except the
 * Planning Center card, whose Unlink is a form.
 */
export default function SongDetailView({ song, books, pcoSong }: SongDetailViewProps) {
    return (
        <div className="space-y-6">
            <EntriesCard entries={song.entries} books={books} />
            <div className="grid gap-6 md:grid-cols-2">
                <HymnCard hymn={song.hymn} otherTunes={song.otherTunes} />
                <TuneCard tune={song.tune} otherHymns={song.otherHymns} />
            </div>
            <PcoLinkCard
                songId={song.id}
                songLabel={songOptionLabel({
                    title: song.hymn.title,
                    tuneName: song.tune?.name ?? null,
                })}
                link={
                    song.pcoSongId === null
                        ? null
                        : {
                              pcoSongId: song.pcoSongId,
                              linkedBy: song.linkedBy,
                              linkedAt: song.linkedAt,
                              pcoSong,
                          }
                }
            />
            {/*
              Room for the cards that later phases add below, each full width
              and each only once it works (no placeholders):
              - CreditsCard and TagsCard (phase 4): credits by role, and the
                song's Planning Center tags.
              - HistoryCard (phase 6): when the song was sung.
            */}
        </div>
    );
}
