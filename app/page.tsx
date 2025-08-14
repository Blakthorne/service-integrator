"use client";

import { useState } from "react";
import PlansTable from "./components/PlansTable";
import PlanItems from "./components/PlanItems";
import SongDetails, { SongDetailsType } from "./components/SongDetails";

type View = "plans-table" | "plan-items" | "item-details";

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
    serviceType: {
        id: string;
        name: string;
    };
}

interface PlanItem {
    id: string;
    title: string;
    itemType: string;
    sequence: number;
    servicePosition: string;
    keyName: string | null;
    length: number;
    description: string | null;
    createdAt: string;
    updatedAt: string;
}

export default function Home() {
    const [currentView, setCurrentView] = useState<View>("plans-table");
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
    const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
    const [selectedSongDetails, setSelectedSongDetails] = useState<
        SongDetailsType | undefined
    >(undefined);

    const handlePlanSelect = (plan: Plan, serviceTypeId: string): void => {
        setSelectedPlan(plan);
        setCurrentView("plan-items");
    };

    const handleItemSelect = (
        item: PlanItem,
        songDetails?: SongDetailsType
    ): void => {
        setSelectedItem(item);
        setSelectedSongDetails(songDetails);
        setCurrentView("item-details");
    };

    const goBackToPlansTable = (): void => {
        setCurrentView("plans-table");
        setSelectedPlan(null);
        setSelectedItem(null);
    };

    const goBackToPlanItems = (): void => {
        setCurrentView("plan-items");
        setSelectedItem(null);
        setSelectedSongDetails(undefined);
    };

    const renderCurrentView = (): React.ReactElement => {
        switch (currentView) {
            case "plans-table":
                return <PlansTable onPlanSelect={handlePlanSelect} />;

            case "plan-items":
                if (!selectedPlan)
                    return <PlansTable onPlanSelect={handlePlanSelect} />;
                return (
                    <PlanItems
                        plan={selectedPlan}
                        serviceTypeId={selectedPlan.serviceType.id}
                        serviceTypeName={selectedPlan.serviceType.name}
                        onBack={goBackToPlansTable}
                        onItemSelect={handleItemSelect}
                    />
                );

            case "item-details":
                return (
                    <SongDetails
                        item={selectedItem!}
                        songDetails={selectedSongDetails}
                        onBack={goBackToPlanItems}
                    />
                );

            default:
                return <PlansTable onPlanSelect={handlePlanSelect} />;
        }
    };

    return (
        <div className="font-sans min-h-screen flex flex-col">
            <main className="flex-1 flex flex-col items-center p-8">
                {/* Always show the title */}
                <div className="text-center mb-12 w-full cursor-pointer">
                    <h1
                        className="text-4xl sm:text-5xl font-bold mb-4"
                        onClick={goBackToPlansTable}
                    >
                        Service Integrator
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                        Integrates with Planning Center&apos;s public Services
                        API to aggregate data and generate copyright information
                        for songs
                    </p>
                </div>

                {/* Content area with consistent positioning */}
                <div className="w-full max-w-4xl mx-auto">
                    {renderCurrentView()}
                </div>
            </main>

            <footer className="w-full p-4 text-center border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                    © {new Date().getFullYear()} David Polar
                </span>
            </footer>
        </div>
    );
}
