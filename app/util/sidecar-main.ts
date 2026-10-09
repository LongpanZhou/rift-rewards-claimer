import { parse, type LockFile } from "./LockFileParser";
import { ActionRefused, claimAllRewards, claimReward, lcuClient, loadRewards } from "./rewards";
import { classify, EXIT, findLockfile } from "./sidecar";

/**
 * Sidecar entry point. Prints JSON on stdout and nothing else. Logs and errors
 * go to stderr. Exit codes are in exitCodes.ts.
 *
 * Usage (options come before the command):
 *   lcu-sidecar [--lockfile <path>] rewards | claim-reward <grantId> | claim-all
 */

/** Runs one command. This switch is the only list of commands. */
async function run(lock: LockFile, [cmd, ...rest]: string[]): Promise<unknown> {
  const client = lcuClient(lock);
  switch (cmd) {
    case "rewards":
      return loadRewards(client);
    case "claim-reward":
      await claimReward(client, rest[0] ?? "");
      return { ok: true };
    case "claim-all":
      return claimAllRewards(client);
    default:
      throw new ActionRefused(`unknown command ${cmd}`);
  }
}

/** Reads leading `--option` flags; everything from the first other word on is positional. */
function parseArgs(argv: string[]): { lockfile?: string; positional: string[] } {
  let lockfile: string | undefined;
  let i = 0;
  while (argv[i]?.startsWith("--")) {
    if (argv[i] === "--lockfile") lockfile = argv[++i];
    i++;
  }
  return { lockfile, positional: argv.slice(i) };
}

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

async function main(): Promise<void> {
  // A failed lookup inside the connector would otherwise crash silently.
  process.on("uncaughtException", (err) => {
    const { code, message } = classify(err);
    fail(code, message);
  });

  const { lockfile, positional } = parseArgs(process.argv.slice(2));

  let lockfilePath: string;
  try {
    lockfilePath = await findLockfile(lockfile);
  } catch (err: any) {
    fail(err.code ?? EXIT.REQUEST_FAILED, err.message ?? String(err));
  }

  let lock: LockFile;
  try {
    lock = await parse(lockfilePath);
  } catch (err: any) {
    fail(EXIT.LOCKFILE_MALFORMED, err.message);
  }

  let out: unknown;
  try {
    out = await run(lock, positional);
  } catch (err) {
    const { code, message } = classify(err);
    fail(code, message);
  }

  // Wait for the write to finish before exiting, or large output is cut off.
  process.stdout.write(JSON.stringify(out), () => process.exit(EXIT.OK));
}

main();
