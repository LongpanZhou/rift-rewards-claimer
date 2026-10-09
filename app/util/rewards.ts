import axios from "axios";
import { Agent } from "https";
import type { LockFile } from "./LockFileParser";

/** Reads and claims the account's pending rewards (the client's Rewards screen). */

export interface LcuClient {
  get(path: string): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
}

export function lcuClient(lock: Pick<LockFile, "address" | "port" | "password">): LcuClient {
  const http = axios.create({
    baseURL: `https://${lock.address}:${lock.port}`,
    auth: { username: "riot", password: lock.password },
    // The client uses a self-signed certificate on 127.0.0.1 only.
    httpsAgent: lock.address === "127.0.0.1" ? new Agent({ rejectUnauthorized: false }) : undefined,
  });
  // HTTP errors keep axios's `response`; classify() in sidecar.ts reads it.
  return {
    get: (p) => http.get(p).then((r) => r.data),
    post: (p, b) => http.post(p, b).then((r) => r.data),
  };
}

/** Thrown when an action is refused before any write is sent. */
export class ActionRefused extends Error {}

const GRANTS = "/lol-rewards/v1/grants";

/** A group name the client has not localized yet; the item names say more. */
const isPlaceholder = (t?: string) => !t || /placeholder|do not translate/i.test(t);

/** Rewards granted to the account and waiting to be claimed. */
export async function loadRewards(client: LcuClient) {
  const grants: any[] = await client.get(GRANTS);
  return grants
    .filter((g) => g.info?.status === "PENDING_SELECTION")
    .map((g) => {
      const group = g.rewardGroup ?? {};
      const items = (group.rewards ?? []).map((r: any) => ({
        id: r.id as string,
        name: (r.localizations?.title || r.itemType || "Reward") as string,
        details: (r.localizations?.details ?? "") as string,
        quantity: (r.quantity ?? 1) as number,
        icon: (r.media?.iconUrl ?? "") as string,
      }));
      const title = group.localizations?.title;
      return {
        grantId: g.info.id as string,
        rewardGroupId: g.info.rewardGroupId as string,
        date: (g.info.dateCreated ?? "") as string,
        title: isPlaceholder(title) ? items.map((i: any) => i.name).join(" + ") : (title as string),
        items,
        min: group.selectionStrategyConfig?.minSelectionsAllowed ?? items.length,
        max: group.selectionStrategyConfig?.maxSelectionsAllowed ?? items.length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Claims a pending grant, like the client's own claim button. Only grants with
 * no real choice (every item must be taken) are claimed; a grant that asks the
 * player to choose is refused rather than choosing for them.
 */
type PendingReward = Awaited<ReturnType<typeof loadRewards>>[number];

/** True when every item must be taken, so claiming makes no choice. */
const isForced = (g: PendingReward) => g.min === g.items.length && g.max === g.items.length;

function select(client: LcuClient, g: PendingReward) {
  return client.post(`${GRANTS}/${g.grantId}/select`, {
    grantId: g.grantId,
    rewardGroupId: g.rewardGroupId,
    selections: g.items.map((i) => i.id),
  });
}

export async function claimReward(client: LcuClient, grantId: string) {
  const grant = (await loadRewards(client)).find((g) => g.grantId === grantId);
  if (!grant) throw new ActionRefused(`no unclaimed reward ${grantId}`);
  if (!isForced(grant)) {
    throw new ActionRefused("this reward asks you to choose; claim it in the client");
  }
  return select(client, grant);
}

/**
 * Claims every pending reward that needs no choice, one at a time, and keeps
 * going if one fails. Rewards that ask for a choice are skipped.
 */
export async function claimAllRewards(client: LcuClient) {
  const claimed: string[] = [];
  const skipped: string[] = [];
  const failed: { grantId: string; error: string }[] = [];
  for (const g of await loadRewards(client)) {
    if (!isForced(g)) {
      skipped.push(g.grantId);
      continue;
    }
    try {
      await select(client, g);
      claimed.push(g.grantId);
    } catch (err: any) {
      failed.push({ grantId: g.grantId, error: err?.response?.data?.message ?? String(err?.message ?? err) });
    }
  }
  return { claimed, skipped, failed };
}
