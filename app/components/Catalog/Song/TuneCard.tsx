import Link from "next/link";
import type { CatalogSongSummary, TuneWithAliases } from "@/lib/domain";
import { routes } from "@/lib/routes";
import CatalogCard, { CardField, LINK_CLASS, NoValue } from "../CatalogCard";
import RelatedSongs from "./RelatedSongs";

interface TuneCardProps {
    /** Null when the song's tune is unknown. */
    tune: TuneWithAliases | null;
    /** The tune's other songs: the other hymns sung to it. */
    otherHymns: readonly CatalogSongSummary[];
}

/**
 * A song's melody: the tune's name (a link to its page), meter and other
 * names, and the other hymns sung to it.
 */
export default function TuneCard({ tune, otherHymns }: TuneCardProps) {
    if (tune === null) {
        return (
            <CatalogCard title="Tune" headingId="tune-heading">
                <p className="text-gray-600 dark:text-gray-300">
                    No tune is recorded for this song.
                </p>
            </CatalogCard>
        );
    }

    return (
        <CatalogCard title="Tune" headingId="tune-heading">
            <dl className="space-y-4">
                <CardField label="Name">
                    {/* Default prefetch: a tune's page reads only the local database. */}
                    <Link href={routes.catalogTune(tune.id)} className={LINK_CLASS}>
                        {tune.name}
                    </Link>
                </CardField>
                <CardField label="Meter">
                    {tune.meter ?? <NoValue>Not recorded</NoValue>}
                </CardField>
                <CardField label="Other names">
                    {tune.aliases.length > 0 ? (
                        <ul className="space-y-1">
                            {tune.aliases.map((alias) => (
                                <li key={alias}>{alias}</li>
                            ))}
                        </ul>
                    ) : (
                        <NoValue>None</NoValue>
                    )}
                </CardField>
                <CardField label="Other hymns to this tune">
                    <RelatedSongs
                        songs={otherHymns}
                        by="title"
                        empty="No other hymn in the catalog"
                    />
                </CardField>
            </dl>
        </CatalogCard>
    );
}
