import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_DIR =
  process.env.PI_CODING_AGENT_DIR || `${process.env.HOME}/.pi/agent`;

// Mutex to prevent concurrent git operations
let syncLock = false;

async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (syncLock) return null;
  syncLock = true;
  try {
    return await fn();
  } finally {
    syncLock = false;
  }
}

async function isGitRepo(pi: ExtensionAPI): Promise<boolean> {
  const result = await pi.exec("git", ["rev-parse", "--git-dir"], {
    cwd: CONFIG_DIR,
    timeout: 5000,
  });
  return result.code === 0;
}

async function execGit(
  pi: ExtensionAPI,
  args: string[],
  timeout = 30000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await pi.exec("git", args, { cwd: CONFIG_DIR, timeout });
    return {
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err: any) {
    return { ok: false, stdout: "", stderr: err?.message ?? String(err) };
  }
}

async function retry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delay = 2000 }: { attempts?: number; delay?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delay * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Detect and recover from broken git states (stuck rebases, merges, etc.)
 * Returns true if recovery was needed and performed.
 */
async function recoverBrokenState(
  pi: ExtensionAPI
): Promise<{ recovered: boolean; msg: string }> {
  // Check for in-progress rebase
  const rebaseDir = await execGit(pi, [
    "rev-parse",
    "--git-path",
    "rebase-merge",
  ]);
  if (rebaseDir.ok) {
    const checkDir = await pi.exec(
      "test",
      ["-d", rebaseDir.stdout.trim()],
      { cwd: CONFIG_DIR, timeout: 3000 }
    );
    if (checkDir.code === 0) {
      await execGit(pi, ["rebase", "--abort"], 10000);
      return { recovered: true, msg: "aborted stuck rebase" };
    }
  }

  // Check for in-progress merge
  const mergeHead = await execGit(pi, [
    "rev-parse",
    "--git-path",
    "MERGE_HEAD",
  ]);
  if (mergeHead.ok) {
    const checkFile = await pi.exec(
      "test",
      ["-f", mergeHead.stdout.trim()],
      { cwd: CONFIG_DIR, timeout: 3000 }
    );
    if (checkFile.code === 0) {
      await execGit(pi, ["merge", "--abort"], 10000);
      return { recovered: true, msg: "aborted stuck merge" };
    }
  }

  // Check for in-progress cherry-pick
  const cherryPick = await execGit(pi, [
    "rev-parse",
    "--git-path",
    "CHERRY_PICK_HEAD",
  ]);
  if (cherryPick.ok) {
    const checkFile = await pi.exec(
      "test",
      ["-f", cherryPick.stdout.trim()],
      { cwd: CONFIG_DIR, timeout: 3000 }
    );
    if (checkFile.code === 0) {
      await execGit(pi, ["cherry-pick", "--abort"], 10000);
      return { recovered: true, msg: "aborted stuck cherry-pick" };
    }
  }

  return { recovered: false, msg: "" };
}

async function gitPull(
  pi: ExtensionAPI
): Promise<{ ok: boolean; msg: string }> {
  // Check for remote before pulling
  const remote = await execGit(pi, ["remote"]);
  if (!remote.ok || !remote.stdout.trim()) {
    return { ok: true, msg: "no remote configured, skipping pull" };
  }

  // Recover from any stuck state before pulling
  const recovery = await recoverBrokenState(pi);
  if (recovery.recovered) {
    // After recovery, still try to pull
  }

  // Use fetch + rebase separately for better error handling
  const fetch = await execGit(pi, ["fetch", "--prune"], 30000);
  if (!fetch.ok) {
    return { ok: false, msg: `fetch failed: ${fetch.stderr.slice(0, 200)}` };
  }

  // Check if we're behind
  const behind = await execGit(pi, [
    "rev-list",
    "--count",
    "HEAD..@{upstream}",
  ]);
  if (!behind.ok || behind.stdout.trim() === "0") {
    const prefix = recovery.recovered ? `(${recovery.msg}) ` : "";
    return { ok: true, msg: `${prefix}already up to date` };
  }

  // Rebase onto upstream
  const result = await execGit(
    pi,
    ["rebase", "--autostash", "@{upstream}"],
    30000
  );
  if (result.ok) {
    const prefix = recovery.recovered ? `(${recovery.msg}) ` : "";
    return { ok: true, msg: `${prefix}rebased` };
  }

  // Rebase conflict — abort to restore clean state
  if (
    result.stderr.includes("CONFLICT") ||
    result.stderr.includes("rebase in progress") ||
    result.stderr.includes("could not apply")
  ) {
    await execGit(pi, ["rebase", "--abort"], 10000);

    // Fall back to merge strategy which handles divergence better
    const merge = await execGit(
      pi,
      ["pull", "--no-rebase", "--autostash"],
      30000
    );
    if (merge.ok) {
      return { ok: true, msg: "rebase failed, merged instead" };
    }

    // If merge also fails, abort it and give up
    await execGit(pi, ["merge", "--abort"], 10000);
    return {
      ok: false,
      msg: `rebase and merge both failed: ${result.stderr.slice(0, 200)}`,
    };
  }

  return { ok: false, msg: result.stderr.slice(0, 200) };
}

async function gitPush(
  pi: ExtensionAPI
): Promise<{ ok: boolean; msg: string }> {
  // Check for remote
  const remote = await execGit(pi, ["remote"]);
  if (!remote.ok || !remote.stdout.trim()) {
    return { ok: true, msg: "no remote configured, skipping push" };
  }

  // Recover from any stuck state before pushing
  await recoverBrokenState(pi);

  // Check if there are changes to commit
  const status = await execGit(pi, ["status", "--porcelain"]);
  if (!status.ok) {
    return {
      ok: false,
      msg: `status check failed: ${status.stderr.slice(0, 200)}`,
    };
  }
  if (!status.stdout.trim()) {
    // Nothing to commit — but still check if we need to push existing commits
    const ahead = await execGit(pi, [
      "rev-list",
      "--count",
      "@{upstream}..HEAD",
    ]);
    if (!ahead.ok || ahead.stdout.trim() === "0") {
      return { ok: true, msg: "nothing to push" };
    }
    // Fall through to push
  } else {
    // Stage and commit
    const add = await execGit(pi, ["add", "-A"]);
    if (!add.ok) {
      return { ok: false, msg: `git add failed: ${add.stderr.slice(0, 200)}` };
    }

    const date = new Date().toISOString().replace("T", " ").slice(0, 19);
    const hostname = process.env.HOSTNAME || "unknown";
    const commit = await execGit(pi, [
      "commit",
      "-m",
      `sync ${date} [${hostname}]`,
    ]);
    if (!commit.ok) {
      if (commit.stdout.includes("nothing to commit")) {
        return { ok: true, msg: "nothing to commit" };
      }
      return {
        ok: false,
        msg: `commit failed: ${commit.stderr.slice(0, 200)}`,
      };
    }
  }

  // Push with retry for transient network failures
  try {
    await retry(
      async () => {
        const r = await execGit(pi, ["push"], 30000);
        if (!r.ok) throw new Error(r.stderr);
        return r;
      },
      { attempts: 3, delay: 2000 }
    );
    return { ok: true, msg: "pushed" };
  } catch (err: any) {
    return {
      ok: false,
      msg: `push failed after retries: ${err?.message?.slice(0, 200)}`,
    };
  }
}

export default function (pi: ExtensionAPI) {
  // Pull latest config on session start
  pi.on("session_start", async (_event, ctx) => {
    if (_event.reason !== "startup") return;

    const locked = await withLock(async () => {
      if (!(await isGitRepo(pi))) return;

      const result = await gitPull(pi);
      if (!result.ok) {
        ctx.ui.notify(`⚠️ pi-sync pull: ${result.msg}`, "warn");
      }
    });
    // If locked === null, another sync was running — skip silently
  });

  // Push any changes on shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    await withLock(async () => {
      if (!(await isGitRepo(pi))) return;
      await gitPush(pi);
    });
  });

  // Manual sync command
  pi.registerCommand("sync", {
    description: "Manually sync pi config (pull then push)",
    handler: async (_args, ctx) => {
      const result = await withLock(async () => {
        if (!(await isGitRepo(pi))) {
          ctx.ui.notify("⚠️ pi-sync: config dir is not a git repo", "warn");
          return false;
        }

        const pull = await gitPull(pi);
        if (!pull.ok) {
          ctx.ui.notify(`⚠️ pull: ${pull.msg}`, "warn");
        } else if (pull.msg !== "nothing to push") {
          ctx.ui.notify(`pull: ${pull.msg}`, "info");
        }

        const push = await gitPush(pi);
        if (!push.ok) {
          ctx.ui.notify(`⚠️ push: ${push.msg}`, "warn");
        } else if (push.msg !== "nothing to push") {
          ctx.ui.notify(`push: ${push.msg}`, "info");
        }

        return pull.ok && push.ok;
      });

      if (result === null) {
        ctx.ui.notify("⚠️ pi-sync: another sync is already running", "warn");
      } else if (result) {
        ctx.ui.notify("✅ pi config synced", "info");
      } else {
        ctx.ui.notify("⚠️ pi config sync had issues (see above)", "warn");
      }
    },
  });
}
