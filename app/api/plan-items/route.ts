import { NextResponse } from 'next/server';

interface ItemAttributes {
	created_at: string;
	custom_arrangement_sequence: string | null;
	custom_arrangement_sequence_full: string | null;
	custom_arrangement_sequence_short: string | null;
	description: string | null;
	html_details: string | null;
	item_type: string;
	key_name: string | null;
	length: number;
	sequence: number;
	service_position: string;
	title: string;
	updated_at: string;
}

interface ItemData {
	type: string;
	id: string;
	attributes: ItemAttributes;
}

interface SongAttributes {
	admin: string | null;
	author: string;
	ccli_number: number;
	copyright: string;
	created_at: string;
	hidden: boolean;
	last_scheduled_at: string;
	last_scheduled_short_dates: string;
	notes: string;
	themes: string;
	title: string;
	updated_at: string;
}

interface SongData {
	type: string;
	id: string;
	attributes: SongAttributes;
	links: {
		self: string;
	};
}

interface PlanItemsResponse {
	data: ItemData[];
	included: SongData[];
	meta: {
		total_count: number;
		count: number;
	};
}

export async function GET(request: Request): Promise<NextResponse> {
	try {
		// Get the service type ID and plan ID from query parameters
		const { searchParams } = new URL(request.url);
		const serviceTypeId: string | null = searchParams.get('serviceTypeId');
		const planId: string | null = searchParams.get('planId');

		if (!serviceTypeId || !planId) {
			return NextResponse.json(
				{ error: 'Service type ID and plan ID are required' },
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
		
		// Fetch plan items from Planning Center API
		const response: Response = await fetch(
			`https://api.planningcenteronline.com/services/v2/service_types/${serviceTypeId}/plans/${planId}/items?include=song`,
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

		const data: PlanItemsResponse = await response.json();
		
		// Extract and format items
		const items: Array<{
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
		}> = data.data.map((item: ItemData) => ({
			id: item.id,
			title: item.attributes.title,
			itemType: item.attributes.item_type,
			sequence: item.attributes.sequence,
			servicePosition: item.attributes.service_position,
			keyName: item.attributes.key_name,
			length: item.attributes.length,
			description: item.attributes.description,
			createdAt: item.attributes.created_at,
			updatedAt: item.attributes.updated_at,
		}));

		// Sort items by sequence
		const sortedItems: Array<{
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
		}> = items.sort((a, b) => a.sequence - b.sequence);

		// Extract and format included songs/items
		const included: Array<{
			id: string;
			title: string;
			author: string;
			admin: string | null;
			ccliNumber: number;
			copyright: string;
			notes: string;
			themes: string;
			createdAt: string;
			updatedAt: string;
			planningCenterUrl: string;
		}> = (data.included || []).map((song: SongData) => ({
			id: song.id,
			title: song.attributes.title,
			author: song.attributes.author,
			admin: song.attributes.admin,
			ccliNumber: song.attributes.ccli_number,
			copyright: song.attributes.copyright,
			notes: song.attributes.notes,
			themes: song.attributes.themes,
			createdAt: song.attributes.created_at,
			updatedAt: song.attributes.updated_at,
			planningCenterUrl: song.links.self,
		}));

		return NextResponse.json({
			items: sortedItems,
			included: included,
			totalCount: data.meta.total_count,
		});

	} catch (error: unknown) {
		console.error('Error fetching plan items:', error);
		return NextResponse.json(
			{ error: 'Failed to fetch plan items' },
			{ status: 500 }
		);
	}
}
