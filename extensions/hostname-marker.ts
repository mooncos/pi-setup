/**
 * Hostname Marker
 *
 * Puts the machine's hostname at the left edge of the footer's stats line
 * (the one showing "X.X%/YM (auto)") so pi instances running on different
 * hosts can be visually distinguished at a glance.
 *
 * Implementation: replaces the built-in footer via `ctx.ui.setFooter(...)`
 * with a reimplementation that mirrors the default layout but prefixes
 * the stats line with "<hostname> " in the theme's accent color.
 */

import os from "node:os";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

/** Format token counts: 999 / 9.9k / 99k / 9.9M / 99M */
function formatTokens(count: number): string {
        if (count < 1000) return count.toString();
        if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
        if (count < 1000000) return `${Math.round(count / 1000)}k`;
        if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
        return `${Math.round(count / 1000000)}M`;
}

/** Strip control chars & collapse whitespace for single-line status display. */
function sanitizeStatusText(text: string): string {
        return text
                .replace(/[\r\n\t]/g, " ")
                .replace(/ +/g, " ")
                .trim();
}

export default function (pi: ExtensionAPI) {
        const hostname = os.hostname();

        const install = (ctx: ExtensionContext) => {
                ctx.ui.setFooter((tui, theme, footerData) => {
                        // Re-render whenever the git branch changes so the pwd line stays fresh.
                        const unsub = footerData.onBranchChange(() => tui.requestRender());

                        return {
                                dispose: unsub,
                                invalidate() {},
                                render(width: number): string[] {
                                        // ---- Line 1: pwd (+ git branch, + session name) ----
                                        let pwd = ctx.sessionManager.getCwd();
                                        const home = process.env.HOME || process.env.USERPROFILE;
                                        if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
                                        const branch = footerData.getGitBranch();
                                        if (branch) pwd = `${pwd} (${branch})`;
                                        const sessionName = ctx.sessionManager.getSessionName();
                                        if (sessionName) pwd = `${pwd} • ${sessionName}`;
                                        const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));

                                        // ---- Line 2: <hostname> ↑↓RW $ X%/YM (auto)      model • thinking ----

                                        // Token stats accumulated across all assistant messages in the session.
                                        let totalInput = 0;
                                        let totalOutput = 0;
                                        let totalCacheRead = 0;
                                        let totalCacheWrite = 0;
                                        let totalCost = 0;
                                        for (const entry of ctx.sessionManager.getEntries()) {
                                                if (entry.type === "message" && entry.message.role === "assistant") {
                                                        const m = entry.message as AssistantMessage;
                                                        totalInput += m.usage.input;
                                                        totalOutput += m.usage.output;
                                                        totalCacheRead += m.usage.cacheRead;
                                                        totalCacheWrite += m.usage.cacheWrite;
                                                        totalCost += m.usage.cost.total;
                                                }
                                        }

                                        const contextUsage = ctx.getContextUsage();
                                        const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
                                        const contextPercentValue = contextUsage?.percent ?? 0;
                                        const contextPercent =
                                                contextUsage?.percent != null ? contextPercentValue.toFixed(1) : "?";

                                        const statsParts: string[] = [];
                                        if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
                                        if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
                                        if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
                                        if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
                                        const usingSubscription = ctx.model
                                                ? ctx.modelRegistry.isUsingOAuth(ctx.model)
                                                : false;
                                        if (totalCost || usingSubscription) {
                                                statsParts.push(
                                                        `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
                                                );
                                        }

                                        // We can't query auto-compaction state from an extension context, so we
                                        // always show "(auto)" — this matches the default pi behavior.
                                        const autoIndicator = " (auto)";
                                        const contextPercentDisplay =
                                                contextPercent === "?"
                                                        ? `?/${formatTokens(contextWindow)}${autoIndicator}`
                                                        : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
                                        let contextPercentStr: string;
                                        if (contextPercentValue > 90)
                                                contextPercentStr = theme.fg("error", contextPercentDisplay);
                                        else if (contextPercentValue > 70)
                                                contextPercentStr = theme.fg("warning", contextPercentDisplay);
                                        else contextPercentStr = contextPercentDisplay;
                                        statsParts.push(contextPercentStr);

                                        let statsLeft = statsParts.join(" ");

                                        // Right side: model id + optional thinking level, optionally prefixed
                                        // with the provider name when multiple providers are available.
                                        const modelName = ctx.model?.id || "no-model";
                                        let rightSideWithoutProvider = modelName;
                                        if (ctx.model?.reasoning) {
                                                const level = pi.getThinkingLevel();
                                                rightSideWithoutProvider =
                                                        level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
                                        }

                                        // Budget for (statsLeft + padding + rightSide) = width minus hostname prefix.
                                        const hostnamePlain = `${hostname} `;
                                        const hostnameColored = `${theme.fg("accent", hostname)} `;
                                        const hostnameWidth = visibleWidth(hostnamePlain);
                                        const budget = Math.max(0, width - hostnameWidth);

                                        let statsLeftWidth = visibleWidth(statsLeft);
                                        if (statsLeftWidth > budget) {
                                                statsLeft = truncateToWidth(statsLeft, budget, "...");
                                                statsLeftWidth = visibleWidth(statsLeft);
                                        }

                                        const minPadding = 2;
                                        let rightSide = rightSideWithoutProvider;
                                        if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
                                                rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
                                                if (statsLeftWidth + minPadding + visibleWidth(rightSide) > budget) {
                                                        rightSide = rightSideWithoutProvider;
                                                }
                                        }

                                        const rightSideWidth = visibleWidth(rightSide);
                                        const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
                                        let statsLine: string;
                                        if (totalNeeded <= budget) {
                                                const padding = " ".repeat(budget - statsLeftWidth - rightSideWidth);
                                                statsLine = statsLeft + padding + rightSide;
                                        } else {
                                                const availableForRight = budget - statsLeftWidth - minPadding;
                                                if (availableForRight > 0) {
                                                        const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
                                                        const trWidth = visibleWidth(truncatedRight);
                                                        const padding = " ".repeat(Math.max(0, budget - statsLeftWidth - trWidth));
                                                        statsLine = statsLeft + padding + truncatedRight;
                                                } else {
                                                        statsLine = statsLeft;
                                                }
                                        }

                                        // Dim stats + padding + right separately. statsLeft may contain colored
                                        // context% which embeds a reset, breaking an outer dim wrap. Keep the
                                        // hostname outside the dim wrap entirely so the accent color survives.
                                        const dimStatsLeft = theme.fg("dim", statsLeft);
                                        const dimRemainder = theme.fg("dim", statsLine.slice(statsLeft.length));
                                        const line2 = hostnameColored + dimStatsLeft + dimRemainder;

                                        const lines = [pwdLine, line2];

                                        // ---- Optional line 3: other extensions' status texts ----
                                        const extensionStatuses = footerData.getExtensionStatuses();
                                        if (extensionStatuses.size > 0) {
                                                const sorted = Array.from(extensionStatuses.entries())
                                                        .sort(([a], [b]) => a.localeCompare(b))
                                                        .map(([, text]) => sanitizeStatusText(text));
                                                lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "...")));
                                        }

                                        return lines;
                                },
                        };
                });
        };

        // Install on every session lifecycle event (startup, new, resume, fork, reload).
        pi.on("session_start", async (_event, ctx) => install(ctx));
}

