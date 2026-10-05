import type { CatalogSongSummary, HymnWithAliases } from "@/lib/domain";
import CatalogCard, { CardField, NoValue } from "../CatalogCard";
import RelatedSongs from "./RelatedSongs";

interface HymnCardProps {
    hymn: HymnWithAliases;
    /** The hymn's other songs: the other tunes it is sung to. */
    otherTunes: readonly CatalogSongSummary[];
}

/** A song's words: the hymn's title, first line and other titles, and the other tunes it is sung to. */
export default function HymnCard({ hymn, otherTunes }: HymnCardProps) {
    return (
        <CatalogCard title="Hymn" headingId="hymn-heading">
            <dl className="space-y-4">
                <CardField label="Title">{hymn.title}</CardField>
                <CardField label="First line">
                    {hymn.firstLine ?? <NoValue>Not recorded</NoValue>}
                </CardField>
                <CardField label="Other titles">
                    {hymn.aliases.length > 0 ? (
                        <ul className="space-y-1">
                            {hymn.aliases.map((alias) => (
                                <li key={alias}>{alias}</li>
                            ))}
                        </ul>
                    ) : (
                        <NoValue>None</NoValue>
                    )}
                </CardField>
                <CardField label="Also sung to">
                    <RelatedSongs
                        songs={otherTunes}
                        by="tune"
                        empty="No other tune in the catalog"
                    />
                </CardField>
            </dl>
        </CatalogCard>
    );
}
