import hymnData from '@/hymns.json';

interface RawHymn {
    song_title: string;
    tune_name: string;
    great_hymns_of_the_faith: number;
    rejoice_hymns: number;
}

interface HymnVersion {
    id: string;
    tune_name: string;
    rejoice_hymns_number: string;
    great_hymns_number: string;
    selected: boolean;
}

interface HymnResponse {
    song_title: string;
    versions: HymnVersion[];
}

// Group hymns by song title to handle multiple versions (case-insensitive)
const hymnsBySongTitle = new Map<string, RawHymn[]>();
(hymnData as RawHymn[]).forEach(hymn => {
    const lowerCaseTitle = hymn.song_title.toLowerCase();
    const existingHymns = hymnsBySongTitle.get(lowerCaseTitle) || [];
    hymnsBySongTitle.set(lowerCaseTitle, [...existingHymns, hymn]);
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const titles: string[] = body.titles;
        
        if (!Array.isArray(titles)) {
            return Response.json({ hymns: [] });
        }
        
        const processedHymns: HymnResponse[] = titles.map((title: string) => {
            const matchingHymns = hymnsBySongTitle.get(title.toLowerCase()) || [];
            return {
                song_title: title,
                versions: matchingHymns.map((hymn: RawHymn, index: number) => ({
                    id: `${hymn.song_title}-${index}`, // Generate a unique ID
                    tune_name: hymn.tune_name,
                    rejoice_hymns_number: hymn.rejoice_hymns.toString(),
                    great_hymns_number: hymn.great_hymns_of_the_faith.toString(),
                    selected: matchingHymns.length === 1 // Auto-select if only one version exists
                }))
            };
        }).filter(result => result.versions.length > 0);

        return Response.json({ hymns: processedHymns });
    } catch (error) {
        console.error('Error processing hymn data:', error);
        return Response.json({ error: 'Failed to process hymn data' }, { status: 500 });
    }
}