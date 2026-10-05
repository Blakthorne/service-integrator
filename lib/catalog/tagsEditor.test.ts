import { describe, expect, test } from "vitest";
import type { PcoTagGroup } from "@/lib/domain";
import {
    NO_SONG_TAGS,
    chooseTag,
    clearTagGroup,
    describeTagChanges,
    describeTagsSave,
    readTagIdsInput,
    sameTagSelection,
    songTagLines,
    songTagSelection,
    tagChanges,
    tagGroupHint,
} from "./tagsEditor";

/** A group with tags `[id, name]`, in the order given (the mirror's: by name). */
function group(id: string, name: string, allowMultiple: boolean, tags: [string, string][]): PcoTagGroup {
    return {
        id,
        name,
        tagsFor: "song",
        allowMultiple,
        tags: tags.map(([tagId, tagName]) => ({ id: tagId, groupId: id, name: tagName })),
    };
}

const SEASON = group("30", "Season", false, [
    ["301", "Advent"],
    ["302", "Easter"],
    ["303", "Lent"],
]);
const TYPE = group("10", "Type", true, [
    ["101", "Chorus"],
    ["102", "Hymn"],
    ["103", "Invitation"],
]);
const EMPTY = group("40", "Unused", true, []);
const GROUPS = [SEASON, TYPE, EMPTY];

describe("songTagLines", () => {
    test("lists the song's tags by group, in the mirror's order, leaving out groups it has none of", () => {
        expect(songTagLines(GROUPS, [{ id: "103" }, { id: "302" }, { id: "102" }])).toEqual([
            { groupId: "30", group: "Season", tags: ["Easter"] },
            { groupId: "10", group: "Type", tags: ["Hymn", "Invitation"] },
        ]);
    });

    test("lists nothing for a song with no tags, or tags of no group listed", () => {
        expect(songTagLines(GROUPS, [])).toEqual([]);
        expect(songTagLines(GROUPS, [{ id: "999" }])).toEqual([]);
    });
});

describe("the selection", () => {
    test("starts from the song's tags of the groups, in the mirror's order", () => {
        expect(songTagSelection(GROUPS, [{ id: "103" }, { id: "999" }, { id: "301" }])).toEqual([
            "301",
            "103",
        ]);
    });

    test("adds and removes a tag of a group that takes any number", () => {
        expect(chooseTag(["102"], GROUPS, TYPE, "101", true)).toEqual(["101", "102"]);
        expect(chooseTag(["101", "102"], GROUPS, TYPE, "101", false)).toEqual(["102"]);
        expect(chooseTag(["102"], GROUPS, TYPE, "102", true)).toEqual(["102"]);
    });

    test("gives up a one-tag group's other tag when one is chosen, and leaves the other groups alone", () => {
        expect(chooseTag(["301", "102"], GROUPS, SEASON, "303", true)).toEqual(["303", "102"]);
        expect(chooseTag(["301", "102"], GROUPS, SEASON, "301", false)).toEqual(["102"]);
    });

    test("clears a group", () => {
        expect(clearTagGroup(["301", "101", "102"], GROUPS, SEASON)).toEqual(["101", "102"]);
        expect(clearTagGroup(["301", "101", "102"], GROUPS, TYPE)).toEqual(["301"]);
    });

    test("keeps only tags of the groups", () => {
        expect(chooseTag(["999", "102"], GROUPS, TYPE, "101", true)).toEqual(["101", "102"]);
    });

    test("compares selections in any order", () => {
        expect(sameTagSelection(["101", "301"], ["301", "101"])).toBe(true);
        expect(sameTagSelection([], [])).toBe(true);
        expect(sameTagSelection(["101"], ["101", "102"])).toBe(false);
        expect(sameTagSelection(["101", "101"], ["101"])).toBe(true);
    });
});

describe("what a save would change", () => {
    test("lists the tags added and removed, by name, in the mirror's order", () => {
        expect(tagChanges(["301", "102"], ["303", "101", "102"], GROUPS)).toEqual({
            added: ["Lent", "Chorus"],
            removed: ["Advent"],
        });
    });

    test("lists nothing when nothing changed, in any order", () => {
        expect(tagChanges(["102", "301"], ["301", "102"], GROUPS)).toEqual({ added: [], removed: [] });
    });

    test("leaves out ids that are no tag of the groups", () => {
        expect(tagChanges(["999"], ["998"], GROUPS)).toEqual({ added: [], removed: [] });
    });

    test("says it before Save is pressed", () => {
        expect(describeTagChanges({ added: ["Easter"], removed: ["Special"] })).toBe(
            'Save adds "Easter" and removes "Special".'
        );
        expect(describeTagChanges({ added: ["Easter", "Lent", "Chorus"], removed: [] })).toBe(
            'Save adds "Easter", "Lent" and "Chorus".'
        );
        expect(describeTagChanges({ added: [], removed: ["Hymn", "Special"] })).toBe(
            'Save removes "Hymn" and "Special".'
        );
        expect(describeTagChanges({ added: [], removed: [] })).toBe(
            "Nothing to save yet: no tag is ticked or unticked."
        );
    });
});

describe("the card's words", () => {
    test("says how many tags of a group may be chosen", () => {
        expect(tagGroupHint(TYPE)).toBe("Choose any of them.");
        expect(tagGroupHint(SEASON)).toBe("Choose one, or none.");
    });

    test("explains an empty mirror", () => {
        expect(NO_SONG_TAGS).toMatch(/tags sync has not/);
    });

    test("says what the tags are now after a save", () => {
        expect(describeTagsSave({ changed: true, tagIds: ["302", "102"], kept: [] }, GROUPS)).toBe(
            'Saved. Its tags in Planning Center are now "Easter" and "Hymn".'
        );
        expect(describeTagsSave({ changed: true, tagIds: ["101", "102", "103"], kept: [] }, GROUPS)).toBe(
            'Saved. Its tags in Planning Center are now "Chorus", "Hymn" and "Invitation".'
        );
        expect(describeTagsSave({ changed: true, tagIds: [], kept: [] }, GROUPS)).toBe(
            "Saved. The song has no tags in Planning Center now."
        );
    });

    test("says that nothing changed", () => {
        expect(describeTagsSave({ changed: false, tagIds: ["102"], kept: [] }, GROUPS)).toBe(
            "Planning Center already had these tags, so nothing was changed."
        );
    });

    test("names the tags the app did not know, which were kept", () => {
        expect(
            describeTagsSave(
                { changed: true, tagIds: ["102", "900"], kept: [{ id: "900", name: "Fast" }] },
                GROUPS
            )
        ).toBe(
            'Saved. Its tags in Planning Center are now "Hymn". It also has the tag "Fast", which the app does not know yet, so it was kept.'
        );
        expect(
            describeTagsSave(
                {
                    changed: true,
                    tagIds: ["900", "901"],
                    kept: [
                        { id: "900", name: "Fast" },
                        { id: "901", name: "Slow" },
                    ],
                },
                GROUPS
            )
        ).toBe(
            'Saved. The song has none of these tags in Planning Center now. It also has the tags "Fast" and "Slow", which the app does not know yet, so they were kept.'
        );
    });

    test("names a tag it cannot find by its id", () => {
        expect(describeTagsSave({ changed: true, tagIds: ["555"], kept: [] }, GROUPS)).toBe(
            'Saved. Its tags in Planning Center are now "555".'
        );
    });
});

describe("readTagIdsInput", () => {
    test("takes a list of texts, copied", () => {
        const input = ["101", "302"];
        const read = readTagIdsInput(input);
        expect(read).toEqual(["101", "302"]);
        read?.push("x");
        expect(input).toEqual(["101", "302"]);
        expect(readTagIdsInput([])).toEqual([]);
    });

    test("refuses anything else", () => {
        for (const value of [null, undefined, "101", 101, { 0: "101" }, [101], ["101", null], Array(501).fill("1")]) {
            expect(readTagIdsInput(value)).toBeNull();
        }
    });
});
