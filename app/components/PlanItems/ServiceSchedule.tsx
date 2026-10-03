"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import CopyButton from "../ui/CopyButton";
import { normalizeTitle } from "@/lib/normalizeTitle";
import {
    buildScheduleCopyText,
    formatHymnNumbers,
} from "@/lib/serviceSchedule";
import type {
    HymnData,
    HymnVersion,
    PlanItem,
    ScheduleSelection,
} from "@/lib/domain";

/** A plan item together with its Schedule-tab selections. */
type ItemWithSelection = PlanItem & ScheduleSelection;

export default function ServiceSchedule({
    items,
    setItems,
    hymnData,
    serviceTypeName,
    date,
}: {
    items: ItemWithSelection[];
    setItems: (items: ItemWithSelection[]) => void;
    hymnData: HymnData[];
    serviceTypeName: string;
    date: Date;
}) {
    const onChooseOption = (
        item: ItemWithSelection,
        option: "Leave blank" | "Custom" | undefined,
        versionIndex?: number
    ) => {
        const updatedItems = items.map((i) =>
            i.id === item.id
                ? {
                      ...i,
                      selectedOption: option,
                      customText:
                          option === "Custom" ? i.customText || "" : undefined,
                      selectedVersionIndex: versionIndex,
                  }
                : i
        );
        setItems(updatedItems);
    };

    // CustomTextInput component with independent state management
    const CustomTextInput: React.FC<{
        item: ItemWithSelection;
    }> = ({ item }) => {
        const inputRef = useRef<HTMLInputElement>(null);
        const [inputValue, setInputValue] = useState(item.customText || "");
        const timeoutRef = useRef<NodeJS.Timeout | null>(null);

        // Update local state if item changes
        useEffect(() => {
            setInputValue(item.customText || "");
        }, [item.customText]);

        const updateParentState = useCallback(
            (value: string) => {
                const updatedItems = items.map((i) =>
                    i.id === item.id
                        ? {
                              ...i,
                              customText: value,
                          }
                        : i
                );
                setItems(updatedItems);
            },
            [item.id]
        );

        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;
            setInputValue(newValue);

            // Clear existing timeout
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }

            // Set new timeout to update parent state
            timeoutRef.current = setTimeout(() => {
                updateParentState(newValue);
            }, 500);
        };

        // Cleanup timeout on unmount
        useEffect(() => {
            return () => {
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                }
            };
        }, []);

        return (
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleChange}
                className="flex-1 px-2 py-1 text-sm border w-full rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                placeholder="Enter custom text..."
            />
        );
    };

    const CustomOption: React.FC<{
        item: ItemWithSelection;
    }> = ({ item }) => (
        <div className="flex items-center space-x-3 mx-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <label className="flex items-center space-x-3 cursor-pointer">
                <input
                    type="radio"
                    name={`hymn-${item.id}`}
                    checked={item.selectedOption === "Custom"}
                    onChange={() => onChooseOption(item, "Custom")}
                    className="text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">
                    Custom:
                </span>
            </label>
            <CustomTextInput item={item} />
        </div>
    );

    const HymnNumbers: React.FC<{
        hymnVersion: HymnVersion;
    }> = ({ hymnVersion }) => (
        <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
            {hymnVersion.tune_name + " "}(
            {formatHymnNumbers(hymnVersion)}
            )
        </span>
    );

    const HymnVersionOption: React.FC<{
        item: ItemWithSelection;
        hymnVersion: HymnVersion;
        versionIndex: number;
    }> = ({ item, hymnVersion, versionIndex }) => (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`hymn-${item.id}`}
                checked={
                    !item.selectedOption &&
                    item.selectedVersionIndex === versionIndex
                }
                onChange={() => onChooseOption(item, undefined, versionIndex)}
                className="text-blue-600 focus:ring-blue-500"
            />
            <HymnNumbers hymnVersion={hymnVersion} />
        </label>
    );

    const LeaveBlankOption: React.FC<{
        item: ItemWithSelection;
    }> = ({ item }) => (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`option-${item.id}`}
                checked={
                    item.selectedOption === "Leave blank" ||
                    item.selectedOption === undefined
                }
                onChange={() => onChooseOption(item, "Leave blank")}
                className="text-blue-600 focus:ring-blue-500"
            />
            <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                Leave blank
            </span>
        </label>
    );

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Service Schedule
                </h3>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <CopyButton
                            text={buildScheduleCopyText({
                                items,
                                hymnData,
                                serviceTypeName,
                                date,
                            })}
                        />
                    </div>
                </div>
            </div>
            <div className="space-y-4">
                {items
                    .filter((item) => item.itemType === "song")
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((item) => {
                        const hymn = hymnData.find(
                            (h) => normalizeTitle(h.song_title) === normalizeTitle(item.title)
                        );

                        return (
                            <div
                                key={item.id}
                                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4"
                            >
                                <div className="flex flex-col space-y-2">
                                    <div className="flex justify-between items-start">
                                        <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                                            {item.title}
                                        </h4>
                                    </div>
                                    {!hymn ? (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                Song not found in hymn books
                                            </p>
                                            <div>
                                                <LeaveBlankOption item={item} />
                                                <CustomOption item={item} />
                                            </div>
                                        </div>
                                    ) : hymn.versions.length > 1 ? (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                Multiple versions found
                                            </p>
                                            <div>
                                                {hymn.versions.map(
                                                    (version, index) => (
                                                        <HymnVersionOption
                                                            key={
                                                                item.id +
                                                                version.tune_name
                                                            }
                                                            item={item}
                                                            hymnVersion={
                                                                version
                                                            }
                                                            versionIndex={index}
                                                        />
                                                    )
                                                )}
                                                <CustomOption item={item} />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div>
                                                <HymnVersionOption
                                                    item={item}
                                                    hymnVersion={
                                                        hymn.versions[0]
                                                    }
                                                    versionIndex={0}
                                                />
                                                <CustomOption item={item} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}
