import { Suspense } from "react";
import type { SongHistory } from "@/lib/reports";
import HistoryCard from "./HistoryCard";

/** What a song's page gives its History card. */
export interface SongHistoryInput {
    history: SongHistory;
    /** Whether the plan history holds any plan (see `HistoryCard`). */
    historyRead: boolean;
    /**
     * The service types' names by id (`getServiceTypeNames`, with a
     * deadline), which the page starts reading before it renders. Planning
     * Center is where they are, and the rest of the page reads only the
     * local database.
     */
    serviceTypeNames: Promise<Record<string, string>>;
}

/** The card with the names once they are in. */
async function HistoryCardWithNames({ history, historyRead, serviceTypeNames }: SongHistoryInput) {
    return (
        <HistoryCard
            history={history}
            historyRead={historyRead}
            serviceTypeNames={await serviceTypeNames}
        />
    );
}

/**
 * A song's History card, streamed in under its own Suspense boundary so
 * that the names of the service types, which come from Planning Center,
 * never hold back the page: until they are in (cached for five minutes, so
 * usually at once) the card is shown with "Service type <id>" in their
 * place, and a failure or a slow Planning Center leaves it so. The page
 * reads everything else from the local database.
 */
export default function SongHistorySection(props: SongHistoryInput) {
    return (
        <Suspense
            fallback={
                <HistoryCard
                    history={props.history}
                    historyRead={props.historyRead}
                    serviceTypeNames={{}}
                />
            }
        >
            <HistoryCardWithNames {...props} />
        </Suspense>
    );
}
