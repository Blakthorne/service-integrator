"use client";

import Segmented, { type SegmentedOption } from "@/app/components/ui/Segmented";
import {
    describeTuneOption,
    searchTuneOptions,
    type TuneOption,
} from "@/lib/catalog/pickers";
import {
    TUNE_NAME_MAX_LENGTH,
    type NewSongValues,
    type TuneMode,
} from "@/lib/catalog/validation";
import type { FieldError } from "@/lib/forms";
import ChoiceFromList from "./ChoiceFromList";
import { FieldErrorText, FormPart, HINT_CLASS, TextField } from "./Fields";

const MODE_OPTIONS: readonly SegmentedOption<TuneMode>[] = [
    { value: "existing", label: "From the catalog" },
    { value: "new", label: "New tune" },
    { value: "none", label: "None" },
];

interface TuneFieldsProps {
    tunes: readonly TuneOption[];
    values: Pick<NewSongValues, "tune" | "tuneId" | "tuneName">;
    onChange: (changes: Partial<NewSongValues>) => void;
    /** What is typed in the tune search. */
    search: string;
    onSearchChange: (search: string) => void;
    error: FieldError | undefined;
}

/** The mode a value of the form stands for: None for anything it does not know. */
function tuneMode(value: string): TuneMode {
    return value === "existing" || value === "new" ? value : "none";
}

/**
 * The form's tune: one from the catalog, found by name or other name, a new
 * name, or none when the tune is not known. Like the hymn, its mode and
 * chosen id go in hidden fields.
 */
export default function TuneFields({
    tunes,
    values,
    onChange,
    search,
    onSearchChange,
    error,
}: TuneFieldsProps) {
    const errorId = error ? "tune-error" : undefined;
    const mode = tuneMode(values.tune);
    const chosen = tunes.find(({ id }) => String(id) === values.tuneId);

    return (
        <FormPart
            legend="Tune"
            description="The melody. A song is one hymn to one tune."
            errorId={errorId}
        >
            <input type="hidden" name="tune" value={mode} />
            <input type="hidden" name="tuneId" value={chosen ? String(chosen.id) : ""} />
            <Segmented
                value={mode}
                options={MODE_OPTIONS}
                onChange={(next) => onChange({ tune: next })}
                ariaLabel="Tune"
            />
            {mode === "existing" && (
                <ChoiceFromList
                    options={tunes}
                    chosen={chosen}
                    search={search}
                    onSearchChange={onSearchChange}
                    onChoose={(tune) => onChange({ tuneId: tune ? String(tune.id) : "" })}
                    searchOptions={searchTuneOptions}
                    keyOf={(tune) => tune.id}
                    nameOf={(tune) => tune.name}
                    describe={describeTuneOption}
                    searchLabel="Search the catalog's tunes"
                    noun="tune"
                    errorId={errorId}
                />
            )}
            {mode === "new" && (
                <TextField
                    id="tune-name"
                    name="tuneName"
                    label="Name"
                    hint="As the hymnal prints it, such as SLANE."
                    value={values.tuneName}
                    onChange={(tuneName) => onChange({ tuneName })}
                    errorId={errorId}
                    maxLength={TUNE_NAME_MAX_LENGTH}
                />
            )}
            {mode === "none" && (
                <p className={HINT_CLASS}>
                    The tune is not known yet. A hymn can have one song without a tune.
                </p>
            )}
            {errorId && <FieldErrorText id={errorId} error={error} />}
        </FormPart>
    );
}
