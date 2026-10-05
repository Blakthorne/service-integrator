"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { unlinkSongAction, type LinkActionState } from "@/app/(app)/catalog/reconcile/actions";
import Dialog from "@/app/components/ui/Dialog";
import LocalTime from "@/app/components/ui/LocalTime";
import SubmitButton from "@/app/components/ui/SubmitButton";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import { formatLastScheduled } from "@/lib/catalog/lastScheduled";
import { LINK_SOURCE_DESCRIPTIONS, LINK_SOURCE_LABELS } from "@/lib/catalog/linkText";
import { createdSongStage, describeCreatedSong } from "@/lib/catalog/newPcoSong";
import type { MirroredPcoSong, SongLinkSource } from "@/lib/domain";
import { IDLE_FORM, formStateKey } from "@/lib/forms";
import { routes } from "@/lib/routes";
import type { CreditSettings } from "@/lib/settings";
import CatalogCard, { CardField, NoValue } from "../CatalogCard";
import PcoSongWebLink from "../Reconcile/PcoSongWebLink";
import AddToPlanAction from "./AddToPlanAction";
import CreatePcoSongForm, { type CreatedPcoSong } from "./CreatePcoSongForm";
import { WARNING_CLASS } from "./styles";

/**
 * The card's links to Reconcile, each in a line of text: underlined, since
 * their colour alone is under 3:1 against the text around them.
 */
const TEXT_LINK_CLASS =
    "text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300";

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
    /** The catalog song's label, "Amazing Grace (NEW BRITAIN)", for the confirmations. */
    songLabel: string;
    /** The song's link, or null when it is not linked. */
    link: SongPcoLink | null;
    /** The title "Create in Planning Center" starts with, for a song that is not linked (`pcoSongTitleFor`). */
    newPcoSongTitle: string;
    /** The credit roles and their phrases, for the create form's credits. */
    creditSettings: CreditSettings;
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
 * What the card says after something done on it changed the link: the song
 * just unlinked, or the song just created in Planning Center, with what did
 * not go as planned. Nothing otherwise.
 */
function CardNoticeText({
    unlinkedTitle,
    created,
    stage,
}: {
    unlinkedTitle: string | null;
    created: CreatedPcoSong | null;
    stage: ReturnType<typeof createdSongStage>;
}) {
    if (created !== null && stage !== null) {
        return (
            <>
                <p className="text-gray-900 dark:text-gray-100">{describeCreatedSong(created.title, stage)}</p>
                {created.warnings.length > 0 && (
                    <ul className={`mt-2 list-disc pl-8 ${WARNING_CLASS}`}>
                        {created.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                )}
                {stage === "not-linked" && (
                    <p className="mt-2 text-gray-700 dark:text-gray-300">
                        The song is in Planning Center: do not create it again.{" "}
                        <Link href={routes.catalogReconcile()} className={TEXT_LINK_CLASS}>
                            Link it on Reconcile
                        </Link>{" "}
                        once the next sync has read it.
                    </p>
                )}
            </>
        );
    }
    if (unlinkedTitle !== null) {
        return (
            <p className="text-gray-900 dark:text-gray-100">Unlinked from &ldquo;{unlinkedTitle}&rdquo;.</p>
        );
    }
    return null;
}

/**
 * The song page's Planning Center card. For a linked song: the Planning
 * Center song (its title, author, copyright and when it was last scheduled,
 * as the app's copy of the library has them, and a link to it in Planning
 * Center), how and when the link was made, "Add to a plan…" (for a song
 * still in Planning Center) and Unlink, confirmed in a dialog. For a song
 * that is not linked: a link to Reconcile, where links are made, and the
 * "Create in Planning Center" form.
 *
 * It is a client component so that it stays mounted when an action's
 * revalidation swaps its content, and can say what happened: after Unlink,
 * what was unlinked; after a create, the song created and any warning, also
 * while the page that shows the new link is on its way. Its notice sits at
 * the top of the card in either case, and takes focus when it appears,
 * rather than leave focus on the page's body when the button that had it
 * goes. Unlink's pending state is the dialog's submit button
 * (`useFormStatus`): it touches only the database (convention 15).
 */
export default function PcoLinkCard({
    songId,
    songLabel,
    link,
    newPcoSongTitle,
    creditSettings,
}: PcoLinkCardProps) {
    const [open, setOpen] = useState(false);
    /** The title of the Planning Center song just unlinked here, for the notice. */
    const [unlinkedTitle, setUnlinkedTitle] = useState<string | null>(null);
    /** The Planning Center song just created here, for the notice. */
    const [created, setCreated] = useState<CreatedPcoSong | null>(null);
    const unlinkButtonRef = useRef<HTMLButtonElement>(null);
    const noticeRef = useRef<HTMLDivElement>(null);
    const pcoTitle = link?.pcoSong?.title ?? `Planning Center song ${link?.pcoSongId ?? ""}`;

    const [state, action] = useActionState(
        async (previous: LinkActionState, formData: FormData): Promise<LinkActionState> => {
            const next = await unlinkSongAction(previous, formData);
            if (next.status === "success") {
                startTransition(() => {
                    setUnlinkedTitle(pcoTitle);
                    setCreated(null);
                    setOpen(false);
                });
            }
            return next;
        },
        IDLE_FORM
    );

    const stage = createdSongStage(created, link?.pcoSongId ?? null);
    const unlinked = link === null && unlinkedTitle !== null && stage === null;
    // What the notice says, as a key: a new one moves focus to it.
    const noticeKey = stage !== null ? `created-${stage}` : unlinked ? "unlinked" : null;
    useEffect(() => {
        if (noticeKey !== null) {
            noticeRef.current?.focus();
        }
    }, [noticeKey]);

    return (
        <CatalogCard
            title="Planning Center"
            headingId={HEADING_ID}
            action={link && <PcoSongWebLink pcoSongId={link.pcoSongId} />}
        >
            <div className="space-y-4">
                <div
                    ref={noticeRef}
                    tabIndex={-1}
                    role="status"
                    className={noticeKey === null ? "sr-only" : "focus:outline-none"}
                >
                    <CardNoticeText
                        unlinkedTitle={unlinked ? unlinkedTitle : null}
                        created={created}
                        stage={stage}
                    />
                </div>
                {link === null ? (
                    stage === null && (
                        <>
                            <p className="text-gray-700 dark:text-gray-300">
                                Not in Planning Center.{" "}
                                <Link href={routes.catalogReconcile()} className={TEXT_LINK_CLASS}>
                                    Link it on Reconcile
                                </Link>
                                , or create it in Planning Center below.
                            </p>
                            <hr className="border-gray-200 dark:border-gray-700" />
                            <CreatePcoSongForm
                                songId={songId}
                                title={newPcoSongTitle}
                                settings={creditSettings}
                                onCreated={(song) => {
                                    setUnlinkedTitle(null);
                                    setCreated(song);
                                }}
                            />
                        </>
                    )
                ) : (
                    <>
                        <dl className="grid gap-4 sm:grid-cols-2">
                            <LinkedSongFields link={link} />
                            <CardField label="Link">
                                <LinkSource linkedBy={link.linkedBy} linkedAt={link.linkedAt} />
                            </CardField>
                        </dl>
                        <div className="flex flex-wrap gap-3">
                            {!link.pcoSong?.removedAt && (
                                <AddToPlanAction
                                    pcoSongId={link.pcoSongId}
                                    songLabel={songLabel}
                                    pcoTitle={pcoTitle}
                                />
                            )}
                            <button
                                ref={unlinkButtonRef}
                                type="button"
                                onClick={() => setOpen(true)}
                                className={buttonClasses("secondary")}
                            >
                                Unlink
                            </button>
                        </div>
                    </>
                )}
            </div>

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
                                className={buttonClasses("secondary")}
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
