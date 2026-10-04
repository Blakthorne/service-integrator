"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    describeSongOption,
    searchSongOptions,
    songOptionLabel,
} from "@/lib/catalog/pickers";
import type { CatalogSongOption } from "@/lib/domain";
import OptionPicker from "../OptionPicker";
import LinkForm from "./LinkForm";

interface SongPickerProps {
    /** The id of the panel, which the button that opens it controls. */
    id: string;
    /** The row's Planning Center song. */
    pcoSongId: string;
    /** Every catalog song, by title. */
    catalogSongs: readonly CatalogSongOption[];
    /** The row's link action, from `useActionState`. */
    linkAction: (formData: FormData) => void;
}

/**
 * "Choose another song": a search over every catalog song, by title, tune
 * or entry ("R-396", "396"), with a Link for each match. A match already
 * linked to another Planning Center song says so instead. Rendered only
 * while open; its search field takes focus when it opens.
 */
export default function SongPicker({ id, pcoSongId, catalogSongs, linkAction }: SongPickerProps) {
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const result = useMemo(() => searchSongOptions(catalogSongs, query), [catalogSongs, query]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    return (
        <div
            id={id}
            className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3"
        >
            <OptionPicker
                label="Search the catalog's songs"
                placeholder="Title, tune or number"
                query={query}
                onQueryChange={setQuery}
                result={result}
                keyOf={(song) => song.songId}
                inputRef={inputRef}
                renderOption={(song) => (
                    <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 px-3 py-2">
                        <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100">
                                {song.title}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                {describeSongOption(song)}
                            </p>
                        </div>
                        {song.pcoSongId === null ? (
                            <LinkForm
                                action={linkAction}
                                songId={song.songId}
                                pcoSongId={pcoSongId}
                                songLabel={songOptionLabel(song)}
                            />
                        ) : (
                            <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                                Linked to another Planning Center song
                            </p>
                        )}
                    </div>
                )}
            />
        </div>
    );
}
