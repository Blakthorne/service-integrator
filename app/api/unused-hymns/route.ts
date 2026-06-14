import { NextResponse } from "next/server";
import hymnData from "@/hymns.json";
import { fetchAllSongs } from "@/lib/pco";
import {
    computeUnusedHymns,
    RawHymn,
    UnusedHymnsResult,
} from "@/lib/unusedHymns";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Process-local cache: shared within a single long-running server (this app's
// PM2 deploy). On a multi-instance/serverless host each instance gets its own.
let cache: { data: UnusedHymnsResult; expires: number } | null = null;

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const { searchParams } = new URL(request.url);
        const refresh = searchParams.get("refresh") === "1";
        const now = Date.now();

        if (!refresh && cache && cache.expires > now) {
            return NextResponse.json(cache.data);
        }

        const songs = await fetchAllSongs();
        const data = computeUnusedHymns(
            hymnData as RawHymn[],
            songs,
            new Date().toISOString()
        );
        cache = { data, expires: now + CACHE_TTL_MS };

        return NextResponse.json(data);
    } catch (error) {
        console.error("Error computing unused hymns:", error);
        return NextResponse.json(
            { error: "Failed to compute unused hymns" },
            { status: 500 }
        );
    }
}
