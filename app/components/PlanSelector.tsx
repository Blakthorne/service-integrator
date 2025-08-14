"use client";

import { useState } from "react";

interface ServiceType {
    id: string;
    name: string;
    frequency: string;
    sequence: number;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
}

interface PlanSelectorProps {
    serviceTypes: ServiceType[];
    onPlanSelect: (serviceType: string, serviceTypeId: string) => void;
}

export default function PlanSelector({
    serviceTypes,
    onPlanSelect,
}: PlanSelectorProps): React.ReactElement {
    const [selectedServiceType, setSelectedServiceType] = useState<
        string | null
    >(null);

    const handleServiceTypeSelect = (
        serviceType: string,
        serviceTypeId: string
    ): void => {
        setSelectedServiceType(serviceType);
        onPlanSelect(serviceType, serviceTypeId);
    };

    // Get emoji based on service type name
    const getServiceTypeEmoji = (name: string): string => {
        const lowerName: string = name.toLowerCase();
        if (lowerName.includes("morning")) return "🌅";
        if (lowerName.includes("evening")) return "🌙";
        if (lowerName.includes("midweek")) return "🌆";
        if (lowerName.includes("youth")) return "👥";
        if (lowerName.includes("children")) return "👶";
        if (lowerName.includes("prayer")) return "🙏";
        if (lowerName.includes("worship")) return "🎵";
        return "⛪"; // Default church emoji
    };

    return (
        <div className="w-full max-w-md mx-auto">
            <h2 className="text-2xl font-semibold text-center mb-6">
                Choose Your Service Type
            </h2>

            <div className="space-y-4">
                {serviceTypes.map((serviceType: ServiceType) => (
                    <button
                        key={serviceType.id}
                        onClick={() =>
                            handleServiceTypeSelect(
                                serviceType.name,
                                serviceType.id
                            )
                        }
                        className={`w-full p-6 rounded-lg border-2 transition-all duration-200 ${
                            selectedServiceType === serviceType.name
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-800"
                        }`}
                    >
                        <div className="text-center">
                            <div className="text-3xl mb-2">
                                {getServiceTypeEmoji(serviceType.name)}
                            </div>
                            <h3 className="text-xl font-medium mb-2">
                                {serviceType.name}
                            </h3>
                            <p className="text-gray-600 dark:text-gray-300 text-sm">
                                {serviceType.frequency} service
                            </p>
                        </div>
                    </button>
                ))}
            </div>

            {selectedServiceType && (
                <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-green-800 dark:text-green-200 text-center">
                        Selected:{" "}
                        <span className="font-semibold">
                            {selectedServiceType}
                        </span>
                    </p>
                </div>
            )}
        </div>
    );
}
