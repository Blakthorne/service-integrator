import { NextResponse } from 'next/server';

interface ServiceTypeAttributes {
	name: string;
	frequency: string;
	sequence: number;
	archived_at: string | null;
	created_at: string;
	updated_at: string;
}

interface ServiceTypeData {
	type: string;
	id: string;
	attributes: ServiceTypeAttributes;
	relationships: Record<string, unknown>;
	links: Record<string, unknown>;
}

interface PlanningCenterResponse {
    links: Record<string, unknown>;
    data: ServiceTypeData[];
    included: unknown[];
    meta: {
        total_count: number;
        count: number;
        can_order_by: string[];
        can_query_by: string[];
        can_include: string[];
        can_filter: string[];
        parent: {
            id: string;
            type: string;
        };
    };
}

export async function GET(): Promise<NextResponse> {
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
		
		// Fetch service types from Planning Center API
		const response: Response = await fetch('https://api.planningcenteronline.com/services/v2/service_types', {
			headers: {
				'Authorization': `Basic ${credentials}`,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			throw new Error(`Planning Center API responded with status: ${response.status}`);
		}

		const data: PlanningCenterResponse = await response.json();
		
		// Extract and format service types
		const serviceTypes: Array<{
			id: string;
			name: string;
			frequency: string;
			sequence: number;
			archived: boolean;
			createdAt: string;
			updatedAt: string;
		}> = data.data.map((item: ServiceTypeData) => ({
			id: item.id,
			name: item.attributes.name,
			frequency: item.attributes.frequency,
			sequence: item.attributes.sequence,
			archived: item.attributes.archived_at !== null,
			createdAt: item.attributes.created_at,
			updatedAt: item.attributes.updated_at,
		}));

		// Filter out archived service types and sort by sequence
		const activeServiceTypes: Array<{
			id: string;
			name: string;
			frequency: string;
			sequence: number;
			archived: boolean;
			createdAt: string;
			updatedAt: string;
		}> = serviceTypes
			.filter((type: { archived: boolean }) => !type.archived)
			.sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence);

		return NextResponse.json({
			serviceTypes: activeServiceTypes,
			totalCount: data.meta.total_count,
		});

	} catch (error: unknown) {
		console.error('Error fetching service types:', error);
		return NextResponse.json(
			{ error: 'Failed to fetch service types' },
			{ status: 500 }
		);
	}
}
