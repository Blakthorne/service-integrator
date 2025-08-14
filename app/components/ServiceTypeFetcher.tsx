"use client";

import { useState, useEffect } from "react";
import PlanSelector from "./PlanSelector";

interface ServiceType {
    id: string;
    name: string;
    frequency: string;
    sequence: number;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
}

interface ServiceTypeFetcherProps {
    onPlanSelect: (serviceType: string, serviceTypeId: string) => void;
}

export default function ServiceTypeFetcher({
    onPlanSelect,
}: ServiceTypeFetcherProps): React.ReactElement {
    const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchServiceTypes = async (): Promise<void> => {
            try {
                setLoading(true);
                const baseUrl: string =
                    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
                const response: Response = await fetch(
                    `${baseUrl}/api/service-types`
                );

                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch service types: ${response.status}`
                    );
                }

                const data: { serviceTypes: ServiceType[] } =
                    await response.json();
                setServiceTypes(data.serviceTypes || []);
            } catch (error: unknown) {
                console.error("Error fetching service types:", error);
                setError("Failed to fetch service types");
                // Set fallback data if API fails
                const fallbackServiceTypes: ServiceType[] = [
                    {
                        id: "1",
                        name: "Sunday Morning",
                        frequency: "Weekly",
                        sequence: 0,
                        archived: false,
                        createdAt: "",
                        updatedAt: "",
                    },
                    {
                        id: "2",
                        name: "Sunday Evening",
                        frequency: "Weekly",
                        sequence: 1,
                        archived: false,
                        createdAt: "",
                        updatedAt: "",
                    },
                ];
                setServiceTypes(fallbackServiceTypes);
            } finally {
                setLoading(false);
            }
        };

        fetchServiceTypes();
    }, []);

    if (loading) {
        return (
            <div className="w-full max-w-md mx-auto">
                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-300">
                        Loading service types...
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full max-w-md mx-auto">
                <div className="text-center py-12">
                    <p className="text-red-600 dark:text-red-400 mb-4">
                        {error}
                    </p>
                    <p className="text-gray-600 dark:text-gray-300 text-sm">
                        Using fallback service types
                    </p>
                </div>
            </div>
        );
    }

    return (
        <PlanSelector serviceTypes={serviceTypes} onPlanSelect={onPlanSelect} />
    );
}
