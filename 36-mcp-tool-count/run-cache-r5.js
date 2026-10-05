#!/usr/bin/env node
/**
 * 实验 2 补丁：r5 = direct 第二轮（不重装配置、不改任何东西）
 * 目的：把 r4 的 14,763 拆成「一次性代价」和「稳态代价」。
 *   - 若 r5 的 input 回落到几十 → r4 那 14,763 主要是一次性的，稳态成本其实很低
 *   - 若 r5 仍在万级 → 说明 direct 每轮都要重算，是真稳态成本
 * 注意：本脚本不删除 /tmp/pi-cache-session，必须接在 run-cache-test.js 之后跑。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const NODE = process.env.NODE_BIN || "node";
const PI = path.resolve(__dirname, "fresh/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const MCP_JSON = path.join(os.homedir(), ".pi/agent/mcp.json");
const OUT_DIR = path.resolve(__dirname, "results");
const SESSION_DIR = "/tmp/pi-cache-session";

if (!fs.existsSync(SESSION_DIR)) {
  console.error("❌ 没有找到既有 session，请先跑 run-cache-test.js");
  process.exit(1);
}

// 沿用 direct 配置（与 r4 完全相同），只读不写配置
console.error("当前 mcp.json:", fs.readFileSync(MCP_JSON, "utf8").replace(/\s+/g, " ").slice(0, 200));

const t0 = Date.now();
const r = spawnSync(
  NODE,
  [
    PI,
    "--model", "ollama/qwen3.8:27b-mlx",
    "--thinking", "off",
    "--session-dir", SESSION_DIR,
    "--mode", "json",
    "--continue",
    "-p", "Reply with the single word: FIFTH",
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 }
);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
fs.writeFileSync(path.join(OUT_DIR, "cache-r5-direct.jsonl"), r.stdout || "");

let usage = null;
for (const l of (r.stdout || "").trim().split("\n").filter(Boolean)) {
  try {
    const o = JSON.parse(l);
    if (o.type === "message_end" && o.message && o.message.role === "assistant" && o.message.usage) {
      usage = o.message.usage;
    }
  } catch {}
}

const out = {
  label: "r5-direct-2nd",
  note: "direct 的第二轮，配置与 r4 完全相同",
  elapsed: Number(elapsed),
  usage,
  promptTokens: usage ? usage.input + usage.cacheRead : null,
};
console.log(JSON.stringify(out, null, 2));

// 同时把完整序列（含 r5）重新落一份 summary
const summaryPath = path.join(OUT_DIR, "cache-summary.json");
if (fs.existsSync(summaryPath)) {
  const prev = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  prev.push({
    label: "r5-direct",
    prompt: "Reply with the single word: FIFTH",
    elapsed: Number(elapsed),
    usage,
  });
  fs.writeFileSync(summaryPath, JSON.stringify(prev, null, 2));
  console.error("\n已把 r5 追加进 cache-summary.json");
}
