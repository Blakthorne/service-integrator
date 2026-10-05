"use client";

import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import {
    describeHymnOption,
    searchHymnOptions,
    type HymnOption,
} from "@/lib/catalog/pickers";
import {
    TITLE_MAX_LENGTH,
    type HymnMode,
    type NewSongValues,
} from "@/lib/catalog/validation";
import type { FieldError } from "@/lib/forms";
import ChoiceFromList from "./ChoiceFromList";
import { FieldErrorText, FormPart, TextField } from "./Fields";

const MODE_OPTIONS: readonly SegmentedOption<HymnMode>[] = [
    { value: "existing", label: "Existing", title: "A hymn the catalog has" },
    { value: "new", label: "New", title: "A hymn the catalog does not have yet" },
];

interface HymnFieldsProps {
    hymns: readonly HymnOption[];
    values: Pick<NewSongValues, "hymn" | "hymnId" | "hymnTitle">;
    onChange: (changes: Partial<NewSongValues>) => void;
    /** What is typed in the hymn search. */
    search: string;
    onSearchChange: (search: string) => void;
    error: FieldError | undefined;
}

/**
 * The form's hymn: one from the catalog, found by title, other title or
 * tune, or a new title. Its mode and chosen id go in hidden fields; the
 * buttons that set them are not form fields, so the reset after an action
 * leaves them alone.
 */
export default function HymnFields({
    hymns,
    values,
    onChange,
    search,
    onSearchChange,
    error,
}: HymnFieldsProps) {
    const errorId = error ? "hymn-error" : undefined;
    const mode: HymnMode = values.hymn === "existing" ? "existing" : "new";
    const chosen = hymns.find(({ id }) => String(id) === values.hymnId);

    return (
        <FormPart
            legend="Hymn"
            description="The words. Choose a hymn the catalog has, to sing it to another tune, or add a new one."
            errorId={errorId}
        >
            <input type="hidden" name="hymn" value={mode} />
            <input type="hidden" name="hymnId" value={chosen ? String(chosen.id) : ""} />
            <div>
                <Segmented
                    value={mode}
                    options={MODE_OPTIONS}
                    onChange={(next) => onChange({ hymn: next })}
                    ariaLabel="Hymn"
                    describedBy={errorId}
                />
            </div>
            {mode === "existing" ? (
                <ChoiceFromList
                    options={hymns}
                    chosen={chosen}
                    search={search}
                    onSearchChange={onSearchChange}
                    onChoose={(hymn) => onChange({ hymnId: hymn ? String(hymn.id) : "" })}
                    searchOptions={searchHymnOptions}
                    keyOf={(hymn) => hymn.id}
                    nameOf={(hymn) => hymn.title}
                    describe={describeHymnOption}
                    searchLabel="Search the catalog's hymns"
                    noun="hymn"
                    errorId={errorId}
                />
            ) : (
                <TextField
                    id="hymn-title"
                    name="hymnTitle"
                    label="Title"
                    value={values.hymnTitle}
                    onChange={(hymnTitle) => onChange({ hymnTitle })}
                    errorId={errorId}
                    maxLength={TITLE_MAX_LENGTH}
                />
            )}
            {errorId && <FieldErrorText id={errorId} error={error} />}
        </FormPart>
    );
}
