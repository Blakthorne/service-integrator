"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import CopyButton from "./CopyButton";
import { HymnData, HymnVersion, PlanItem } from "./PlanItems";

export default function ServiceSchedule({
    items,
    setItems,
    hymnData,
    serviceTypeName,
    date,
}: {
    items: PlanItem[];
    setItems: (items: PlanItem[]) => void;
    hymnData: HymnData[];
    serviceTypeName: string;
    date: Date;
}) {
    const [showCopyTooltip, setShowCopyTooltip] = useState<boolean>(false);

    const onChooseOption = (
        item: PlanItem,
        option: "Leave blank" | "Custom" | undefined
    ) => {
        const updatedItems = items.map((i) =>
            i.id === item.id
                ? {
                      ...i,
                      selectedOption: option,
                      customText:
                          option === "Custom" ? i.customText || "" : undefined,
                  }
                : i
        );
        setItems(updatedItems);
    };

    // CustomTextInput component with independent state management
    const CustomTextInput: React.FC<{
        item: PlanItem;
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
        item: PlanItem;
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
            {[
                hymnVersion.rejoice_hymns_number !== "-1"
                    ? `R-${hymnVersion.rejoice_hymns_number}`
                    : null,
                hymnVersion.great_hymns_number !== "-1"
                    ? `G-${hymnVersion.great_hymns_number}`
                    : null,
            ]
                .filter(Boolean)
                .join("/")}
            )
        </span>
    );

    const HymnVersionOption: React.FC<{
        item: PlanItem;
        hymnVersion: HymnVersion;
    }> = ({ item, hymnVersion }) => (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`hymn-${item.id}`}
                checked={!item.selectedOption}
                onChange={() => onChooseOption(item, undefined)}
                className="text-blue-600 focus:ring-blue-500"
            />
            <HymnNumbers hymnVersion={hymnVersion} />
        </label>
    );

    const LeaveBlankOption: React.FC<{
        item: PlanItem;
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

    const getCopyText = () => {
        let result: string = "";

        if (
            serviceTypeName === "Sunday Morning" ||
            serviceTypeName === "Sunday Evening"
        ) {
            result +=
                "Sunday" +
                (serviceTypeName === "Sunday Morning" ? " AM " : " PM ") +
                date.toLocaleDateString("en-US", {
                    month: "numeric",
                    day: "numeric",
                    year: "2-digit",
                }) +
                "\n\n";
        }

        result += items
            .filter((item) => item.itemType === "song")
            .sort((a, b) => a.sequence - b.sequence)
            .map((item) => {
                const hymn = hymnData.find((h) => h.song_title === item.title);
                if (!hymn) {
                    if (item.selectedOption === "Custom" && item.customText) {
                        return `${item.title} (${item.customText})`;
                    }
                    return item.title;
                }

                if (item.selectedOption === "Custom") {
                    if (
                        item.customText === undefined ||
                        item.customText === ""
                    ) {
                        return item.title;
                    }
                    return `${item.title} (${item.customText})`;
                }

                const selectedVersion = hymn.versions.find((v) => v.selected);
                if (!selectedVersion) return item.title;

                const parts: string = [
                    selectedVersion.rejoice_hymns_number !== "-1"
                        ? `R-${selectedVersion.rejoice_hymns_number}`
                        : null,
                    selectedVersion.great_hymns_number !== "-1"
                        ? `G-${selectedVersion.great_hymns_number}`
                        : null,
                ]
                    .filter(Boolean)
                    .join("/");

                if (parts.length > 0) {
                    return `${item.title} (${parts})`;
                }
                return item.title;
            })
            .join("\n");

        return result;
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Service Schedule
                </h3>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <CopyButton
                            text={getCopyText()}
                            showTooltip={showCopyTooltip}
                            setShowTooltip={setShowCopyTooltip}
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
                            (h) => h.song_title === item.title
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
                                                    (version) => (
                                                        <HymnVersionOption
                                                            key={
                                                                item.id +
                                                                version.tune_name
                                                            }
                                                            item={item}
                                                            hymnVersion={
                                                                version
                                                            }
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
