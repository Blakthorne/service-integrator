import type {
    CatalogMatch,
    LinkSuggestion,
    PlanItemWithSong,
} from "./domain";
import type { ScheduleOption } from "./scheduleSelections";
import { catalogMatchFor, formatScheduleNumbers } from "./serviceSchedule";

/**
 * What the Schedule tab shows for each song item: which card, which choices,
 * and the words around them. Pure and safe on both sides: the tab's
 * components take these decisions from here, so they are tested without a
 * browser.
 */

/** What a plan's pages know of the catalog (see `PlanDetail`). */
export interface ScheduleCatalogState {
    /** The catalog song each linked Planning Center song is linked to, by its id. */
    catalog: Readonly<Record<string, CatalogMatch>>;
    /** Suggestions for each Planning Center song that is not linked and not set aside, by its id. */
    suggestions: Readonly<Record<string, readonly LinkSuggestion[]>>;
    /** Why the catalog could not be read, or null. */
    catalogError: string | null;
}

/** Which card a song item gets. */
export type ScheduleSongView =
    /** Its Planning Center song is linked to a catalog song: its numbers. */
    | { kind: "linked"; match: CatalogMatch }
    /** Its Planning Center song is not linked: suggestions to link it to, and ways to find or create its catalog song. */
    | { kind: "unlinked"; pcoSongId: string; suggestions: readonly LinkSuggestion[] }
    /** Its Planning Center song was set aside on Reconcile as not hymnal material. */
    | { kind: "ignored"; pcoSongId: string }
    /** It schedules no Planning Center song. */
    | { kind: "no-song" }
    /** The catalog could not be read, so whether it is linked is not known. */
    | { kind: "unknown" };

/** The card for a song item (see `ScheduleSongView`). */
export function scheduleSongView(
    item: Pick<PlanItemWithSong, "songId">,
    { catalog, suggestions, catalogError }: ScheduleCatalogState
): ScheduleSongView {
    if (item.songId === null) {
        return { kind: "no-song" };
    }
    if (catalogError !== null) {
        return { kind: "unknown" };
    }
    const match = catalogMatchFor(catalog, item.songId);
    if (match) {
        return { kind: "linked", match };
    }
    const found = catalogMatchFor(suggestions, item.songId);
    if (found) {
        return { kind: "unlinked", pcoSongId: item.songId, suggestions: found };
    }
    // `getPlanDetail` lists suggestions, perhaps none, for every song that
    // is neither linked nor set aside.
    return { kind: "ignored", pcoSongId: item.songId };
}

/**
 * The choices a card offers, in order: Numbers only for a song linked to a
 * catalog song in a book (as `hasNumbers` says), then Leave blank and
 * Custom for every song.
 */
export function scheduleChoices(view: ScheduleSongView): ScheduleOption[] {
    return view.kind === "linked" && view.match.entries.length > 0
        ? ["numbers", "blank", "custom"]
        : ["blank", "custom"];
}

/**
 * What a card says, through its status region, once a Link made on it has
 * gone through: "Linked: R-396 / G-317", the numbers the schedule text will
 * print (joined with `separator`, the `numberSeparator` setting), or that
 * the song is in no book. Null while the card still shows the song as not
 * linked, before the action's revalidation has brought the link. Should the
 * catalog be unreadable by then, just "Linked."
 */
export function linkedNotice(view: ScheduleSongView, separator?: string): string | null {
    if (view.kind === "unlinked") {
        return null;
    }
    if (view.kind !== "linked") {
        return "Linked.";
    }
    const numbers = formatScheduleNumbers(view.match.entries, separator);
    return numbers === ""
        ? "Linked. The song is in no book, so there are no numbers to print."
        : `Linked: ${numbers}`;
}

/** The label of each choice. */
export const SCHEDULE_OPTION_LABELS: Readonly<Record<ScheduleOption, string>> = {
    numbers: "Numbers",
    blank: "Leave blank",
    custom: "Custom",
};

/**
 * The Planning Center song's title when the item calls it something else
 * ("Come, Thou Fount of Every Blessing" for an item titled "Come Thou Fount
 * (Key of D)"), so a card can say what its suggestions were matched by; null
 * when they are the same or the item has no song.
 */
export function differentSongTitle(
    item: Pick<PlanItemWithSong, "title" | "song">
): string | null {
    const songTitle = item.song?.title.trim() ?? "";
    return songTitle !== "" && songTitle !== item.title.trim() ? songTitle : null;
}

/**
 * `lead`, then `reason` after a colon, as one sentence: "<lead>: <reason>."
 * A reason that already ends a sentence gets no second full stop, and an
 * empty one is left out ("<lead>.").
 */
function withReason(lead: string, reason: string): string {
    const text = reason.trim();
    if (text === "") {
        return `${lead}.`;
    }
    return `${lead}: ${/[.!?]$/.test(text) ? text : `${text}.`}`;
}

/**
 * What the Schedule tab says when the catalog cannot be read (see
 * `PlanDetail.catalogError`): "The catalog is unavailable: <why>. Numbers
 * can't be shown." A reason that already ends a sentence gets no second
 * full stop, and an empty one is left out.
 */
export function catalogUnavailableMessage(error: string): string {
    return `${withReason("The catalog is unavailable", error)} Numbers can't be shown.`;
}

/**
 * What the Schedule tab says when the plan's saved choices cannot be read
 * (see `PlanDetail.selectionsError`): every song shows its default. A choice
 * made on the tab is still saved, since the database may answer by then,
 * and its card says so when it is not.
 */
export function selectionsUnavailableMessage(error: string): string {
    return `${withReason("The saved choices couldn't be read", error)} Each song shows its default, and a choice made here says so if it can't be saved.`;
}

/**
 * What a card says when its choice could not be saved: "Not saved. <why>"
 * (`message`, from the save, as a sentence), beside its Retry. The choice
 * stays on screen.
 */
export function saveFailureText(message: string): string {
    const reason = message.trim();
    if (reason === "") {
        return "Not saved.";
    }
    return `Not saved. ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`;
}

/** What a card's status region says once a save that had failed has gone through. */
export const SAVED_AFTER_FAILURE_NOTICE = "Saved.";

/**
 * What a plan's tabs say when the settings cannot be read (see
 * `PlanDetail.settingsError`): their text then follows the defaults, which
 * give the text the app printed before it had settings.
 */
export function settingsUnavailableMessage(error: string): string {
    return `${withReason("The settings couldn't be read", error)} The text here uses the default settings.`;
}
