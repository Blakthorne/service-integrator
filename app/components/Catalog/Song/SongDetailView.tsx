import type { EntryEditorBook } from "@/lib/catalog/entryEditor";
import { songOptionLabel } from "@/lib/catalog/pickers";
import type { CatalogSongDetail, MirroredPcoSong, PcoTag, PcoTagGroup } from "@/lib/domain";
import type { CreditSettings } from "@/lib/settings";
import CreditsCard from "./CreditsCard";
import EntriesCard from "./EntriesCard";
import HymnCard from "./HymnCard";
import PcoLinkCard from "./PcoLinkCard";
import SongHistorySection, { type SongHistoryInput } from "./SongHistorySection";
import TagsCard from "./TagsCard";
import ToLearnCard from "./ToLearnCard";
import TuneCard from "./TuneCard";

interface SongDetailViewProps {
    song: CatalogSongDetail;
    /** Every book, in use or not, in book order, for the Books card and its editor. */
    books: readonly EntryEditorBook[];
    /**
     * The linked Planning Center song as the mirror has it; null when the
     * song is not linked or the mirror lacks it.
     */
    pcoSong: MirroredPcoSong | null;
    /** The credit roles and their phrases, from the settings. */
    creditSettings: CreditSettings;
    /** The title "Create in Planning Center" starts with, for a song that is not linked. */
    newPcoSongTitle: string;
    /**
     * Planning Center's song tag groups, with their tags, as the mirror has
     * them; none for a song that is not linked.
     */
    tagGroups: PcoTagGroup[];
    /** The linked song's tags, as the mirror has them. */
    songTags: PcoTag[];
    /** What its History card shows; null for a song that is not linked, which has no history. */
    history: SongHistoryInput | null;
}

/**
 * The cards of a song's page: where it is in the books first (the numbers
 * are what a planner looks for), then its hymn and its tune side by side,
 * then whether it is marked to learn, then its link to Planning Center
 * (with Add to a plan, or Create in Planning Center), and, for a song
 * linked to one the app's copy of the library has, its credits and its
 * tags, and, for a song that is linked, its history: when it was sung.
 * Server components, except the Books, Hymn, To learn, Planning Center,
 * Credits and Tags cards, which edit. The Hymn card is keyed by
 * the hymn, so a merge that leaves the page on this song starts it
 * afresh; the last two are keyed by the Planning Center song, so a new
 * link starts them afresh.
 */
export default function SongDetailView({
    song,
    books,
    pcoSong,
    creditSettings,
    newPcoSongTitle,
    tagGroups,
    songTags,
    history,
}: SongDetailViewProps) {
    const linkedSong = song.pcoSongId !== null && pcoSong !== null ? pcoSong : null;
    return (
        <div className="space-y-6">
            <EntriesCard songId={song.id} entries={song.entries} books={books} />
            <div className="grid gap-6 md:grid-cols-2">
                <HymnCard key={song.hymn.id} songId={song.id} hymn={song.hymn} otherTunes={song.otherTunes} />
                <TuneCard tune={song.tune} otherHymns={song.otherHymns} />
            </div>
            <ToLearnCard
                songId={song.id}
                mark={song.marks.find(({ mark }) => mark === "to-learn") ?? null}
            />
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
                newPcoSongTitle={newPcoSongTitle}
                creditSettings={creditSettings}
            />
            {linkedSong && (
                <>
                    <CreditsCard
                        key={`credits-${linkedSong.id}`}
                        pcoSongId={linkedSong.id}
                        author={linkedSong.author}
                        settings={creditSettings}
                        editable={linkedSong.removedAt === null}
                    />
                    <TagsCard
                        key={`tags-${linkedSong.id}`}
                        pcoSongId={linkedSong.id}
                        groups={tagGroups}
                        songTags={songTags}
                        editable={linkedSong.removedAt === null}
                    />
                </>
            )}
            {history && <SongHistorySection {...history} />}
        </div>
    );
}
