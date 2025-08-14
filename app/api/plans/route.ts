import { NextResponse } from 'next/server';

interface PlanAttributes {
	can_view_order: boolean;
	created_at: string;
	dates: string;
	files_expire_at: string;
	items_count: number;
	last_time_at: string;
	multi_day: boolean;
	needed_positions_count: number;
	other_time_count: number;
	permissions: string;
	plan_notes_count: number;
	plan_people_count: number;
	planning_center_url: string;
	prefers_order_view: boolean;
	public: boolean;
	rehearsable: boolean;
	rehearsal_time_count: number;
	reminders_disabled: boolean;
	series_title: string | null;
	service_time_count: number;
	short_dates: string;
	sort_date: string;
	title: string | null;
	total_length: number;
	updated_at: string;
}

interface PlanData {
	type: string;
	id: string;
	attributes: PlanAttributes;
}

interface PlansResponse {
	data: PlanData[];
	meta: {
		total_count: number;
		count: number;
	};
}

export async function GET(request: Request): Promise<NextResponse> {
	try {
		// Get the service type ID from query parameters
		const { searchParams } = new URL(request.url);
		const serviceTypeId: string | null = searchParams.get('serviceTypeId');

		if (!serviceTypeId) {
			return NextResponse.json(
				{ error: 'Service type ID is required' },
				{ status: 400 }
			);
		}

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
		
		// Fetch plans from Planning Center API
		const response: Response = await fetch(
			`https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans?order=sort_date&per_page=400`,
			{
				headers: {
					'Authorization': `Basic ${credentials}`,
					'Content-Type': 'application/json',
				},
			}
		);

		if (!response.ok) {
			throw new Error(`Planning Center API responded with status: ${response.status}`);
		}

		const data: PlansResponse = await response.json();
		
		// Extract and format plans
		const plans: Array<{
			id: string;
			dates: string;
			shortDates: string;
			planningCenterUrl: string;
			itemsCount: number;
			title: string | null;
			sortDate: string;
			createdAt: string;
			updatedAt: string;
		}> = data.data.map((item: PlanData) => ({
			id: item.id,
			dates: item.attributes.dates,
			shortDates: item.attributes.short_dates,
			planningCenterUrl: item.attributes.planning_center_url,
			itemsCount: item.attributes.items_count,
			title: item.attributes.title,
			sortDate: item.attributes.sort_date,
			createdAt: item.attributes.created_at,
			updatedAt: item.attributes.updated_at,
		}));

		// Sort plans by sort date (newest first)
		const sortedPlans: Array<{
			id: string;
			dates: string;
			shortDates: string;
			planningCenterUrl: string;
			itemsCount: number;
			title: string | null;
			sortDate: string;
			createdAt: string;
			updatedAt: string;
		}> = plans.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

		return NextResponse.json({
			plans: sortedPlans,
			totalCount: data.meta.total_count,
		});

	} catch (error: unknown) {
		console.error('Error fetching plans:', error);
		return NextResponse.json(
			{ error: 'Failed to fetch plans' },
			{ status: 500 }
		);
	}
}
