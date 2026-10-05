"use client";

import { useEffect, useRef, useState } from "react";
import {
    addHymnAliasAction,
    editHymnAction,
    listHymnOptionsAction,
    mergeHymnsAction,
    previewHymnMergeAction,
    removeHymnAliasAction,
} from "@/app/(app)/catalog/songs/[songId]/editActions";
import { hymnMergeLanding } from "@/lib/catalog/mergeText";
import { describeHymnOption, searchHymnOptions, type HymnOption } from "@/lib/catalog/pickers";
import {
    FIRST_LINE_MAX_LENGTH,
    NOTES_MAX_LENGTH,
    TITLE_MAX_LENGTH,
} from "@/lib/catalog/validation";
import type { CatalogSongSummary, HymnWithAliases } from "@/lib/domain";
import CatalogCard, { CardField, NoValue } from "../CatalogCard";
import AliasesEditor from "./AliasesEditor";
import EditToggle from "./EditToggle";
import { StatusLine } from "./EditFields";
import MergePanel from "./MergePanel";
import NameDetailsForm, { type NameDetailsField } from "./NameDetailsForm";
import RelatedSongs from "./RelatedSongs";
import { mergeNoticeKey, takeMergeNotice } from "./mergeNotice";

interface HymnCardProps {
    /** The song whose page this is: a merge lands on the song it is afterwards. */
    songId: number;
    hymn: HymnWithAliases;
    /** The hymn's other songs: the other tunes it is sung to. */
    otherTunes: readonly CatalogSongSummary[];
}

const HYMN_FIELDS: readonly NameDetailsField[] = [
    { name: "title", label: "Title", maxLength: TITLE_MAX_LENGTH },
    {
        name: "firstLine",
        label: "First line",
        hint: "Optional: the words it starts with, when they are not the title.",
        maxLength: FIRST_LINE_MAX_LENGTH,
    },
    { name: "notes", label: "Notes", hint: "Optional.", maxLength: NOTES_MAX_LENGTH, multiline: true },
];

/** The id of the card's body, which the Edit button shows and hides the editor in. */
const BODY_ID = "hymn-card-body";

/**
 * A song's words: the hymn's title, first line, other titles and notes,
 * and the other tunes it is sung to. Edit turns the card into the hymn's
 * editor: its details (Save), its other titles (Add and Remove), and
 * "Merge this hymn into…". Done puts it away.
 *
 * The page keys it by the hymn, so a merge into another hymn that leaves
 * the page on this song (it moved) starts it afresh. On the page a merge
 * lands on, it says what was merged in its status region and moves focus
 * there (`mergeNotice`).
 */
export default function HymnCard({ songId, hymn, otherTunes }: HymnCardProps) {
    const [editing, setEditing] = useState(false);
    const [notice, setNotice] = useState("");
    const noticeRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        const message = takeMergeNotice(mergeNoticeKey("song", songId));
        if (message !== null) {
            setNotice(message);
        }
    }, [songId]);

    useEffect(() => {
        if (notice !== "") {
            noticeRef.current?.focus();
        }
    }, [notice]);

    return (
        <CatalogCard
            title="Hymn"
            headingId="hymn-heading"
            action={
                <EditToggle
                    editing={editing}
                    onToggle={() => {
                        setNotice("");
                        setEditing((current) => !current);
                    }}
                    what="the hymn"
                    controls={BODY_ID}
                />
            }
        >
            <div id={BODY_ID} className="space-y-4">
                <StatusLine text={notice} statusRef={noticeRef} />
                {editing ? (
                    <div className="space-y-6">
                        <NameDetailsForm
                            idPrefix="hymn"
                            idField={{ name: "hymnId", value: hymn.id }}
                            fields={HYMN_FIELDS}
                            initial={{
                                title: hymn.title,
                                firstLine: hymn.firstLine ?? "",
                                notes: hymn.notes ?? "",
                            }}
                            action={editHymnAction}
                            saveLabel="Save hymn"
                        />
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <AliasesEditor
                            kind="hymn"
                            idPrefix="hymn-aliases"
                            idField={{ name: "hymnId", value: hymn.id }}
                            aliases={hymn.aliases}
                            maxLength={TITLE_MAX_LENGTH}
                            addAlias={addHymnAliasAction}
                            removeAlias={removeHymnAliasAction}
                        />
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <MergePanel<HymnOption>
                            kind="hymn"
                            source={{ id: hymn.id, name: hymn.title }}
                            landing={(done) => hymnMergeLanding(done, songId)}
                            loadOptions={listHymnOptionsAction}
                            previewMerge={previewHymnMergeAction}
                            merge={mergeHymnsAction}
                            searchOptions={searchHymnOptions}
                            keyOf={(option) => option.id}
                            nameOf={(option) => option.title}
                            describe={describeHymnOption}
                        />
                    </div>
                ) : (
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
                        {hymn.notes !== null && (
                            <CardField label="Notes">
                                <span className="whitespace-pre-line">{hymn.notes}</span>
                            </CardField>
                        )}
                        <CardField label="Also sung to">
                            <RelatedSongs
                                songs={otherTunes}
                                by="tune"
                                empty="No other tune in the catalog"
                            />
                        </CardField>
                    </dl>
                )}
            </div>
        </CatalogCard>
    );
}
