import { describe, expect, test } from "vitest";
import type { PlanItem } from "../domain";
import {
    itemNotesByItem,
    joinItemsToSongs,
    toItemNote,
    toItemNoteCategory,
    toPcoLibrarySong,
    toPlan,
    toPlanItem,
    toPcoTag,
    toPcoTagGroups,
    toServiceType,
    toSong,
} from "./mappers";
import type { PcoItemNoteResource, PcoSongResource } from "./resources";
import {
    itemNoteCategoryResource,
    itemNoteResource,
    itemResource,
    noteLinks,
    planResource,
    serviceTypeResource,
    songResource,
    tagGroupResource,
    tagResource,
} from "./testing";

function planItem(overrides: Partial<PlanItem>): PlanItem {
    return {
        ...toPlanItem(itemResource("1")),
        songId: null,
        ...overrides,
    };
}

describe("toServiceType", () => {
    test("maps the attributes the app uses", () => {
        expect(toServiceType(serviceTypeResource())).toStrictEqual({
            id: "1405391",
            name: "Sunday Morning",
            frequency: "Weekly",
            sequence: 1,
            archived: false,
        });
    });

    test("is archived when archived_at is set", () => {
        const resource = serviceTypeResource({
            archived_at: "2024-05-01T00:00:00Z",
        });
        expect(toServiceType(resource).archived).toBe(true);
    });
});

describe("toPlan", () => {
    test("maps the attributes, taking the web URL from planning_center_url", () => {
        expect(toPlan(planResource(), "1405391")).toStrictEqual({
            id: "81234567",
            serviceTypeId: "1405391",
            title: "Communion Sunday",
            dates: "October 4, 2026",
            shortDates: "Oct 4",
            sortDate: "2026-10-04T08:00:00Z",
            itemsCount: 17,
            planningCenterUrl:
                "https://services.planningcenteronline.com/plans/81234567",
            createdAt: "2026-09-01T12:00:00Z",
            updatedAt: "2026-10-02T15:00:00Z",
        });
    });

    test("keeps a null title", () => {
        expect(toPlan(planResource({}, { title: null }), "1").title).toBeNull();
    });

    test("takes serviceTypeId from the plan's relationship when PCO sends one", () => {
        const resource = planResource({
            relationships: {
                service_type: { data: { type: "ServiceType", id: "1486055" } },
            },
        });
        expect(toPlan(resource, "1405391").serviceTypeId).toBe("1486055");
    });

    test("falls back to the requested service type without a relationship", () => {
        expect(toPlan(planResource(), "1405391").serviceTypeId).toBe("1405391");
        const unlinked = planResource({
            relationships: { service_type: { data: null } },
        });
        expect(toPlan(unlinked, "1405391").serviceTypeId).toBe("1405391");
    });
});

describe("toPlanItem", () => {
    test("maps the attributes and the song relationship", () => {
        const resource = itemResource(
            "900",
            { description: "Hymn of response", sequence: 4 },
            { song: { data: { type: "Song", id: "77" } } }
        );
        expect(toPlanItem(resource)).toStrictEqual({
            id: "900",
            title: "Amazing Grace",
            itemType: "song",
            sequence: 4,
            servicePosition: "during",
            keyName: "G",
            length: 240,
            description: "Hymn of response",
            createdAt: "2026-09-01T12:00:00Z",
            updatedAt: "2026-09-02T12:00:00Z",
            songId: "77",
        });
    });

    test("songId is null when the song relationship is null", () => {
        const resource = itemResource("1", {}, { song: { data: null } });
        expect(toPlanItem(resource).songId).toBeNull();
    });

    test("songId is null when the song relationship is missing", () => {
        expect(toPlanItem(itemResource("1", {}, {})).songId).toBeNull();
        expect(toPlanItem(itemResource("1")).songId).toBeNull();
    });

    test("keeps null attributes as null", () => {
        const item = toPlanItem(
            itemResource("1", { key_name: null, description: null })
        );
        expect(item.keyName).toBeNull();
        expect(item.description).toBeNull();
    });
});

describe("toSong", () => {
    test("maps the attributes the app uses", () => {
        expect(toSong(songResource("77"))).toStrictEqual({
            id: "77",
            title: "Amazing Grace",
            author: "John Newton",
            admin: "Admin Co",
            ccliNumber: 22025,
            copyright: "Public Domain",
            notes: "Verse 3 optional",
            themes: "Grace",
        });
    });

    test("keeps nulls as null and empty strings as empty strings", () => {
        const song = toSong(
            songResource("77", {
                author: null,
                admin: null,
                ccli_number: null,
                copyright: "",
                notes: null,
                themes: "",
            })
        );
        expect(song).toMatchObject({
            author: null,
            admin: null,
            ccliNumber: null,
            copyright: "",
            notes: null,
            themes: "",
        });
    });

    test("turns attributes missing from the JSON into null", () => {
        const resource = songResource("77");
        const attributes: Partial<PcoSongResource["attributes"]> = {
            ...resource.attributes,
        };
        delete attributes.author;
        delete attributes.copyright;
        const song = toSong({
            ...resource,
            attributes: attributes as PcoSongResource["attributes"],
        });
        expect(song.author).toBeNull();
        expect(song.copyright).toBeNull();
    });
});

describe("toPcoLibrarySong", () => {
    test("maps every field the mirror keeps", () => {
        expect(toPcoLibrarySong(songResource("77"))).toStrictEqual({
            id: "77",
            title: "Amazing Grace",
            author: "John Newton",
            copyright: "Public Domain",
            ccliNumber: 22025,
            admin: "Admin Co",
            themes: "Grace",
            hidden: false,
            lastScheduledAt: "2026-09-27T08:00:00Z",
            createdAt: "2019-01-01T00:00:00Z",
            updatedAt: "2026-09-27T08:00:00Z",
        });
        expect(toPcoLibrarySong(songResource("78", { hidden: true })).hidden).toBe(true);
    });

    test("keeps nulls as null and empty strings as empty strings", () => {
        expect(
            toPcoLibrarySong(
                songResource("77", {
                    author: null,
                    copyright: "",
                    ccli_number: null,
                    admin: null,
                    themes: "",
                    last_scheduled_at: null,
                })
            )
        ).toMatchObject({
            author: null,
            copyright: "",
            ccliNumber: null,
            admin: null,
            themes: "",
            lastScheduledAt: null,
        });
    });

    test("turns attributes missing from the JSON into null, a title into an empty one", () => {
        const resource = songResource("77");
        const attributes: Partial<PcoSongResource["attributes"]> = {
            ...resource.attributes,
        };
        for (const name of [
            "title",
            "author",
            "copyright",
            "ccli_number",
            "admin",
            "themes",
            "hidden",
            "last_scheduled_at",
            "created_at",
            "updated_at",
        ] as const) {
            delete attributes[name];
        }
        expect(
            toPcoLibrarySong({
                ...resource,
                attributes: attributes as PcoSongResource["attributes"],
            })
        ).toStrictEqual({
            id: "77",
            title: "",
            author: null,
            copyright: null,
            ccliNumber: null,
            admin: null,
            themes: null,
            hidden: false,
            lastScheduledAt: null,
            createdAt: null,
            updatedAt: null,
        });
    });

    test.each<[string, unknown, number | null]>([
        ["a whole number", 22025, 22025],
        ["digits sent as text", " 22025 ", 22025],
        ["a fraction", 22025.5, null],
        ["words", "CCLI 22025", null],
        ["an empty string", "", null],
        ["a number too large to be exact", 2 ** 60, null],
    ])("keeps a CCLI number that is %s only if it is a whole number", (_case, value, expected) => {
        const song = toPcoLibrarySong(
            songResource("77", { ccli_number: value as number | null })
        );
        expect(song.ccliNumber).toBe(expected);
    });
});

describe("joinItemsToSongs", () => {
    const grace = songResource("77", { title: "Amazing Grace" });
    const holy = songResource("88", { title: "Holy, Holy, Holy" });

    test("joins a song item to the included song it links to", () => {
        const item = planItem({ id: "1", title: "Amazing Grace", songId: "77" });
        const [joined] = joinItemsToSongs([item], [grace, holy]);
        expect(joined).toStrictEqual({ ...item, song: toSong(grace) });
    });

    test("keeps the items' order and every item, matched or not", () => {
        const items = [
            planItem({ id: "3", title: "Holy, Holy, Holy", sequence: 3 }),
            planItem({ id: "1", title: "Welcome", itemType: "header", sequence: 1 }),
            planItem({ id: "2", title: "Unknown Song", sequence: 2 }),
        ];
        const joined = joinItemsToSongs(items, [grace, holy]);
        expect(joined.map((item) => [item.id, item.song?.id ?? null])).toEqual([
            ["3", "88"],
            ["1", null],
            ["2", null],
        ]);
    });

    test("non-song items never get a song, even with a matching title", () => {
        const header = planItem({ title: "Amazing Grace", itemType: "header" });
        expect(joinItemsToSongs([header], [grace])[0].song).toBeNull();
    });

    test("title matching is exact: case and surrounding spaces matter", () => {
        const items = ["amazing grace", " Amazing Grace", "Amazing Grace."].map(
            (title, i) => planItem({ id: String(i), title })
        );
        for (const joined of joinItemsToSongs(items, [grace])) {
            expect(joined.song).toBeNull();
        }
    });

    test("without a songId, the first included song with the item's title wins", () => {
        const twin = songResource("99", { title: "Amazing Grace", author: "Twin" });
        const item = planItem({ title: "Amazing Grace" });
        expect(joinItemsToSongs([item], [grace, twin])[0].song?.id).toBe("77");
    });

    test("ignores included resources that are not songs", () => {
        const arrangement = {
            type: "Arrangement",
            id: "77",
            attributes: { title: "Amazing Grace" },
        };
        const item = planItem({ title: "Amazing Grace", songId: "77" });
        expect(joinItemsToSongs([item], [arrangement])[0].song).toBeNull();
    });

    test("a renamed song item is joined to its song by songId", () => {
        const renamed = planItem({ title: "Amazing Grace (Acoustic)", songId: "77" });
        expect(joinItemsToSongs([renamed], [grace])[0].song).toStrictEqual(
            toSong(grace)
        );
    });

    test("songId wins over a song whose title matches the item", () => {
        // Titled like song 77, but PCO links it to song 88.
        const item = planItem({ title: "Amazing Grace", songId: "88" });
        expect(joinItemsToSongs([item], [grace, holy])[0].song?.id).toBe("88");
    });

    test("without a songId, the exact title is still used", () => {
        const item = planItem({ title: "Holy, Holy, Holy", songId: null });
        expect(joinItemsToSongs([item], [grace, holy])[0].song?.id).toBe("88");
    });

    test("a songId whose song was not included falls back to the exact title", () => {
        const item = planItem({ title: "Amazing Grace", songId: "404" });
        expect(joinItemsToSongs([item], [grace])[0].song?.id).toBe("77");
    });

    test("a non-song item gets no song, even with a songId", () => {
        const header = planItem({ title: "Offertory", itemType: "header", songId: "77" });
        expect(joinItemsToSongs([header], [grace])[0].song).toBeNull();
    });

    test("does not modify the items passed in", () => {
        const item = planItem({ title: "Amazing Grace" });
        const snapshot = JSON.stringify(item);
        joinItemsToSongs([item], [grace]);
        expect(JSON.stringify(item)).toBe(snapshot);
    });
});

describe("toItemNote", () => {
    test("maps the note, taking its category's id from the relationship", () => {
        expect(
            toItemNote(itemNoteResource("9001", { category_name: "Hymnal", content: "R-396 / G-317" }, "501"))
        ).toStrictEqual({
            id: "9001",
            categoryId: "501",
            categoryName: "Hymnal",
            content: "R-396 / G-317",
        });
    });

    test("a note without a category relationship has a null category id", () => {
        expect(toItemNote(itemNoteResource("9001", {}, null)).categoryId).toBeNull();
        const resource: PcoItemNoteResource = {
            ...itemNoteResource("9002"),
            relationships: { item_note_category: { data: null } },
        };
        expect(toItemNote(resource).categoryId).toBeNull();
    });

    test("a null or missing category name or content becomes empty", () => {
        expect(toItemNote(itemNoteResource("9001", { category_name: null, content: null }))).toMatchObject({
            categoryName: "",
            content: "",
        });
        const resource = itemNoteResource("9002");
        const attributes: Partial<PcoItemNoteResource["attributes"]> = { ...resource.attributes };
        delete attributes.content;
        delete attributes.category_name;
        expect(
            toItemNote({ ...resource, attributes: attributes as PcoItemNoteResource["attributes"] })
        ).toMatchObject({ categoryName: "", content: "" });
    });

    test("keeps the content exactly as Planning Center has it", () => {
        expect(toItemNote(itemNoteResource("9001", { content: "  R-12\nG-34 " })).content).toBe("  R-12\nG-34 ");
    });
});

describe("toItemNoteCategory", () => {
    test("maps the id and name", () => {
        expect(toItemNoteCategory(itemNoteCategoryResource("501", { name: "Band" }))).toStrictEqual({
            id: "501",
            name: "Band",
        });
    });
});

describe("itemNotesByItem", () => {
    const hymnal = itemNoteResource("9001", { content: "R-396" });
    const vocals = itemNoteResource("9002", { category_name: "Vocals", content: "Solo" }, "502");

    test("gives each item the notes its relationship names, in that order", () => {
        const notes = itemNotesByItem(
            [itemResource("1", {}, noteLinks("9002", "9001")), itemResource("2", {}, noteLinks())],
            [hymnal, vocals]
        );
        expect([...notes.entries()]).toEqual([
            ["1", [toItemNote(vocals), toItemNote(hymnal)]],
            ["2", []],
        ]);
    });

    test("an item with no item_notes relationship has no notes", () => {
        expect(itemNotesByItem([itemResource("1")], [hymnal]).get("1")).toEqual([]);
    });

    test("leaves out a note that was not included, and one no item names", () => {
        const notes = itemNotesByItem([itemResource("1", {}, noteLinks("9001", "404"))], [hymnal, vocals]);
        expect(notes.get("1")).toEqual([toItemNote(hymnal)]);
    });

    test("ignores included resources that are not item notes", () => {
        const song = { ...songResource("9001"), type: "Song" as const };
        expect(itemNotesByItem([itemResource("1", {}, noteLinks("9001"))], [song]).get("1")).toEqual([]);
    });
});

describe("toPcoTag", () => {
    test("maps the id and name, in the group given", () => {
        expect(toPcoTag(tagResource("71", { name: "Hymn" }), "7")).toStrictEqual({
            id: "71",
            groupId: "7",
            name: "Hymn",
        });
    });
});

describe("toPcoTagGroups", () => {
    test("gives each group the included tags its relationship names, by name", () => {
        const groups = toPcoTagGroups(
            [tagGroupResource("7", { name: "Type" }, ["72", "71", "73"])],
            [
                tagResource("71", { name: "hymn" }),
                tagResource("72", { name: "Chorus" }),
                tagResource("73", { name: "Special" }),
                serviceTypeResource(),
            ]
        );
        expect(groups).toStrictEqual([
            {
                id: "7",
                name: "Type",
                tagsFor: "song",
                allowMultiple: true,
                tags: [
                    { id: "72", groupId: "7", name: "Chorus" },
                    { id: "71", groupId: "7", name: "hymn" },
                    { id: "73", groupId: "7", name: "Special" },
                ],
            },
        ]);
    });

    test("also takes a tag whose own relationship names the group, each once", () => {
        const [group] = toPcoTagGroups(
            [tagGroupResource("7", {}, ["71"])],
            [tagResource("71", { name: "Hymn" }, "7"), tagResource("72", { name: "Chorus" }, "7")]
        );
        expect(group.tags.map(({ id }) => id)).toEqual(["72", "71"]);
    });

    test("leaves out a tag that was not included, and one no group claims", () => {
        const [group] = toPcoTagGroups(
            [tagGroupResource("7", {}, ["71", "99"])],
            [tagResource("71"), tagResource("72", {}, "8"), tagResource("73")]
        );
        expect(group.tags.map(({ id }) => id)).toEqual(["71"]);
    });

    test("keeps the groups' order; one with no tags relationship has none", () => {
        const bare = { ...tagGroupResource("9", { name: "Bare" }), relationships: undefined };
        expect(
            toPcoTagGroups([tagGroupResource("8", { name: "Z" }), bare], []).map(({ id, tags }) => [id, tags])
        ).toEqual([
            ["8", []],
            ["9", []],
        ]);
    });

    test("only allow_multiple_selections: false stops several tags being chosen", () => {
        const allowed = (value: boolean | null | undefined) =>
            toPcoTagGroups([tagGroupResource("7", { allow_multiple_selections: value })], [])[0].allowMultiple;
        expect(allowed(false)).toBe(false);
        expect(allowed(true)).toBe(true);
        expect(allowed(null)).toBe(true);
        expect(allowed(undefined)).toBe(true);
    });

    test("ties between names go by id", () => {
        const [group] = toPcoTagGroups(
            [tagGroupResource("7", {}, ["72", "71"])],
            [tagResource("72", { name: "Hymn" }), tagResource("71", { name: "HYMN" })]
        );
        expect(group.tags.map(({ id }) => id)).toEqual(["71", "72"]);
    });
});
