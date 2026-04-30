import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CONFIG_DIR = process.env.PI_CODING_AGENT_DIR || `${process.env.HOME}/.pi/agent`;

async function gitSync(pi: ExtensionAPI, action: "pull" | "push") {
  if (action === "pull") {
    const result = await pi.exec("git", ["pull", "--rebase", "--autostash"], { cwd: CONFIG_DIR, timeout: 15000 });
    return result.code === 0;
  } else {
    const status = await pi.exec("git", ["status", "--porcelain"], { cwd: CONFIG_DIR, timeout: 5000 });
    if (!status.stdout.trim()) return true; // nothing to push

    await pi.exec("git", ["add", "-A"], { cwd: CONFIG_DIR, timeout: 5000 });
    const date = new Date().toISOString().split("T")[0];
    await pi.exec("git", ["commit", "-m", `sync ${date}`], { cwd: CONFIG_DIR, timeout: 5000 });
    const result = await pi.exec("git", ["push"], { cwd: CONFIG_DIR, timeout: 15000 });
    return result.code === 0;
  }
}

export default function (pi: ExtensionAPI) {
  // Pull latest config on session start
  pi.on("session_start", async (_event, ctx) => {
    const ok = await gitSync(pi, "pull");
    if (!ok) {
      ctx.ui.notify("⚠️ pi-sync: failed to pull config", "warn");
    }
  });

  // Push any changes on shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    await gitSync(pi, "push");
  });

  // Manual sync command
  pi.registerCommand("sync", {
    description: "Manually sync pi config (pull + push)",
    handler: async (_args, ctx) => {
      const pulled = await gitSync(pi, "pull");
      const pushed = await gitSync(pi, "push");
      if (pulled && pushed) {
        ctx.ui.notify("✅ pi config synced!", "info");
      } else {
        ctx.ui.notify("⚠️ pi config sync had issues", "warn");
      }
    },
  });
}
