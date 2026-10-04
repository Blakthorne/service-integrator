"use client";

import { useRef, useState } from "react";
import {
    saveSongTagsAction,
    type SaveSongTagsState,
} from "@/app/(app)/catalog/songs/[songId]/actions";
import {
    NO_SONG_TAGS,
    chooseTag,
    clearTagGroup,
    describeTagsSave,
    sameTagSelection,
    songTagLines,
    songTagSelection,
    tagGroupHint,
} from "@/lib/catalog/tagsEditor";
import type { PcoTag, PcoTagGroup } from "@/lib/domain";
import { formStateKey } from "@/lib/forms";
import CatalogCard, { NoValue } from "../CatalogCard";
import { HINT_CLASS } from "../SongForm/Fields";
import PendingButton from "./PendingButton";
import { ALERT_CLASS, DONE_CLASS, WARNING_CLASS } from "./styles";

/** What the card says when its action never answered: Planning Center may have the new tags, or not. */
const TAGS_NO_ANSWER =
    "The server did not answer, so the tags may or may not have been saved. Reload the page to see what the app has, and look at the song in Planning Center.";

/** A checkbox or radio button, in the app's blue, as the Settings checkbox is. */
const CHOICE_CLASS = "size-4 shrink-0 cursor-pointer accent-blue-600";

interface TagChoiceProps {
    /** "checkbox" for a group that takes any number of its tags, "radio" for one that takes one. */
    type: "checkbox" | "radio";
    /** The radio group's name; ignored for a checkbox. */
    name: string;
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
}

/** One tag, or a one-tag group's "None", as a labelled checkbox or radio button. */
function TagChoice({ type, name, label, checked, disabled, onChange }: TagChoiceProps) {
    return (
        <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
            <input
                type={type}
                name={type === "radio" ? name : undefined}
                checked={checked}
                // Not `disabled`, which would drop focus and grey the box
                // while a save runs; a change then is ignored.
                aria-disabled={disabled || undefined}
                onChange={(event) => {
                    if (!disabled) {
                        onChange(event.target.checked);
                    }
                }}
                className={CHOICE_CLASS}
            />
            {label}
        </label>
    );
}

interface TagGroupFieldsProps {
    group: PcoTagGroup;
    groups: readonly PcoTagGroup[];
    selection: readonly string[];
    disabled: boolean;
    onChange: (selection: string[]) => void;
}

/**
 * One tag group's choices, as Planning Center allows: a checkbox per tag for
 * a group that takes any number, a radio button per tag and "None" for one
 * that takes one.
 */
function TagGroupFields({ group, groups, selection, disabled, onChange }: TagGroupFieldsProps) {
    const chosen = new Set(selection);
    const hintId = `tag-group-${group.id}-hint`;
    const type = group.allowMultiple ? "checkbox" : "radio";
    const name = `tag-group-${group.id}`;
    return (
        // min-w-0: a fieldset is otherwise as wide as its widest content.
        <fieldset aria-describedby={hintId} className="min-w-0">
            <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.name}</legend>
            <p id={hintId} className={`mt-0.5 ${HINT_CLASS}`}>
                {tagGroupHint(group)}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {!group.allowMultiple && (
                    <TagChoice
                        type="radio"
                        name={name}
                        label="None"
                        checked={group.tags.every(({ id }) => !chosen.has(id))}
                        disabled={disabled}
                        onChange={(checked) => {
                            if (checked) {
                                onChange(clearTagGroup(selection, groups, group));
                            }
                        }}
                    />
                )}
                {group.tags.map((tag) => (
                    <TagChoice
                        key={tag.id}
                        type={type}
                        name={name}
                        label={tag.name}
                        checked={chosen.has(tag.id)}
                        disabled={disabled}
                        onChange={(checked) => onChange(chooseTag(selection, groups, group, tag.id, checked))}
                    />
                ))}
            </div>
        </fieldset>
    );
}

interface TagsCardProps {
    /** The linked Planning Center song's id. */
    pcoSongId: string;
    /** Planning Center's song tag groups, as the app's copy has them: by name, each with its tags by name. */
    groups: PcoTagGroup[];
    /** The song's tags, as the app's copy has them. */
    songTags: PcoTag[];
    /** False for a song deleted from Planning Center: its tags are shown, and cannot be saved. */
    editable: boolean;
}

/**
 * The Tags card of a song linked to Planning Center: its tags, by group, as
 * the app's copy of Planning Center's tags has them, then an editor per
 * song tag group, which respects the group's choice (any number of its
 * tags, or one), and Save. Before the tags sync has brought any tags, it
 * says so.
 *
 * Save sends the song's whole set of tags (`saveSongTagsAction`, which keeps
 * any tag Planning Center has that the app does not know yet), called from
 * its click with its pending state in `useState` (convention 15). It then
 * says what the song's tags are now, or why nothing was saved, in an alert
 * keyed per attempt; focus stays on Save. The choices are this card's
 * state: a revalidation updates the list above them and never the choices.
 */
export default function TagsCard({ pcoSongId, groups, songTags, editable }: TagsCardProps) {
    const shownGroups = groups.filter((group) => group.tags.length > 0);
    const [selection, setSelection] = useState(() => songTagSelection(shownGroups, songTags));
    const [result, setResult] = useState<SaveSongTagsState | null>(null);
    /** The tags the last save left on the song, while "Saved." is true. */
    const [savedSelection, setSavedSelection] = useState<string[] | null>(null);
    const [pending, setPending] = useState(false);
    // Read by the click, which may come again before a render shows `pending`.
    const saving = useRef(false);

    const lines = songTagLines(shownGroups, songTags);
    const saved =
        result?.ok === true && savedSelection !== null && sameTagSelection(selection, savedSelection);

    async function save() {
        if (saving.current) {
            return;
        }
        saving.current = true;
        setPending(true);
        try {
            const next = await saveSongTagsAction(pcoSongId, selection);
            setResult(next);
            if (next.ok) {
                setSavedSelection(selection);
            }
        } catch (error) {
            console.error("Saving the tags failed:", error);
            setResult({ ok: false, message: TAGS_NO_ANSWER });
        } finally {
            saving.current = false;
            setPending(false);
        }
    }

    if (shownGroups.length === 0) {
        return (
            <CatalogCard title="Tags" headingId="tags-heading">
                <p className="text-gray-700 dark:text-gray-300">{NO_SONG_TAGS}</p>
            </CatalogCard>
        );
    }

    return (
        <CatalogCard title="Tags" headingId="tags-heading">
            <div className="space-y-4">
                <dl className="space-y-1">
                    {lines.length === 0 ? (
                        <div>
                            <dt className="sr-only">In Planning Center</dt>
                            <dd>
                                <NoValue>No tags in Planning Center.</NoValue>
                            </dd>
                        </div>
                    ) : (
                        lines.map((line) => (
                            <div key={line.groupId} className="flex flex-wrap gap-x-2">
                                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    {line.group}:
                                </dt>
                                <dd className="text-sm text-gray-900 dark:text-gray-100">
                                    {line.tags.join(", ")}
                                </dd>
                            </div>
                        ))
                    )}
                </dl>
                {editable ? (
                    <>
                        <div className="space-y-4">
                            {shownGroups.map((group) => (
                                <TagGroupFields
                                    key={group.id}
                                    group={group}
                                    groups={shownGroups}
                                    selection={selection}
                                    disabled={pending}
                                    onChange={setSelection}
                                />
                            ))}
                        </div>
                        {result?.ok === false && (
                            // A new key per attempt: a repeated refusal is announced again.
                            <p key={formStateKey(result)} role="alert" className={ALERT_CLASS}>
                                {result.message}
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <PendingButton pending={pending} pendingLabel="Saving…" onClick={() => void save()}>
                                Save tags
                            </PendingButton>
                            {saved && result?.ok === true && (
                                <p key={formStateKey(result)} role="status" className={DONE_CLASS}>
                                    {describeTagsSave(result, shownGroups)}
                                </p>
                            )}
                        </div>
                    </>
                ) : (
                    <p className={WARNING_CLASS}>
                        This song was deleted from Planning Center, so its tags cannot be changed here.
                    </p>
                )}
            </div>
        </CatalogCard>
    );
}
