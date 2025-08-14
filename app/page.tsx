"use client";

import { useState } from "react";
import ServiceTypeFetcher from "./components/ServiceTypeFetcher";
import PlansTable from "./components/PlansTable";
import PlanItems from "./components/PlanItems";
import SongDetails from "./components/SongDetails";

type View = "service-selection" | "plans-table" | "plan-items" | "item-details";

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

interface SongDetails {
    id: string;
    title: string;
    author: string;
    ccliNumber: number;
    copyright: string;
    notes: string;
    themes: string;
    createdAt: string;
    updatedAt: string;
    planningCenterUrl: string;
}

export default function Home() {
    const [currentView, setCurrentView] = useState<View>("service-selection");
    const [selectedServiceType, setSelectedServiceType] = useState<
        string | null
    >(null);
    const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<
        string | null
    >(null);
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
    const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
    const [selectedSongDetails, setSelectedSongDetails] = useState<
        SongDetails | undefined
    >(undefined);

    const handleServiceSelect = (
        serviceType: string,
        serviceTypeId: string
    ): void => {
        setSelectedServiceType(serviceType);
        setSelectedServiceTypeId(serviceTypeId);
        setCurrentView("plans-table");
    };

    const handlePlanSelect = (plan: Plan): void => {
        setSelectedPlan(plan);
        setCurrentView("plan-items");
    };

    const handleItemSelect = (
        item: PlanItem,
        songDetails?: SongDetails
    ): void => {
        setSelectedItem(item);
        setSelectedSongDetails(songDetails);
        setCurrentView("item-details");
    };

    const goBackToServiceSelection = (): void => {
        setCurrentView("service-selection");
        setSelectedServiceType(null);
        setSelectedServiceTypeId(null);
        setSelectedPlan(null);
        setSelectedItem(null);
    };

    const goBackToPlansTable = (): void => {
        setCurrentView("plans-table");
        setSelectedPlan(null);
        setSelectedItem(null);
    };

    const goBackToPlanItems = (): void => {
        setCurrentView("plan-items");
        setSelectedItem(null);
    };

    const renderCurrentView = (): React.ReactElement => {
        switch (currentView) {
            case "service-selection":
                return (
                    <ServiceTypeFetcher onPlanSelect={handleServiceSelect} />
                );

            case "plans-table":
                return (
                    <PlansTable
                        serviceType={selectedServiceType!}
                        serviceTypeId={selectedServiceTypeId!}
                        onPlanSelect={handlePlanSelect}
                        onBack={goBackToServiceSelection}
                    />
                );

            case "plan-items":
                return (
                    <PlanItems
                        plan={selectedPlan!}
                        serviceTypeId={selectedServiceTypeId!}
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
                return (
                    <ServiceTypeFetcher onPlanSelect={handleServiceSelect} />
                );
        }
    };

    return (
        <div className="font-sans min-h-screen flex flex-col">
            <main className="flex-1 flex flex-col items-center p-8">
                {/* Always show the title */}
                <div className="text-center mb-12 w-full">
                    <h1 className="text-4xl sm:text-5xl font-bold mb-4">
                        Service Integrator
                    </h1>
                    {/* Only show subtitle on first step */}
                    {currentView === "service-selection" && (
                        <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                            A web app that integrates with Planning
                            Center&apos;s public Services API to aggregate data
                            and generate song copyright data in the format you
                            want.
                        </p>
                    )}
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
