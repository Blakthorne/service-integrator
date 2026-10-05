"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { unlinkSongAction, type LinkActionState } from "@/app/(app)/catalog/reconcile/actions";
import Dialog from "@/app/components/ui/Dialog";
import LocalTime from "@/app/components/ui/LocalTime";
import SubmitButton from "@/app/components/ui/SubmitButton";
import { formatLastScheduled } from "@/lib/catalog/lastScheduled";
import { LINK_SOURCE_DESCRIPTIONS, LINK_SOURCE_LABELS } from "@/lib/catalog/linkText";
import type { MirroredPcoSong, SongLinkSource } from "@/lib/domain";
import { IDLE_FORM, formStateKey } from "@/lib/forms";
import { routes } from "@/lib/routes";
import CatalogCard, { CardField, LINK_CLASS, NoValue } from "../CatalogCard";
import PcoSongWebLink from "../Reconcile/PcoSongWebLink";

/** A catalog song's link to Planning Center, as its page shows it. */
export interface SongPcoLink {
    pcoSongId: string;
    linkedBy: SongLinkSource | null;
    linkedAt: string | null;
    /** The linked song as the mirror has it; null when the mirror lacks it. */
    pcoSong: MirroredPcoSong | null;
}

interface PcoLinkCardProps {
    songId: number;
    /** The catalog song's label, "Amazing Grace (NEW BRITAIN)", for the confirmation. */
    songLabel: string;
    /** The song's link, or null when it is not linked. */
    link: SongPcoLink | null;
}

/** The id of the card's heading. */
const HEADING_ID = "pco-link-heading";

/** How the link was made: a small tag, with its full wording beside it. */
function LinkSource({ linkedBy, linkedAt }: Pick<SongPcoLink, "linkedBy" | "linkedAt">) {
    return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {linkedBy && (
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                    {LINK_SOURCE_LABELS[linkedBy]}
                </span>
            )}
            <span>
                {linkedBy ? LINK_SOURCE_DESCRIPTIONS[linkedBy] : "Linked"}
                {linkedAt && (
                    <>
                        , <LocalTime iso={linkedAt} />
                    </>
                )}
            </span>
        </span>
    );
}

/** The linked Planning Center song's fields, as the mirror has them. */
function LinkedSongFields({ link }: { link: SongPcoLink }) {
    const { pcoSong } = link;
    if (pcoSong === null) {
        return (
            <CardField label="Song">
                Planning Center song {link.pcoSongId}{" "}
                <NoValue>(not in the app&apos;s copy of the library yet: Sync now reads it)</NoValue>
            </CardField>
        );
    }
    const scheduled = formatLastScheduled(pcoSong.lastScheduledAt);
    return (
        <>
            <CardField label="Song">
                {pcoSong.title}
                {pcoSong.removedAt && (
                    <span className="block text-sm text-amber-700 dark:text-amber-300">
                        Deleted from Planning Center, <LocalTime iso={pcoSong.removedAt} />
                    </span>
                )}
                {pcoSong.hidden && <NoValue> (hidden in Planning Center)</NoValue>}
            </CardField>
            <CardField label="Author">
                {pcoSong.author ?? <NoValue>Not recorded</NoValue>}
            </CardField>
            <CardField label="Copyright">
                {pcoSong.copyright ?? <NoValue>Not recorded</NoValue>}
            </CardField>
            <CardField label="Last scheduled">
                {scheduled ?? <NoValue>Never</NoValue>}
            </CardField>
        </>
    );
}

/**
 * The song page's Planning Center card: the Planning Center song the
 * catalog song is linked to (its title, author, copyright and when it was
 * last scheduled, as the app's copy of the library has them, and a link to
 * it in Planning Center), how and when the link was made, and Unlink,
 * confirmed in a dialog. A song that is not linked says so, with a link to
 * Reconcile, where links are made.
 *
 * It is a client component so that it stays mounted when Unlink's
 * revalidation swaps its content: it then says what was unlinked, and moves
 * focus there rather than leave it on the page's body. Unlink's pending
 * state is the dialog's submit button (`useFormStatus`).
 */
export default function PcoLinkCard({ songId, songLabel, link }: PcoLinkCardProps) {
    const [open, setOpen] = useState(false);
    /** The title of the Planning Center song just unlinked here, for the notice. */
    const [unlinkedTitle, setUnlinkedTitle] = useState<string | null>(null);
    const unlinkButtonRef = useRef<HTMLButtonElement>(null);
    const noticeRef = useRef<HTMLParagraphElement>(null);
    const pcoTitle = link?.pcoSong?.title ?? `Planning Center song ${link?.pcoSongId ?? ""}`;

    const [state, action] = useActionState(
        async (previous: LinkActionState, formData: FormData): Promise<LinkActionState> => {
            const next = await unlinkSongAction(previous, formData);
            if (next.status === "success") {
                startTransition(() => {
                    setUnlinkedTitle(pcoTitle);
                    setOpen(false);
                });
            }
            return next;
        },
        IDLE_FORM
    );

    const showNotice = link === null && unlinkedTitle !== null;
    useEffect(() => {
        if (showNotice) {
            noticeRef.current?.focus();
        }
    }, [showNotice]);

    return (
        <CatalogCard
            title="Planning Center"
            headingId={HEADING_ID}
            action={link && <PcoSongWebLink pcoSongId={link.pcoSongId} />}
        >
            {link === null ? (
                <p
                    ref={noticeRef}
                    tabIndex={-1}
                    role={showNotice ? "status" : undefined}
                    className="text-gray-700 dark:text-gray-300 focus:outline-none"
                >
                    {showNotice ? (
                        <>Unlinked from &ldquo;{unlinkedTitle}&rdquo;. This song is not in Planning Center now.</>
                    ) : (
                        <>Not in Planning Center.</>
                    )}{" "}
                    <Link href={routes.catalogReconcile()} className={LINK_CLASS}>
                        Link it on Reconcile
                    </Link>
                </p>
            ) : (
                <div className="space-y-4">
                    <dl className="grid gap-4 sm:grid-cols-2">
                        <LinkedSongFields link={link} />
                        <CardField label="Link">
                            <LinkSource linkedBy={link.linkedBy} linkedAt={link.linkedAt} />
                        </CardField>
                    </dl>
                    <button
                        ref={unlinkButtonRef}
                        type="button"
                        onClick={() => setOpen(true)}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                    >
                        Unlink
                    </button>
                </div>
            )}

            {link && (
                <Dialog
                    open={open}
                    onClose={() => setOpen(false)}
                    title="Unlink from Planning Center?"
                    description={`"${songLabel}" will no longer be linked to the Planning Center song "${pcoTitle}". Plan pages will not show its numbers for that song, and no sync will link the two again; you can link them by hand on Reconcile.`}
                    returnFocusRef={unlinkButtonRef}
                >
                    <form action={action}>
                        <input type="hidden" name="songId" value={songId} />
                        <input type="hidden" name="pcoSongId" value={link.pcoSongId} />
                        {state.status === "error" && (
                            // A new key per attempt: a repeated refusal is announced again.
                            <p
                                key={formStateKey(state)}
                                role="alert"
                                className="mb-4 text-sm text-red-600 dark:text-red-400"
                            >
                                {state.message}
                            </p>
                        )}
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <SubmitButton variant="danger" pendingLabel="Unlinking…">
                                Unlink
                            </SubmitButton>
                        </div>
                    </form>
                </Dialog>
            )}
        </CatalogCard>
    );
}
