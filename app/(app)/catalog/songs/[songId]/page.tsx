import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SongDetailView from "@/app/components/Catalog/Song/SongDetailView";
import PageHeader from "@/app/components/ui/PageHeader";
import { parseCatalogId } from "@/lib/catalog/ids";
import {
    getCatalogBooks,
    getCatalogSong,
    getCatalogSongLabel,
} from "@/lib/queries/catalog";
import { getMirroredPcoSong } from "@/lib/queries/catalogEdit";
import { getSettings } from "@/lib/queries/settings";
import { getPcoSongTags, getSongTagGroups } from "@/lib/queries/tags";
import { routes } from "@/lib/routes";

type CatalogSongPageProps = PageProps<"/catalog/songs/[songId]">;

/**
 * The tab title, "Amazing Grace (NEW BRITAIN)". `getCatalogSongLabel` never
 * throws, and gives "Song" for an ID that is invalid or unknown (convention 12).
 */
export async function generateMetadata({
    params,
}: Pick<CatalogSongPageProps, "params">): Promise<Metadata> {
    const { songId } = await params;
    return { title: getCatalogSongLabel(songId) };
}

/**
 * A catalog song: where it is in the books, its hymn and its tune, and the
 * Planning Center song it is linked to, as the app's copy of the library
 * has it, with its credits and tags. An ID that is not a catalog ID, or
 * that no song has, ends in `not-found.tsx`.
 *
 * The page reads only the local database (the settings never throw), so it
 * has no `loading.tsx`: a link to it keeps the previous page on screen until
 * it is ready, and a prefetch of it costs no Planning Center request. What
 * writes to Planning Center is a server action, called from a click.
 */
export default async function CatalogSongPage({ params }: CatalogSongPageProps) {
    const songId = parseCatalogId((await params).songId) ?? notFound();
    const song = getCatalogSong(songId) ?? notFound();
    const books = getCatalogBooks();
    const pcoSong = song.pcoSongId === null ? null : getMirroredPcoSong(song.pcoSongId);
    const { creditRoles, creditPhrases } = getSettings().settings;
    const linked = song.pcoSongId !== null && pcoSong !== null;
    const tagGroups = linked ? getSongTagGroups() : [];
    const songTags = linked && song.pcoSongId !== null ? getPcoSongTags(song.pcoSongId) : [];
    const tune = song.tune;

    return (
        <div className="w-full max-w-4xl mx-auto">
            <PageHeader
                title={song.hymn.title}
                description={
                    tune === null
                        ? "Tune not recorded"
                        : [tune.name, tune.meter].filter(Boolean).join(" · ")
                }
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Songs", href: routes.catalog() },
                    { label: song.hymn.title },
                ]}
            />
            <SongDetailView
                song={song}
                books={books}
                pcoSong={pcoSong}
                creditSettings={{ creditRoles, creditPhrases }}
                tagGroups={tagGroups}
                songTags={songTags}
            />
        </div>
    );
}
