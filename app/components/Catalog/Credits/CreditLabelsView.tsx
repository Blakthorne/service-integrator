"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import {
    requestCreditLabelsAction,
    type CreditLabelsActionResult,
} from "@/app/(app)/catalog/credits/actions";
import Dialog from "@/app/components/ui/Dialog";
import { buttonClasses } from "@/app/components/ui/buttonClasses";
import {
    CREDIT_LABEL_SHAPE_WORDS,
    TRUSTED_CREDIT_LABEL_SHAPES,
    type CreditLabelRowView,
    type CreditLabelTierView,
} from "@/lib/creditLabels";
import { routes } from "@/lib/routes";
import { LINK_CLASS } from "../CatalogCard";
import PcoSongWebLink from "../Reconcile/PcoSongWebLink";
import { SMALL_BUTTON_CLASS } from "../Song/styles";

/** What the page says when the action itself fails (no session, the network). */
const COULD_NOT_ASK: CreditLabelsActionResult = {
    ok: false,
    message: "The labels could not be asked for: it is not known whether any were. Reload the page to see.",
};

/** A shape's songs are listed open when there are at most this many; more fold under their count. */
const OPEN_TIER_ROWS = 20;

interface CreditLabelsViewProps {
    /** The songs the app can label, by shape (`toCreditLabelTierViews`). */
    tiers: CreditLabelTierView[];
}

/**
 * The Credits page's songs that the app can label, a section per shape
 * (one author, words and music, three names), each with what its label
 * means, Select all and Clear, and its songs: each one's author in
 * Planning Center now, the label it would get, and, when the copyright
 * text would print it differently, how. A song whose label waits to be
 * written says so instead of offering a box.
 *
 * Label opens a dialog that says what will be written; its Label sends the
 * labels the page showed for the chosen songs, with the authors it showed
 * them for (`requestCreditLabelsAction`), from the click with its pending
 * state in `useState` (convention 15). The server holds each to what the
 * page showed. What it did is said in a status region above the sections.
 */
export default function CreditLabelsView({ tiers }: CreditLabelsViewProps) {
    const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
    const [confirming, setConfirming] = useState(false);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<CreditLabelsActionResult | null>(null);
    const labelButtonRef = useRef<HTMLButtonElement>(null);
    const statusId = useId();

    const open = tiers.flatMap(({ rows }) => rows.filter((row) => !row.queued));
    const chosenRows = open.filter((row) => chosen.has(row.pcoSongId));
    const reprinted = chosenRows.filter((row) => row.lineAfter !== null).length;

    function setRows(rows: readonly CreditLabelRowView[], on: boolean) {
        setChosen((current) => {
            const next = new Set(current);
            for (const row of rows) {
                if (on) {
                    next.add(row.pcoSongId);
                } else {
                    next.delete(row.pcoSongId);
                }
            }
            return next;
        });
    }

    async function label() {
        if (pending || chosenRows.length === 0) {
            return;
        }
        setPending(true);
        try {
            const answer = await requestCreditLabelsAction(
                chosenRows.map(({ pcoSongId, author, label }) => ({
                    pcoSongId,
                    shownAuthor: author,
                    author: label,
                }))
            );
            setResult(answer);
            setChosen(new Set());
        } catch (error) {
            console.error("Asking for the credit labels failed:", error);
            setResult(COULD_NOT_ASK);
        } finally {
            setPending(false);
            setConfirming(false);
        }
    }

    if (tiers.every(({ rows }) => rows.length === 0)) {
        return (
            <p className="text-sm text-gray-600 dark:text-gray-300">
                No song has an author the app can label: each one is labelled already, or
                needs a person (below).
            </p>
        );
    }

    return (
        <div className="space-y-8">
            <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white/95 px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800/95">
                <button
                    ref={labelButtonRef}
                    type="button"
                    aria-disabled={chosenRows.length === 0 || pending}
                    aria-describedby={statusId}
                    onClick={() => {
                        if (chosenRows.length > 0 && !pending) {
                            setResult(null);
                            setConfirming(true);
                        }
                    }}
                    className={buttonClasses("primary", chosenRows.length === 0 || pending)}
                >
                    {chosenRows.length === 0
                        ? "Label the songs chosen…"
                        : `Label ${chosenRows.length} ${chosenRows.length === 1 ? "song" : "songs"}…`}
                </button>
                {chosenRows.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setChosen(new Set())}
                        className={SMALL_BUTTON_CLASS}
                    >
                        Clear the choice
                    </button>
                )}
                <p
                    id={statusId}
                    role="status"
                    className={`text-sm ${
                        result?.ok === false
                            ? "text-red-600 dark:text-red-400"
                            : "text-gray-600 dark:text-gray-300"
                    }`}
                >
                    {result?.message ??
                        (chosenRows.length === 0
                            ? "Choose songs below, a shape at a time or one by one."
                            : null)}
                </p>
            </div>

            {tiers.map((tier) => (
                <CreditLabelTier
                    key={tier.shape}
                    tier={tier}
                    chosen={chosen}
                    onChoose={(row, on) => setRows([row], on)}
                    onChooseAll={(on) => setRows(tier.rows.filter((row) => !row.queued), on)}
                />
            ))}

            <Dialog
                open={confirming}
                onClose={() => setConfirming(false)}
                title={`Label ${chosenRows.length} ${chosenRows.length === 1 ? "song" : "songs"} in Planning Center?`}
                returnFocusRef={labelButtonRef}
                dismissible={!pending}
            >
                <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
                    <p>
                        Each song&apos;s author in Planning Center becomes its label, as this page
                        shows it. The app writes them in the background, a few a second, and this
                        page shows how it goes.
                    </p>
                    <p>
                        A song whose author was changed in Planning Center since this page loaded is
                        left as it is. Nothing else about the songs changes.
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                        {tiers.map(({ shape, rows }) => {
                            const count = rows.filter((row) => chosen.has(row.pcoSongId) && !row.queued).length;
                            return count === 0 ? null : (
                                <li key={shape}>
                                    {CREDIT_LABEL_SHAPE_WORDS[shape].heading}: {count}
                                </li>
                            );
                        })}
                    </ul>
                    {reprinted > 0 && (
                        <p className="font-medium text-amber-800 dark:text-amber-200">
                            The copyright text of {reprinted} of them will print differently, as each
                            one&apos;s row shows.
                        </p>
                    )}
                    <div className="flex flex-wrap justify-end gap-3 pt-2">
                        <button
                            type="button"
                            aria-disabled={pending}
                            onClick={() => {
                                if (!pending) {
                                    setConfirming(false);
                                }
                            }}
                            className={buttonClasses("secondary", pending)}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            aria-disabled={pending}
                            onClick={label}
                            className={buttonClasses("primary", pending)}
                        >
                            {pending
                                ? "Asking…"
                                : `Label ${chosenRows.length} ${chosenRows.length === 1 ? "song" : "songs"}`}
                        </button>
                    </div>
                </div>
            </Dialog>
        </div>
    );
}

interface CreditLabelTierProps {
    tier: CreditLabelTierView;
    chosen: ReadonlySet<string>;
    onChoose: (row: CreditLabelRowView, on: boolean) => void;
    onChooseAll: (on: boolean) => void;
}

/** One shape's section: its heading, what it means, Select all and Clear, and its songs. */
function CreditLabelTier({ tier, chosen, onChoose, onChooseAll }: CreditLabelTierProps) {
    const headingId = useId();
    const words = CREDIT_LABEL_SHAPE_WORDS[tier.shape];
    const open = tier.rows.filter((row) => !row.queued);
    const chosenHere = open.filter((row) => chosen.has(row.pcoSongId)).length;
    const waiting = tier.rows.length - open.length;
    const trusted = TRUSTED_CREDIT_LABEL_SHAPES.includes(tier.shape);

    return (
        <section aria-labelledby={headingId} className="space-y-3">
            <div>
                <h2 id={headingId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {words.heading}{" "}
                    <span className="font-normal text-gray-500 dark:text-gray-400 tabular-nums">
                        ({tier.rows.length})
                    </span>
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {words.description}
                    {trusted &&
                        " With Label new songs automatically on (Settings), the app labels a new song of this shape by itself."}
                </p>
            </div>
            {tier.rows.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No songs.</p>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                        <button
                            type="button"
                            aria-disabled={open.length === 0 || chosenHere === open.length}
                            onClick={() => onChooseAll(true)}
                            className={SMALL_BUTTON_CLASS}
                        >
                            Select all {open.length}
                            <span className="sr-only"> {words.heading}</span>
                        </button>
                        <button
                            type="button"
                            aria-disabled={chosenHere === 0}
                            onClick={() => onChooseAll(false)}
                            className={SMALL_BUTTON_CLASS}
                        >
                            Clear<span className="sr-only"> {words.heading}</span>
                        </button>
                        <span className="tabular-nums">
                            {chosenHere} chosen
                            {waiting > 0 && ` · ${waiting} waiting to be written`}
                        </span>
                    </div>
                    <details
                        open={tier.rows.length <= OPEN_TIER_ROWS}
                        className="group rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
                    >
                        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-gray-100 dark:hover:bg-gray-700 [&::-webkit-details-marker]:hidden">
                            <span className="group-open:hidden">Show the {tier.rows.length} songs</span>
                            <span className="hidden group-open:inline">Hide the songs</span>
                        </summary>
                        <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700 dark:border-gray-700">
                            {tier.rows.map((row) => (
                                <CreditLabelRow
                                    key={row.pcoSongId}
                                    row={row}
                                    chosen={chosen.has(row.pcoSongId)}
                                    onChoose={onChoose}
                                />
                            ))}
                        </ul>
                    </details>
                </>
            )}
        </section>
    );
}

interface CreditLabelRowProps {
    row: CreditLabelRowView;
    chosen: boolean;
    onChoose: (row: CreditLabelRowView, on: boolean) => void;
}

/** One song: its box (or that it waits), its title, its author now and the label it would get. */
function CreditLabelRow({ row, chosen, onChoose }: CreditLabelRowProps) {
    const boxId = useId();
    return (
        <li className="flex gap-3 px-4 py-3">
            <div className="w-5 shrink-0 pt-0.5">
                {!row.queued && (
                    <input
                        id={boxId}
                        type="checkbox"
                        checked={chosen}
                        onChange={(event) => onChoose(row, event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                    />
                )}
            </div>
            <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <label htmlFor={row.queued ? undefined : boxId} className="font-medium text-gray-900 dark:text-gray-100">
                        {row.title}
                    </label>
                    {row.catalogSongId !== null ? (
                        // No prefetch: the list runs to hundreds of songs.
                        <Link
                            href={routes.catalogSong(row.catalogSongId)}
                            prefetch={false}
                            className={LINK_CLASS}
                        >
                            Song page<span className="sr-only"> of {row.title}</span>
                        </Link>
                    ) : (
                        <PcoSongWebLink pcoSongId={row.pcoSongId} />
                    )}
                    {row.queued && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                            Waiting to be written
                        </span>
                    )}
                </div>
                <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]">
                    <dt className="text-gray-500 dark:text-gray-400">Now</dt>
                    <dd className="break-words text-gray-700 dark:text-gray-300">{row.author}</dd>
                    <dt className="text-gray-500 dark:text-gray-400">Label</dt>
                    <dd className="break-words font-medium text-gray-900 dark:text-gray-100">{row.label}</dd>
                    {row.lineAfter !== null && (
                        <>
                            <dt className="text-amber-800 dark:text-amber-200">Prints</dt>
                            <dd className="break-words text-amber-800 dark:text-amber-200">
                                {row.lineAfter} <span className="text-gray-500 dark:text-gray-400">(now: {row.lineBefore})</span>
                            </dd>
                        </>
                    )}
                </dl>
            </div>
        </li>
    );
}
