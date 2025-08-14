import { NextResponse } from "next/server";
import { ServiceTypeData } from "../service-types/route";
import { PlanData } from "../plans/route";

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

export async function GET() {
    try {
        // Get credentials from environment variables
		const planningCenterId: string | undefined = process.env.PLANNING_CENTER_ID;
		const planningCenterToken: string | undefined = process.env.PLANNING_CENTER_TOKEN;

		if (!planningCenterId || !planningCenterToken) {
			return NextResponse.json(
				{ error: 'Planning Center credentials not configured' },
				{ status: 500 }
			);
		}

		// Create Basic Auth header
		const credentials: string = Buffer.from(`${planningCenterId}:${planningCenterToken}`).toString('base64');

        // Fetch service types first
        const serviceTypesResponse = await fetch(
            "https://api.planningcenteronline.com/services/v2/service_types",
            {
				headers: {
					'Authorization': `Basic ${credentials}`,
					'Content-Type': 'application/json',
				},
            }
        );

        if (!serviceTypesResponse.ok) {
            throw new Error(`HTTP error! status: ${serviceTypesResponse.status}`);
        }

        const serviceTypesData = await serviceTypesResponse.json();
        const serviceTypes = serviceTypesData.data;

        // Fetch plans for each service type in parallel
        const plansPromises = serviceTypes.map(async (serviceType: ServiceTypeData) => {
            const plansResponse = await fetch(
                `https://api.planningcenteronline.com/services/v2/service_types/${serviceType.id}/plans?order=-sort_date&per_page=500`,
                {
                    headers: {
                        'Authorization': `Basic ${credentials}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!plansResponse.ok) {
                console.error(
                    `Failed to fetch plans for service type ${serviceType.id}`
                );
                return [];
            }

            const plansData = await plansResponse.json();
            return plansData.data.map((plan: PlanData) => ({
                id: plan.id,
                dates: plan.attributes.dates,
                shortDates: plan.attributes.short_dates,
                planningCenterUrl: plan.links.self,
                itemsCount: plan.attributes.items_count,
                title: plan.attributes.title,
                sortDate: plan.attributes.sort_date,
                createdAt: plan.attributes.created_at,
                updatedAt: plan.attributes.updated_at,
                serviceType: {
                    id: serviceType.id,
                    name: serviceType.attributes.name,
                },
            }));
        });

        const allPlansArrays = await Promise.all(plansPromises);
        const allPlans = allPlansArrays.flat();

        // Sort all plans by date
        allPlans.sort((a: Plan, b: Plan) => b.sortDate.localeCompare(a.sortDate));

        // Group plans by date
        const plansByDate = allPlans.reduce((acc: { [key: string]: Plan[] }, plan: Plan) => {
            const date = plan.sortDate.split("T")[0]; // Get just the date part
            if (!acc[date]) {
                acc[date] = [];
            }
            acc[date].push(plan);
            return acc;
        }, {});

        return NextResponse.json({
            plansByDate,
            totalCount: allPlans.length,
        });
    } catch (error) {
        console.error("Error in plans route:", error);
        return NextResponse.json(
            { error: "Failed to fetch plans" },
            { status: 500 }
        );
    }
}
