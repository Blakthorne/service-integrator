import { hymnCatalog } from "@/lib/hymnCatalog";
import { buildHymnIndex, matchHymns } from "@/lib/hymnMatch";

// Group hymns by song title to handle multiple versions (case-insensitive)
const hymnsBySongTitle = buildHymnIndex(hymnCatalog);

export async function POST(request: Request) {
    try {
        const body = await request.json();

        return Response.json({ hymns: matchHymns(hymnsBySongTitle, body.titles) });
    } catch (error) {
        console.error('Error processing hymn data:', error);
        return Response.json({ error: 'Failed to process hymn data' }, { status: 500 });
    }
}
