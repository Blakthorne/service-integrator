import type { Metadata } from "next";
import SongForm from "@/app/components/Catalog/SongForm/SongForm";
import PageHeader from "@/app/components/ui/PageHeader";
import { parsePcoId } from "@/lib/pco";
import { getNewSongFormData } from "@/lib/queries/catalogEdit";
import { routes } from "@/lib/routes";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";

export const metadata: Metadata = { title: "New song" };

/** A query parameter's first value: it may be given several times, or not at all. */
function firstOf(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * The new-song form, the catalog's first form. Opened from Reconcile with
 * `?pcoSongId=` (checked by `parsePcoId`), it is prefilled from that
 * Planning Center song and links it to the song it adds; `?returnTo=`
 * (checked by `safeCallbackUrl`) is where it goes back to afterwards, else
 * the new song's page. A song the mirror lacks is read from Planning Center
 * first, so this page may wait for one request; otherwise it reads only the
 * local database, and has no `loading.tsx`.
 */
export default async function NewSongPage({ searchParams }: PageProps<"/catalog/songs/new">) {
    const query = await searchParams;
    const rawPcoSongId = firstOf(query.pcoSongId);
    const pcoSongId = parsePcoId(rawPcoSongId);
    const returnTo = safeCallbackUrl(firstOf(query.returnTo));
    const data = await getNewSongFormData(pcoSongId);

    return (
        <>
            <PageHeader
                title="New song"
                description={
                    data.pcoSong
                        ? `For the Planning Center song "${data.pcoSong.title}".`
                        : "A hymn sung to one tune, and where a book has it."
                }
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Songs", href: routes.catalog() },
                    { label: "New song" },
                ]}
            />
            <div className="max-w-2xl mx-auto">
                <SongForm
                    // A new Planning Center song starts a new form, not the
                    // last one's state.
                    key={pcoSongId ?? ""}
                    hymns={data.hymns}
                    tunes={data.tunes}
                    books={data.books}
                    draft={data.draft}
                    pcoSong={data.pcoSong}
                    pcoSongMissing={rawPcoSongId !== undefined && data.pcoSong === null}
                    returnTo={returnTo}
                />
            </div>
        </>
    );
}
