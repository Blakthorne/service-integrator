import Link from "next/link";
import type { FieldError } from "@/lib/forms";
import type { NewSongPcoSong } from "@/lib/queries/catalogEdit";
import { routes } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";
import { FieldErrorText, FormNotice } from "./Fields";

interface PcoSongNoticeProps {
    /** The Planning Center song the form was opened for. */
    pcoSong: NewSongPcoSong;
    /** Why the action could not link it, if it could not. */
    error: FieldError | undefined;
}

/** "Amazing Grace" with its author, as the notice names the Planning Center song. */
function SongName({ pcoSong }: { pcoSong: NewSongPcoSong }) {
    return (
        <>
            <strong className="font-semibold">{pcoSong.title}</strong>
            {pcoSong.author && <> ({pcoSong.author})</>}
        </>
    );
}

/**
 * The Planning Center song the form was opened for, above its fields: the
 * new song will be linked to it, or, when it is linked to another catalog
 * song already or deleted from Planning Center, why it will not be. The
 * action's refusal to link, if any, shows here too.
 */
export default function PcoSongNotice({ pcoSong, error }: PcoSongNoticeProps) {
    if (pcoSong.linkedTo) {
        return (
            <FormNotice tone="warning">
                <p>
                    The Planning Center song <SongName pcoSong={pcoSong} /> is linked to{" "}
                    {/* Default prefetch: a song's page reads only the local database. */}
                    <Link href={routes.catalogSong(pcoSong.linkedTo.songId)} className={LINK_CLASS}>
                        {pcoSong.linkedTo.label}
                    </Link>{" "}
                    already, so the new song will not be linked to it.
                </p>
            </FormNotice>
        );
    }
    if (pcoSong.removed) {
        return (
            <FormNotice tone="warning">
                <p>
                    The Planning Center song <SongName pcoSong={pcoSong} /> has been deleted
                    from Planning Center, so the new song will not be linked to it.
                </p>
            </FormNotice>
        );
    }
    return (
        <FormNotice tone={error ? "warning" : "info"}>
            <p>
                The new song will be linked to the Planning Center song{" "}
                <SongName pcoSong={pcoSong} />.
            </p>
            <FieldErrorText id="link-error" error={error} />
        </FormNotice>
    );
}
