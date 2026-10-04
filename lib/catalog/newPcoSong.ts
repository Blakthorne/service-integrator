import { checkCredits, renderCredits } from "@/lib/credits";
import type { Credit } from "@/lib/domain";
import type { NewPcoSongField } from "@/lib/queries/pcoSongs";
import { hasControlCharacter } from "@/lib/settings";
import { creditRows, readCreditsInput, type CreditNamesRow } from "./creditsEditor";

/**
 * The "Create in Planning Center" form of a catalog song with no Planning
 * Center song: its fields, a check of them before anything is sent (the
 * rules `createSongInPlanningCenter` applies, with every field's problem
 * at once rather than the first), what its confirmation shows, its words,
 * and what its action takes. Pure and safe on both sides; the query in
 * lib/queries/pcoSongs.ts checks everything again and has the last word.
 */

/**
 * The longest title taken: `PCO_SONG_TITLE_MAX_LENGTH` of
 * lib/queries/pcoSongs.ts, which is server-only (a test keeps them equal).
 */
export const NEW_PCO_SONG_TITLE_MAX_LENGTH = 255;
/** The longest copyright taken: `PCO_SONG_COPYRIGHT_MAX_LENGTH`, likewise. */
export const NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH = 1000;
/** The most digits of a CCLI song number: 15, as the query and the mirror take them. */
const CCLI_NUMBER_MAX_DIGITS = 15;

/** The form's fields, as typed. */
export interface NewPcoSongFields {
    title: string;
    /** The credits, as the credit editor's rows. */
    credits: CreditNamesRow[];
    copyright: string;
    /** The CCLI song number as typed; blank for none. */
    ccliNumber: string;
    /** Keep the details CCLI gives the song for its number (see `USE_CCLI_DETAILS_HINT`). */
    useCcliDetails: boolean;
}

/** The form's first values: `title` (see `pcoSongTitleFor`), a blank row per credit role, and nothing else. */
export function newPcoSongFields(title: string, roles: readonly string[]): NewPcoSongFields {
    return {
        title,
        credits: creditRows([], roles),
        copyright: "",
        ccliNumber: "",
        useCcliDetails: false,
    };
}

/** The form's parts in the order it shows them, for the first one with an error. */
export const NEW_PCO_SONG_FIELD_ORDER: readonly NewPcoSongField[] = [
    "title",
    "credits",
    "copyright",
    "ccliNumber",
];

/** What is wrong with each part of the form, fit to show beside it. */
export type NewPcoSongFieldErrors = Partial<Record<NewPcoSongField, string>>;

/** The form, checked: what Planning Center is sent, and the credits it reads as. */
export interface CheckedNewPcoSong {
    title: string;
    /** The credits, ready to write: one per role with names, in the order of the roles. */
    credits: Credit[];
    /** The credits in the convention, as the song's author; "" for none. */
    author: string;
    /** The copyright, trimmed; "" for none. */
    copyright: string;
    ccliNumber: number | null;
    useCcliDetails: boolean;
}

/** What `checkNewPcoSongFields` made of the form. */
export type NewPcoSongCheck =
    | { ok: true; song: CheckedNewPcoSong }
    | { ok: false; fieldErrors: NewPcoSongFieldErrors };

/** What a CCLI song number field reads as: its number, null when blank, or why it is not one. */
export type CcliSongNumberRead = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * A CCLI song number as typed: a whole number of at least 1 and at most
 * `CCLI_NUMBER_MAX_DIGITS` digits, spaces around it allowed; null when
 * blank. Anything else ("22,025", "-1", "0", "1.5", "abc") is refused with
 * the query's own message.
 */
export function readCcliSongNumber(text: string): CcliSongNumberRead {
    const digits = text.trim();
    if (digits === "") {
        return { ok: true, value: null };
    }
    if (!/^[0-9]+$/.test(digits) || digits.length > CCLI_NUMBER_MAX_DIGITS || /^0+$/.test(digits)) {
        return { ok: false, message: "A CCLI song number is a whole number, such as 22025." };
    }
    return { ok: true, value: Number(digits) };
}

/**
 * Check the form against `roles` (the `creditRoles` setting) as
 * `createSongInPlanningCenter` will: a title, on one line, of at most
 * `NEW_PCO_SONG_TITLE_MAX_LENGTH` characters; credits that `checkCredits`
 * takes (none at all is fine: the song then has no author); a copyright on
 * one line of at most `NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH` characters, or
 * none; and a CCLI song number or none. Every part's problem comes back at
 * once, in the query's words.
 */
export function checkNewPcoSongFields(
    fields: NewPcoSongFields,
    roles: readonly string[]
): NewPcoSongCheck {
    const fieldErrors: NewPcoSongFieldErrors = {};
    const title = fields.title.trim();
    if (title === "") {
        fieldErrors.title = "Enter the song's title.";
    } else if (hasControlCharacter(title)) {
        fieldErrors.title = "The title must be on one line.";
    } else if (title.length > NEW_PCO_SONG_TITLE_MAX_LENGTH) {
        fieldErrors.title = `The title is at most ${NEW_PCO_SONG_TITLE_MAX_LENGTH} characters.`;
    }
    const credits = checkCredits(fields.credits, roles);
    if (!credits.ok) {
        fieldErrors.credits = credits.message;
    }
    const copyright = fields.copyright.trim();
    if (hasControlCharacter(copyright)) {
        fieldErrors.copyright = "The copyright must be on one line.";
    } else if (copyright.length > NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH) {
        fieldErrors.copyright = `The copyright is at most ${NEW_PCO_SONG_COPYRIGHT_MAX_LENGTH} characters.`;
    }
    const ccliNumber = readCcliSongNumber(fields.ccliNumber);
    if (!ccliNumber.ok) {
        fieldErrors.ccliNumber = ccliNumber.message;
    }
    if (!credits.ok || !ccliNumber.ok || Object.keys(fieldErrors).length > 0) {
        return { ok: false, fieldErrors };
    }
    return {
        ok: true,
        song: {
            title,
            credits: credits.credits,
            author: renderCredits(credits.credits),
            copyright,
            ccliNumber: ccliNumber.value,
            useCcliDetails: fields.useCcliDetails,
        },
    };
}

/** What the credits field explains. */
export const NEW_PCO_SONG_CREDITS_HINT =
    "Who wrote the words and the music, and any arranger or translator. They go in Planning Center's author field with their roles as labels.";

/** What the copyright field explains. */
export const NEW_PCO_SONG_COPYRIGHT_HINT =
    'Leave it blank for a song in the public domain: the copyright text then says "Public Domain."';

/** What the CCLI number field explains. */
export const CCLI_SONG_NUMBER_HINT =
    "Optional: the song's number in CCLI SongSelect, such as 22025, for the church's CCLI reports.";

/** What "Use CCLI's details" explains: what a CCLI number makes Planning Center do, and what the box changes. */
export const USE_CCLI_DETAILS_HINT =
    "Given a CCLI number, Planning Center fills in the song's title, credits and copyright from CCLI's records. Tick this to keep what CCLI gives. Leave it unticked to have the title and credits typed here written back over CCLI's; the copyright stays as Planning Center fills it in. Without a CCLI number this changes nothing.";

/** One line of the confirmation: what Planning Center will get. */
export interface NewPcoSongSummaryLine {
    label: string;
    value: string;
}

/** What the confirmation shows of the song about to be created, a line per field. */
export function newPcoSongSummary(song: CheckedNewPcoSong): NewPcoSongSummaryLine[] {
    let ccli = "None";
    if (song.ccliNumber !== null) {
        ccli = song.useCcliDetails
            ? `${song.ccliNumber}, keeping the title, credits and copyright CCLI gives it`
            : `${song.ccliNumber}, with the title and credits typed here written back over CCLI's`;
    }
    return [
        { label: "Title", value: song.title },
        { label: "Author", value: song.author === "" ? "None" : song.author },
        {
            label: "Copyright",
            value: song.copyright === "" ? 'None: the copyright text says "Public Domain."' : song.copyright,
        },
        { label: "CCLI number", value: ccli },
    ];
}

/**
 * Where a song just created stands on the song page's Planning Center card:
 * "linked" once the page shows the link; "linking" while the page that
 * shows it is on its way (the action's answer can come a moment before the
 * page it revalidated); "not-linked" when the song was created but could
 * not be linked.
 */
export type CreatedSongStage = "linked" | "linking" | "not-linked";

/**
 * The stage of `created`, the song the card just created (null for none),
 * when the page shows the catalog song linked to `linkedPcoSongId` (null
 * when not linked). Null when there is nothing to say: no song was
 * created, or the catalog song is linked to another one since.
 */
export function createdSongStage(
    created: { pcoSongId: string; linked: boolean } | null,
    linkedPcoSongId: string | null
): CreatedSongStage | null {
    if (created === null) {
        return null;
    }
    if (linkedPcoSongId === created.pcoSongId) {
        return "linked";
    }
    if (linkedPcoSongId !== null) {
        return null;
    }
    return created.linked ? "linking" : "not-linked";
}

/** What the song page says once a song is created, for its stage. */
export function describeCreatedSong(title: string, stage: CreatedSongStage): string {
    switch (stage) {
        case "linked":
            return `Created "${title}" in Planning Center and linked this song to it.`;
        case "linking":
            return `Created "${title}" in Planning Center. Linking this song to it…`;
        case "not-linked":
            return `Created "${title}" in Planning Center, but this song is not linked to it.`;
    }
}

/** The form as an action receives it, its shape checked. */
export interface NewPcoSongInput {
    title: string;
    credits: Credit[];
    copyright: string;
    /** As typed: the action reads it with `readCcliSongNumber`. */
    ccliNumber: string;
    useCcliDetails: boolean;
}

/**
 * The form as an action receives it, from the network, so it may be
 * anything: an object with text `title`, `copyright` and `ccliNumber`,
 * credits that `readCreditsInput` takes, and a true or false
 * `useCcliDetails`. Null for anything else. It checks the shape only.
 */
export function readNewPcoSongInput(value: unknown): NewPcoSongInput | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const { title, credits, copyright, ccliNumber, useCcliDetails } = value as Record<string, unknown>;
    const read = readCreditsInput(credits);
    if (
        typeof title !== "string" ||
        typeof copyright !== "string" ||
        typeof ccliNumber !== "string" ||
        typeof useCcliDetails !== "boolean" ||
        read === null
    ) {
        return null;
    }
    return { title, credits: read, copyright, ccliNumber, useCcliDetails };
}
