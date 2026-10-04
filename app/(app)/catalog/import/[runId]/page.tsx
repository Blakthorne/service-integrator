import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ImportNotice from "@/app/components/Catalog/Import/ImportNotice";
import ImportRunActions from "@/app/components/Catalog/Import/ImportRunActions";
import ImportStatusBadge from "@/app/components/Catalog/Import/ImportStatusBadge";
import {
    describePlanned,
    importRunLabel,
} from "@/lib/catalog/importText";
import SeedReport from "@/app/components/Catalog/Import/SeedReport";
import LocalTime from "@/app/components/ui/LocalTime";
import PageHeader from "@/app/components/ui/PageHeader";
import { parseCatalogId } from "@/lib/catalog/ids";
import type { ImportRunDetail } from "@/lib/domain";
import {
    getCatalogImportRun,
    getCatalogImportRunLabel,
    type ImportRunRefusal,
} from "@/lib/queries/catalogImport";
import { routes } from "@/lib/routes";

/**
 * The tab title is the run's label, "Seed import 3". `getCatalogImportRunLabel`
 * never throws and falls back to "Import run" for an id that is invalid or
 * unknown (convention 12).
 */
export async function generateMetadata({
    params,
}: Pick<PageProps<"/catalog/import/[runId]">, "params">): Promise<Metadata> {
    const { runId } = await params;
    return { title: getCatalogImportRunLabel(runId) };
}

/** The id of the sentence that says why Apply is unavailable, which the button is described by. */
const APPLY_REFUSAL_ID = "apply-refusal";

interface RunNoticeProps {
    run: ImportRunDetail;
    /** Why Apply would be refused now, or null. */
    applyRefusal: ImportRunRefusal | null;
}

/**
 * Where the run stands, in a sentence: a preview, one that cannot be applied,
 * or one that is finished. A preview's Apply and Discard buttons sit beside
 * the sentence, so a refusal's reason is next to the Apply it disables.
 */
function RunNotice({ run, applyRefusal }: RunNoticeProps) {
    switch (run.status) {
        case "applied":
            return (
                <ImportNotice tone="success">
                    Applied: this run&apos;s rows are in the catalog.{" "}
                    <Link href={routes.catalog()} className="underline">
                        Browse the songs
                    </Link>
                    .
                </ImportNotice>
            );
        case "discarded":
            return (
                <ImportNotice tone="neutral">
                    Discarded: nothing from this run was added to the catalog.
                </ImportNotice>
            );
        case "preview": {
            const actions = (
                <ImportRunActions
                    runId={run.id}
                    plannedText={describePlanned(run.planned)}
                    applyUnavailableId={applyRefusal ? APPLY_REFUSAL_ID : undefined}
                />
            );
            return applyRefusal ? (
                <ImportNotice tone="warning" id={APPLY_REFUSAL_ID} actions={actions}>
                    {applyRefusal.message} You can still review the report; discard
                    this preview when you are done.
                </ImportNotice>
            ) : (
                <ImportNotice tone="info" actions={actions}>
                    This is a preview: nothing has been added to the catalog yet.
                    Review the report below, then apply it or discard it.
                </ImportNotice>
            );
        }
    }
}

/**
 * One import run: its status and its report. A preview offers Apply and
 * Discard, each behind a confirmation, and Apply is unavailable while the
 * catalog has books. An id that is not a catalog id, or a run the catalog
 * does not have, ends in `not-found.tsx`.
 */
export default async function ImportRunPage({
    params,
}: PageProps<"/catalog/import/[runId]">) {
    const raw = await params;
    const runId = parseCatalogId(raw.runId) ?? notFound();
    const review = getCatalogImportRun(runId) ?? notFound();
    const { run, applyRefusal } = review;
    const label = importRunLabel(run);

    return (
        <div className="font-sans">
            <PageHeader
                title={label}
                description={
                    <>
                        {run.sourceName} · previewed <LocalTime iso={run.at} />{" "}
                        <ImportStatusBadge status={run.status} />
                    </>
                }
                breadcrumbs={[
                    { label: "Catalog", href: routes.catalog() },
                    { label: "Import", href: routes.catalogImport() },
                    { label },
                ]}
            />
            <div className="w-full max-w-5xl mx-auto space-y-6">
                <RunNotice run={run} applyRefusal={applyRefusal} />
                <SeedReport report={run.report} sourceName={run.sourceName} />
            </div>
        </div>
    );
}
