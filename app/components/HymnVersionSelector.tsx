"use client";

import { HymnVersion } from "./PlanItems/PlanItems";

interface HymnVersionSelectorProps {
    version: HymnVersion;
    itemId: string;
    isSelected: boolean;
    onSelect: () => void;
}

export function HymnVersionSelector({
    version,
    itemId,
    isSelected,
    onSelect,
}: HymnVersionSelectorProps) {
    return (
        <label className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input
                type="radio"
                name={`hymn-${itemId}`}
                checked={isSelected}
                onChange={onSelect}
                className="text-blue-600 focus:ring-blue-500"
            />
            <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                {version.tune_name} (
                {[
                    version.rejoice_hymns_number !== "-1"
                        ? `R-${version.rejoice_hymns_number}`
                        : null,
                    version.great_hymns_number !== "-1"
                        ? `G-${version.great_hymns_number}`
                        : null,
                ]
                    .filter(Boolean)
                    .join("/")}
                )
            </span>
        </label>
    );
}
