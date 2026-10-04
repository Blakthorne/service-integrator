import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogCard from "@/app/components/Catalog/CatalogCard";
import SongsTable from "@/app/components/Catalog/Songs/SongsTable";
import TuneDetailsCard from "@/app/components/Catalog/Tunes/TuneDetailsCard";
import PageHeader from "@/app/components/ui/PageHeader";
import { parseCatalogId } from "@/lib/catalog/ids";
import { formatCountOf } from "@/lib/catalog/summary";
import { getCatalogTune, getCatalogTuneLabel } from "@/lib/queries/catalog";
import { routes } from "@/lib/routes";

type CatalogTunePageProps = PageProps<"/catalog/tunes/[tuneId]">;

/**
 * The tab title, the tune's name. `getCatalogTuneLabel` never throws, and
 * gives "Tune" for an ID that is invalid or unknown (convention 12).
 */
export async function generateMetadata({
    params,
}: Pick<CatalogTunePageProps, "params">): Promise<Metadata> {
    const { tuneId } = await params;
    return { title: getCatalogTuneLabel(tuneId) };
}

/**
 * A tune: its name, meter and other names, and its songs (one per hymn sung
 * to it), each linking to the song's page with its entry labels. An ID that
 * is not a catalog ID, or that no tune has, ends in `not-found.tsx`. It
 * reads only the local database, so it has no `loading.tsx`.
 */
export default async function CatalogTunePage({ params }: CatalogTunePageProps) {
    const tuneId = parseCatalogId((await params).tuneId) ?? notFound();
    const tune = getCatalogTune(tuneId) ?? notFound();

    return (
        <>
            <PageHeader
                title={tune.name}
                description={tune.meter ?? undefined}
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Tunes", href: routes.catalogTunes() },
                    { label: tune.name },
                ]}
            />
            <div className="space-y-6">
                <TuneDetailsCard tune={tune} />
                <CatalogCard
                    title="Songs"
                    headingId="songs-heading"
                    action={
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {formatCountOf(tune.songs.length, {
                                one: "song",
                                other: "songs",
                            })}
                        </span>
                    }
                    flush
                >
                    <SongsTable
                        rows={tune.songs}
                        caption={`Songs to ${tune.name}`}
                        showTune={false}
                        emptyMessage="No song uses this tune."
                    />
                </CatalogCard>
            </div>
        </>
    );
}
