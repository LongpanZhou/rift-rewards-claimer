import { expect, test } from "bun:test";
import { ActionRefused, claimAllRewards, claimReward, loadRewards, type LcuClient } from "./rewards";

const grant = (id: string, status: string, n: number, min = n) => ({
  info: { id, status, rewardGroupId: `group-${id}`, dateCreated: `2026-01-0${n}T00:00:00Z` },
  rewardGroup: {
    localizations: { title: "Placeholder Name for Reward Group DO NOT TRANSLATE" },
    selectionStrategyConfig: { minSelectionsAllowed: min, maxSelectionsAllowed: min },
    rewards: Array.from({ length: n }, (_, k) => ({ id: `${id}-r${k}`, localizations: { title: `Item ${k}` } })),
  },
});

function client(grants: any[], failOn?: string) {
  const posts: { path: string; body: unknown }[] = [];
  const c: LcuClient = {
    get: async () => grants,
    post: async (path, body) => {
      if (failOn && path.includes(`/${failOn}/`)) throw { response: { data: { message: "boom" } } };
      posts.push({ path, body });
    },
  };
  return { c, posts };
}

test("only pending grants are listed, with placeholder titles replaced", async () => {
  const { c } = client([grant("a", "PENDING_SELECTION", 2), grant("b", "SELECTED", 1)]);
  const list = await loadRewards(c);
  expect(list.map((r) => r.grantId)).toEqual(["a"]);
  expect(list[0].title).toBe("Item 0 + Item 1");
});

test("a forced grant claims every item; choices and unknown grants are refused", async () => {
  const { c, posts } = client([grant("a", "PENDING_SELECTION", 2), grant("c", "PENDING_SELECTION", 3, 1)]);
  await expect(claimReward(c, "c")).rejects.toBeInstanceOf(ActionRefused);
  await expect(claimReward(c, "zzz")).rejects.toBeInstanceOf(ActionRefused);
  expect(posts).toHaveLength(0);
  await claimReward(c, "a");
  expect(posts).toEqual([
    {
      path: "/lol-rewards/v1/grants/a/select",
      body: { grantId: "a", rewardGroupId: "group-a", selections: ["a-r0", "a-r1"] },
    },
  ]);
});

test("claim all skips choices and keeps going after a failure", async () => {
  const P = "PENDING_SELECTION";
  const { c, posts } = client([grant("a", P, 1), grant("b", P, 3, 1), grant("c", P, 1), grant("d", P, 2)], "c");
  expect(await claimAllRewards(c)).toEqual({
    claimed: ["a", "d"],
    skipped: ["b"],
    failed: [{ grantId: "c", error: "boom" }],
  });
  expect(posts).toHaveLength(2);
});
