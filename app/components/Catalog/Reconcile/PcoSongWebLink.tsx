import { pcoWebUrls } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";

interface PcoSongWebLinkProps {
    /** The Planning Center song's id, as the mirror has it (`parsePcoId` checked it before it was stored). */
    pcoSongId: string;
    /** The link's text; "Open in Planning Center" by default. */
    children?: React.ReactNode;
}

/** A text link to a song's page in the Planning Center web app, in a new tab. */
export default function PcoSongWebLink({
    pcoSongId,
    children = "Open in Planning Center",
}: PcoSongWebLinkProps) {
    return (
        <a
            href={pcoWebUrls.song(pcoSongId)}
            target="_blank"
            rel="noopener noreferrer"
            className={`whitespace-nowrap ${LINK_CLASS}`}
        >
            {children}
            <span aria-hidden="true"> ↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
        </a>
    );
}
