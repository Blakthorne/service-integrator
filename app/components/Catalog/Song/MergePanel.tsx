"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import Dialog from "@/app/components/ui/Dialog";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import { NO_ANSWER_MESSAGE } from "@/lib/catalog/editForms";
import type { MergeKind, MergePreview } from "@/lib/catalog/merge";
import {
    canMerge,
    describeMergeDone,
    mergeHeading,
    mergeQuestion,
    mergeRefusalLines,
    mergeSections,
    mergeWarning,
    type MergeLanding,
} from "@/lib/catalog/mergeText";
import type { PickerMatches } from "@/lib/catalog/pickers";
import { formStateKey } from "@/lib/forms";
import ChoiceFromList from "../SongForm/ChoiceFromList";
import { HINT_CLASS } from "../SongForm/Fields";
import { ALERT_BOX_CLASS, StatusLine } from "./EditFields";
import { leaveMergeNotice, mergeNoticeKey } from "./mergeNotice";

/** What reading the options gives back. */
type OptionsResult<T> = { ok: true; options: T[] } | { ok: false; message: string };

/** What the preview gives back. */
type PreviewResult = { ok: true; preview: MergePreview } | { ok: false; message: string };

/** What the merge gives back when it does not merge. */
type MergeRefusal = { ok: false; message: string; preview: MergePreview | null };

/** What the merge gives back: what it did (the plan it carried out, planned again where it wrote), or why it did not merge. */
type MergeResult = { ok: true; preview: MergePreview } | MergeRefusal;

/** A failure to show in an alert: a new object per attempt, whose `formStateKey` keys the alert. */
type Failure = { message: string };

const WORDS: Readonly<Record<MergeKind, { noun: string; plural: string }>> = {
    hymn: { noun: "hymn", plural: "hymns" },
    tune: { noun: "tune", plural: "tunes" },
};

/** What a merge does, by section, as a preview and the confirmation list it. */
function MergeSectionsList({ preview }: { preview: MergePreview }) {
    return (
        <div className="space-y-3">
            {mergeSections(preview).map((section) => (
                <div key={section.heading}>
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{section.heading}</h4>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
                        {section.items.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

/** Why the merge is refused, as a list in an alert-coloured box; nothing when it may go ahead. */
function RefusalBox({ preview }: { preview: MergePreview }) {
    const lines = mergeRefusalLines(preview);
    if (lines.length === 0) {
        return null;
    }
    return (
        <div className={ALERT_BOX_CLASS}>
            <p className="font-medium">The merge is refused:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
                {lines.map((line) => (
                    <li key={line}>{line}</li>
                ))}
            </ul>
        </div>
    );
}

interface MergePanelProps<T> {
    kind: MergeKind;
    /** The hymn or tune of the page, which is merged and deleted. */
    source: { id: number; name: string };
    /** Where a merge that is done goes, from what the merge did (`hymnMergeLanding`, `tuneMergeLanding`). */
    landing: (done: MergePreview) => MergeLanding;
    loadOptions: () => Promise<OptionsResult<T>>;
    previewMerge: (formData: FormData) => Promise<PreviewResult>;
    merge: (formData: FormData) => Promise<MergeResult>;
    searchOptions: (options: readonly T[], query: string) => PickerMatches<T>;
    keyOf: (option: T) => number;
    nameOf: (option: T) => string;
    describe: (option: T) => string;
}

/**
 * "Merge this hymn into…" (the song page's Hymn card) and "Merge this tune
 * into…" (a tune's page): a button that opens a panel, which reads the
 * hymns (or tunes) to choose from (`loadOptions`, so the page does not send
 * every one on each load), a picker over them, then the preview of merging
 * into the one chosen: the songs that move, the songs that merge, what else
 * changes, and why the merge is refused, if it is. Merge… confirms in a
 * dialog that names everything; Merge there merges. The action gives back
 * what the merge did, which was planned again where it wrote and so may
 * differ from the preview, and the page is replaced by the one the merge
 * lands on (`landing`), which says what was done (`mergeNotice`). A merge
 * refused as it is written stays in the dialog, with why.
 *
 * Every step is called from a click, with its state in `useState`
 * (convention 15). A preview nobody waits for any more (another hymn was
 * chosen) is dropped. The dialog cannot be dismissed while the merge runs.
 */
export default function MergePanel<T>({
    kind,
    source,
    landing,
    loadOptions,
    previewMerge,
    merge,
    searchOptions,
    keyOf,
    nameOf,
    describe,
}: MergePanelProps<T>) {
    const words = WORDS[kind];
    const router = useRouter();
    const panelId = useId();
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState<T[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadFailure, setLoadFailure] = useState<Failure | null>(null);
    const [search, setSearch] = useState("");
    const [chosen, setChosen] = useState<T | undefined>(undefined);
    const [preview, setPreview] = useState<MergePreview | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [previewFailure, setPreviewFailure] = useState<Failure | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [merging, setMerging] = useState(false);
    const [mergeFailure, setMergeFailure] = useState<Failure | null>(null);
    /** The preview asked for last: an answer to an older one is dropped. */
    const previewRequest = useRef(0);
    const mergeButtonRef = useRef<HTMLButtonElement>(null);
    // Read by the click, which may come again before a render shows `merging`.
    const mergingNow = useRef(false);

    async function load() {
        setLoading(true);
        setLoadFailure(null);
        try {
            const result = await loadOptions();
            if (result.ok) {
                setOptions(result.options.filter((option) => keyOf(option) !== source.id));
            } else {
                setLoadFailure({ message: result.message });
            }
        } catch (error) {
            console.error(`Reading the ${words.plural} failed:`, error);
            setLoadFailure({ message: NO_ANSWER_MESSAGE });
        } finally {
            setLoading(false);
        }
    }

    function toggle() {
        const next = !open;
        setOpen(next);
        if (next && options === null && !loading) {
            void load();
        }
    }

    async function choose(option: T | null) {
        setChosen(option ?? undefined);
        setPreview(null);
        setPreviewFailure(null);
        setMergeFailure(null);
        const request = ++previewRequest.current;
        if (option === null) {
            setPreviewing(false);
            return;
        }
        setPreviewing(true);
        const formData = new FormData();
        formData.set("sourceId", String(source.id));
        formData.set("targetId", String(keyOf(option)));
        let result: PreviewResult;
        try {
            result = await previewMerge(formData);
        } catch (error) {
            console.error("Previewing the merge failed:", error);
            result = { ok: false, message: NO_ANSWER_MESSAGE };
        }
        if (request !== previewRequest.current) {
            return;
        }
        setPreviewing(false);
        if (result.ok) {
            setPreview(result.preview);
        } else {
            setPreviewFailure({ message: result.message });
        }
    }

    async function confirmMerge(confirmed: MergePreview) {
        if (mergingNow.current || !canMerge(confirmed)) {
            return;
        }
        mergingNow.current = true;
        setMerging(true);
        setMergeFailure(null);
        const formData = new FormData();
        formData.set("sourceId", String(confirmed.source.id));
        formData.set("targetId", String(confirmed.target.id));
        try {
            const result = await merge(formData);
            if (result.ok) {
                // What the notice says, and where it goes, is what the merge
                // did, not what `confirmed` showed: it was planned again where
                // it wrote. It is left before the page opens, which takes it.
                const { href, notice } = landing(result.preview);
                if (notice !== null) {
                    leaveMergeNotice(mergeNoticeKey(notice.kind, notice.id), describeMergeDone(result.preview));
                }
                // The page it was on may be gone: replace it, so Back does not return there.
                setConfirming(false);
                setOpen(false);
                router.replace(href);
                return;
            }
            setMergeFailure({ message: result.message });
            if (result.preview !== null) {
                setPreview(result.preview);
            }
        } catch (error) {
            console.error("Merging failed:", error);
            setMergeFailure({ message: NO_ANSWER_MESSAGE });
        } finally {
            mergingNow.current = false;
            setMerging(false);
        }
    }

    const statusText = previewing
        ? "Reading what the merge would do…"
        : preview !== null
          ? `${mergeHeading(preview)}: ${canMerge(preview) ? "what it does is below." : "it is refused, for the reasons below."}`
          : "";

    return (
        <div className="space-y-3">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={toggle}
                className={buttonClasses("secondary")}
            >
                Merge this {words.noun} into…
            </button>
            <div id={panelId} hidden={!open} className="space-y-4">
                <p className={HINT_CLASS}>
                    For two {words.plural} that are one: this {words.noun}&apos;s songs move to the {words.noun} chosen, or
                    merge into its song to the same {kind === "hymn" ? "tune" : "hymn"}, and this {words.noun} is deleted.
                    You see what would happen before anything is merged.
                </p>
                {loading && (
                    <p role="status" className={HINT_CLASS}>
                        Reading the {words.plural}…
                    </p>
                )}
                {loadFailure && (
                    <div className="space-y-2">
                        <p key={formStateKey(loadFailure)} role="alert" className={ALERT_BOX_CLASS}>
                            {loadFailure.message}
                        </p>
                        <button type="button" onClick={() => void load()} className={buttonClasses("secondary")}>
                            Try again
                        </button>
                    </div>
                )}
                {options !== null && (
                    <ChoiceFromList
                        options={options}
                        chosen={chosen}
                        search={search}
                        onSearchChange={setSearch}
                        onChoose={(option) => void choose(option)}
                        searchOptions={searchOptions}
                        keyOf={keyOf}
                        nameOf={nameOf}
                        describe={describe}
                        searchLabel={`The ${words.noun} to merge "${source.name}" into`}
                        noun={words.noun}
                    />
                )}
                <StatusLine text={statusText} />
                {previewFailure && (
                    <p key={formStateKey(previewFailure)} role="alert" className={ALERT_BOX_CLASS}>
                        {previewFailure.message}
                    </p>
                )}
                {preview !== null && !previewing && (
                    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{mergeHeading(preview)}</h3>
                        <RefusalBox preview={preview} />
                        <MergeSectionsList preview={preview} />
                        <div className="flex flex-wrap gap-3">
                            <button
                                ref={mergeButtonRef}
                                type="button"
                                aria-disabled={!canMerge(preview)}
                                onClick={() => {
                                    if (canMerge(preview)) {
                                        setMergeFailure(null);
                                        setConfirming(true);
                                    }
                                }}
                                className={buttonClasses("danger", !canMerge(preview))}
                            >
                                Merge…
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {preview !== null && (
                <Dialog
                    open={confirming}
                    onClose={() => setConfirming(false)}
                    title={mergeQuestion(preview)}
                    description={mergeWarning(kind)}
                    returnFocusRef={mergeButtonRef}
                    dismissible={!merging}
                >
                    <div className="space-y-4">
                        {mergeFailure && (
                            <p key={formStateKey(mergeFailure)} role="alert" className={ALERT_BOX_CLASS}>
                                {mergeFailure.message}
                            </p>
                        )}
                        <RefusalBox preview={preview} />
                        <div className="max-h-[50vh] overflow-y-auto">
                            <MergeSectionsList preview={preview} />
                        </div>
                        <div className="flex flex-wrap justify-end gap-3">
                            {!merging && (
                                <button
                                    type="button"
                                    onClick={() => setConfirming(false)}
                                    className={buttonClasses("secondary")}
                                >
                                    Cancel
                                </button>
                            )}
                            <button
                                type="button"
                                aria-disabled={merging || !canMerge(preview)}
                                onClick={() => void confirmMerge(preview)}
                                className={buttonClasses("danger", merging || !canMerge(preview))}
                            >
                                {merging ? "Merging…" : "Merge"}
                            </button>
                        </div>
                    </div>
                </Dialog>
            )}
        </div>
    );
}
