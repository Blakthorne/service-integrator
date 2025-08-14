"use client";

import { useState, useEffect } from "react";

interface Plan {
    id: string;
    dates: string;
    shortDates: string;
    planningCenterUrl: string;
    itemsCount: number;
    title: string | null;
    sortDate: string;
    createdAt: string;
    updatedAt: string;
}

interface PlansTableProps {
    serviceType: string;
    serviceTypeId: string;
    onPlanSelect: (plan: Plan) => void;
    onBack: () => void;
}

export default function PlansTable({
    serviceType,
    serviceTypeId,
    onPlanSelect,
    onBack,
}: PlansTableProps): React.ReactElement {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Fetch plans from the API using the service type ID
        const fetchPlans = async (): Promise<void> => {
            try {
                setLoading(true);
                const baseUrl: string =
                    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
                const response: Response = await fetch(
                    `${baseUrl}/api/plans?serviceTypeId=${serviceTypeId}`
                );

                if (!response.ok) {
                    throw new Error(
                        `Failed to fetch plans: ${response.status}`
                    );
                }

                const data: { plans: Plan[]; totalCount: number } =
                    await response.json();
                setPlans(data.plans || []);
            } catch (err: unknown) {
                setError("Failed to fetch plans");
                console.error("Error fetching plans:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchPlans();
    }, [serviceTypeId]);

    if (loading) {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
                    >
                        ← Back to Service Selection
                    </button>
                </div>

                <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-300">
                        Loading {serviceType} service plans...
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full">
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
                    >
                        ← Back to Service Selection
                    </button>
                </div>

                <div className="text-center py-12">
                    <p className="text-red-600 dark:text-red-400 mb-4">
                        {error}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-6">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
                >
                    ← Back to Service Selection
                </button>
                <h2 className="text-2xl font-semibold">
                    {serviceType} Service Plans
                </h2>
            </div>

            <div className="max-w-2xl mx-auto">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Date
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                    Items
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {plans.map((plan: Plan) => (
                                <tr
                                    key={plan.id}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                                    onClick={() => onPlanSelect(plan)}
                                >
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                        {plan.dates}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                                        {plan.itemsCount} items
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
