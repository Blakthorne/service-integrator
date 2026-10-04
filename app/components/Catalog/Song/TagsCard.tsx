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
    describeTagChanges,
    describeTagsSave,
    sameTagSelection,
    songTagLines,
    songTagSelection,
    tagChanges,
    tagGroupHint,
} from "@/lib/catalog/tagsEditor";
import type { PcoTag, PcoTagGroup } from "@/lib/domain";
import { formStateKey } from "@/lib/forms";
import CatalogCard, { NoValue } from "../CatalogCard";
import { HINT_CLASS } from "../SongForm/Fields";
import PendingButton from "./PendingButton";
import { ALERT_CLASS, DONE_CLASS, SMALL_BUTTON_CLASS, WARNING_CLASS } from "./styles";

/** The id of the line that says what Save will change, which describes Save. */
const CHANGES_ID = "song-tags-changes";

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

/** After a refusal because the tags changed in Planning Center: load the page again, to show them afresh. */
function ReloadPageButton() {
    return (
        <button type="button" onClick={() => window.location.reload()} className={SMALL_BUTTON_CLASS}>
            Reload the page
        </button>
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
 * Beside Save it says what Save will change ("Save adds "Easter" and
 * removes "Special"."), which describes the button too. Save sends the
 * tags the editor showed and the ones chosen (`saveSongTagsAction`): only
 * the tags added and removed are applied, to the song's tags as Planning
 * Center has them then, so a tag set there since the page loaded is never
 * dropped. It is called from its click with its pending state in
 * `useState` (convention 15), and then says what the song's tags are now,
 * which the editor then shows, in a status region that is always there,
 * or why nothing was saved, in an alert keyed per attempt; focus stays on
 * Save. A save refused because the tags changed
 * in a way the changes cannot be applied to offers to reload the page. The
 * choices are this card's state: a revalidation updates the list above
 * them and never the choices.
 */
export default function TagsCard({ pcoSongId, groups, songTags, editable }: TagsCardProps) {
    const shownGroups = groups.filter((group) => group.tags.length > 0);
    /** The tags the editor started from (and, after a save, the ones the song has then): a save sends what changed of them. */
    const [shown, setShown] = useState(() => songTagSelection(shownGroups, songTags));
    const [selection, setSelection] = useState(shown);
    const [result, setResult] = useState<SaveSongTagsState | null>(null);
    /** The tags the last save left on the song, while "Saved." is true. */
    const [savedSelection, setSavedSelection] = useState<string[] | null>(null);
    const [pending, setPending] = useState(false);
    // Read by the click, which may come again before a render shows `pending`.
    const saving = useRef(false);

    const lines = songTagLines(shownGroups, songTags);
    const changes = describeTagChanges(tagChanges(shown, selection, shownGroups));
    const saved =
        result?.ok === true && savedSelection !== null && sameTagSelection(selection, savedSelection);
    // Cleared while a save runs, so a second "Saved." is a change the region announces again.
    const status = !pending && saved && result?.ok === true ? describeTagsSave(result, shownGroups) : "";

    async function save() {
        if (saving.current) {
            return;
        }
        saving.current = true;
        setPending(true);
        try {
            const next = await saveSongTagsAction(pcoSongId, shown, selection);
            setResult(next);
            if (next.ok) {
                // The song's tags as Planning Center has them now, set there since included.
                const now = songTagSelection(shownGroups, next.tagIds.map((id) => ({ id })));
                setShown(now);
                setSelection(now);
                setSavedSelection(now);
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
                            <div key={formStateKey(result)} className="space-y-2">
                                <p role="alert" className={ALERT_CLASS}>
                                    {result.message}
                                </p>
                                {result.changedSinceShown && <ReloadPageButton />}
                            </div>
                        )}
                        <p id={CHANGES_ID} className={HINT_CLASS}>
                            {changes}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <PendingButton
                                pending={pending}
                                pendingLabel="Saving…"
                                onClick={() => void save()}
                                describedBy={CHANGES_ID}
                            >
                                Save tags
                            </PendingButton>
                            {/* Always there, empty until there is news: a live region added
                                with its text already in it may not be announced. */}
                            <p role="status" className={DONE_CLASS}>
                                {status}
                            </p>
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
