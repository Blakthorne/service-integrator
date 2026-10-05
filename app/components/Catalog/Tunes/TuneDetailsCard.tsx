"use client";

import { useEffect, useRef, useState } from "react";
import {
    addTuneAliasAction,
    editTuneAction,
    listTuneOptionsAction,
    mergeTunesAction,
    previewTuneMergeAction,
    removeTuneAliasAction,
} from "@/app/(app)/catalog/tunes/[tuneId]/actions";
import { tuneMergeLanding } from "@/lib/catalog/mergeText";
import { describeTuneOption, searchTuneOptions, type TuneOption } from "@/lib/catalog/pickers";
import { METER_MAX_LENGTH, NOTES_MAX_LENGTH, TUNE_NAME_MAX_LENGTH } from "@/lib/catalog/validation";
import type { TuneWithAliases } from "@/lib/domain";
import CatalogCard, { CardField, NoValue } from "../CatalogCard";
import AliasesEditor from "../Song/AliasesEditor";
import EditToggle from "../Song/EditToggle";
import { StatusLine } from "../Song/EditFields";
import MergePanel from "../Song/MergePanel";
import NameDetailsForm, { type NameDetailsField } from "../Song/NameDetailsForm";
import { mergeNoticeKey, takeMergeNotice } from "../Song/mergeNotice";

interface TuneDetailsCardProps {
    tune: TuneWithAliases;
}

const TUNE_FIELDS: readonly NameDetailsField[] = [
    { name: "name", label: "Name", hint: "As the hymnals print it, such as ST. ANNE.", maxLength: TUNE_NAME_MAX_LENGTH },
    { name: "meter", label: "Meter", hint: "Optional, such as C.M. or 8.7.8.7 D.", maxLength: METER_MAX_LENGTH },
    { name: "notes", label: "Notes", hint: "Optional.", maxLength: NOTES_MAX_LENGTH, multiline: true },
];

/** The id of the card's body, which the Edit button shows and hides the editor in. */
const BODY_ID = "tune-card-body";

/**
 * A tune's page card: its name, meter, other names and notes. Edit turns it
 * into the tune's editor, as the song page's Hymn card does for a hymn: the
 * tune's details (Save), its other names (Add, and Remove beside each), and
 * "Merge this tune into…", whose merge lands on the target tune's page.
 * There it says what was merged in its status region and takes focus
 * (`mergeNotice`).
 */
export default function TuneDetailsCard({ tune }: TuneDetailsCardProps) {
    const [editing, setEditing] = useState(false);
    const [notice, setNotice] = useState("");
    const noticeRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        const message = takeMergeNotice(mergeNoticeKey("tune", tune.id));
        if (message !== null) {
            setNotice(message);
        }
    }, [tune.id]);

    useEffect(() => {
        if (notice !== "") {
            noticeRef.current?.focus();
        }
    }, [notice]);

    return (
        <CatalogCard
            title="Tune"
            headingId="tune-heading"
            action={
                <EditToggle
                    editing={editing}
                    onToggle={() => {
                        setNotice("");
                        setEditing((current) => !current);
                    }}
                    what="the tune"
                    controls={BODY_ID}
                />
            }
        >
            <div id={BODY_ID} className="space-y-4">
                <StatusLine text={notice} statusRef={noticeRef} />
                {editing ? (
                    <div className="space-y-6">
                        <NameDetailsForm
                            idPrefix="tune"
                            idField={{ name: "tuneId", value: tune.id }}
                            fields={TUNE_FIELDS}
                            initial={{ name: tune.name, meter: tune.meter ?? "", notes: tune.notes ?? "" }}
                            action={editTuneAction}
                            saveLabel="Save tune"
                        />
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <AliasesEditor
                            kind="tune"
                            idPrefix="tune-aliases"
                            idField={{ name: "tuneId", value: tune.id }}
                            aliases={tune.aliases}
                            maxLength={TUNE_NAME_MAX_LENGTH}
                            addAlias={addTuneAliasAction}
                            removeAlias={removeTuneAliasAction}
                        />
                        <hr className="border-gray-200 dark:border-gray-700" />
                        <MergePanel<TuneOption>
                            kind="tune"
                            source={{ id: tune.id, name: tune.name }}
                            landing={tuneMergeLanding}
                            loadOptions={listTuneOptionsAction}
                            previewMerge={previewTuneMergeAction}
                            merge={mergeTunesAction}
                            searchOptions={searchTuneOptions}
                            keyOf={(option) => option.id}
                            nameOf={(option) => option.name}
                            describe={describeTuneOption}
                        />
                    </div>
                ) : (
                    <>
                        <dl className="grid gap-4 sm:grid-cols-3">
                            <CardField label="Name">{tune.name}</CardField>
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
                        </dl>
                        {tune.notes !== null && (
                            <dl>
                                <CardField label="Notes">
                                    <span className="whitespace-pre-line">{tune.notes}</span>
                                </CardField>
                            </dl>
                        )}
                    </>
                )}
            </div>
        </CatalogCard>
    );
}
