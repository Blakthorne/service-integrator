import { describe, expect, test } from "vitest";
import type { PlanItem } from "../domain";
import {
    joinItemsToSongs,
    toPlan,
    toPlanItem,
    toServiceType,
    toSong,
} from "./mappers";
import type { PcoSongResource } from "./resources";
import {
    itemResource,
    planResource,
    serviceTypeResource,
    songResource,
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

describe("joinItemsToSongs", () => {
    const grace = songResource("77", { title: "Amazing Grace" });
    const holy = songResource("88", { title: "Holy, Holy, Holy" });

    test("joins a song item to the included song with the same title", () => {
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

    test("the first included song with the item's title wins", () => {
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

    test("QUIRK (pinned): a renamed song item gets no song, even though its songId names one (flips when songs are joined by PCO ID)", () => {
        const renamed = planItem({ title: "Amazing Grace (Acoustic)", songId: "77" });
        expect(joinItemsToSongs([renamed], [grace])[0].song).toBeNull();
    });

    test("does not modify the items passed in", () => {
        const item = planItem({ title: "Amazing Grace" });
        const snapshot = JSON.stringify(item);
        joinItemsToSongs([item], [grace]);
        expect(JSON.stringify(item)).toBe(snapshot);
    });
});
