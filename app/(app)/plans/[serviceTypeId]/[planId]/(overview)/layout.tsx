import PlanHeader from "@/app/components/PlanItems/PlanHeader";
import PlanItemsTable from "@/app/components/PlanItems/PlanItemsTable";
import PlanTabNav from "@/app/components/PlanItems/PlanTabNav";

/**
 * The plan page around its tabs: the header, the items table and the tab nav,
 * with the active tab (Copyright Information or Service Schedule) below.
 * Everything here reads the plan from PlanProvider, so switching tabs fetches
 * nothing from Planning Center.
 *
 * PlanTabNav has to be rendered by this layout: `useSelectedLayoutSegment()`
 * gives null or "schedule" here, but "(overview)" one level up.
 */
export default function PlanOverviewLayout({
    children,
}: LayoutProps<"/plans/[serviceTypeId]/[planId]">) {
    return (
        <>
            <PlanHeader />
            <PlanItemsTable />
            <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
                <PlanTabNav />
                {children}
            </div>
        </>
    );
}
