import { useEffect, useState } from "react";
import "./App.css";
import { invokeJson, messageFor, type SidecarError } from "./errors";

interface Reward {
  grantId: string;
  date: string;
  title: string;
  items: { id: string; name: string; details: string; quantity: number; icon: string }[];
}

interface ClaimAllResult {
  claimed: string[];
  skipped: string[];
  failed: { grantId: string; error: string }[];
}

const run = <T,>(args: string[]) => invokeJson<T>("rewards", { args });

// Reward art comes from CommunityDragon, a public mirror of the client's files;
// the client's own asset routes need the lockfile password.
const clientAsset = (path: string) =>
  path.toLowerCase().startsWith("/lol-game-data/assets/")
    ? "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/" +
      path.toLowerCase().slice("/lol-game-data/assets/".length)
    : "";

export default function App() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [error, setError] = useState<SidecarError | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // A claim cannot be undone, so the first click only arms the button.
  const [armed, setArmed] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setRewards(null);
    run<Reward[]>(["rewards"]).then(setRewards).catch(setError);
  };
  useEffect(load, []);

  const confirm = (key: string, go: () => void) => {
    if (armed === key) {
      setArmed(null);
      go();
    } else setArmed(key);
  };
  const remove = (ids: string[]) => setRewards((cur) => cur && cur.filter((r) => !ids.includes(r.grantId)));

  const claim = (r: Reward) => {
    setBusy(true);
    setNotice("");
    run(["claim-reward", r.grantId])
      .then(() => {
        setNotice(`Claimed: ${r.title}.`);
        remove([r.grantId]);
      })
      .catch((e: SidecarError) => setNotice(messageFor(e)))
      .finally(() => setBusy(false));
  };

  const claimAll = () => {
    setBusy(true);
    setNotice("");
    run<ClaimAllResult>(["claim-all"])
      .then((res) => {
        remove(res.claimed);
        const parts = [`Claimed ${res.claimed.length}`];
        if (res.skipped.length) parts.push(`${res.skipped.length} need a choice in the client`);
        if (res.failed.length) parts.push(`${res.failed.length} failed: ${res.failed[0].error}`);
        setNotice(parts.join("; ") + ".");
      })
      .catch((e: SidecarError) => setNotice(messageFor(e)))
      .finally(() => setBusy(false));
  };

  return (
    <main className="app">
      <header className="head">
        <h1>Rift Rewards Claimer</h1>
        <button onClick={load} disabled={busy}>
          Refresh
        </button>
      </header>

      {notice && <p className="notice">{notice}</p>}

      {error ? (
        <div className="status">
          <p>{messageFor(error)}</p>
          <button onClick={load}>Retry</button>
        </div>
      ) : !rewards ? (
        <p className="status">Loading your rewards...</p>
      ) : !rewards.length ? (
        <p className="status">No unclaimed rewards.</p>
      ) : (
        <>
          <div className="summary">
            <p className="muted">
              {rewards.length} rewards waiting. Claiming adds them to your inventory, like the claim button in the
              client.
            </p>
            <button className="primary" disabled={busy} onClick={() => confirm("all", claimAll)}>
              {armed === "all" ? `Click again to claim all ${rewards.length}` : "Claim all"}
            </button>
          </div>
          <div className="rewards">
            {rewards.map((r) => (
              <div className="card" key={r.grantId}>
                <div className="items">
                  {r.items.map((i) => (
                    <div className="item" key={i.id} title={i.details}>
                      {clientAsset(i.icon) && <img src={clientAsset(i.icon)} alt="" loading="lazy" />}
                      <span>
                        {i.name}
                        {i.quantity > 1 && ` x${i.quantity}`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="fine">Granted {r.date ? new Date(r.date).toLocaleDateString() : "unknown date"}</p>
                <button disabled={busy} onClick={() => confirm(r.grantId, () => claim(r))}>
                  {armed === r.grantId ? "Click again to claim" : "Claim"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
