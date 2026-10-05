#!/usr/bin/env node
/**
 * v3：补 P0 缺口 + 测多 server 场景
 * 1) 低 n 区 codemode（n=5 / n=10）—— 之前只测了 20/60，临界点判断缺支撑
 * 2) 多 server 场景：60 工具装在 1 个 server vs 拆成 3 个 server × 20 工具
 *    → 验证 codemode 的平线在「server 数增长」时是否还成立
 *    （此前实验只变了单 server 内的工具数，没覆盖 server 数这个维度）
 * 沿用 v2 的 nonce 机制：每组 --append-system-prompt 不同，强制冷启动。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const NODE = process.env.NODE_BIN || "node";
const PI = path.resolve(__dirname, "fresh/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const MCP_JSON = path.join(os.homedir(), ".pi/agent/mcp.json");
const SERVER = path.resolve(__dirname, "mcp-mock/server.js");
const OUT_DIR = path.resolve(__dirname, "results");
const PROMPT = "Reply with the single word: OK";

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function makeServer(toolCount, exposure) {
  const s = {
    command: NODE,
    args: [SERVER],
    env: { TOOL_COUNT: String(toolCount), DESC_LEN: "900" },
  };
  if (exposure === "direct") s.exposure = "direct";
  return s;
}

function writeConfig(spec) {
  // spec: { servers: [{name, toolCount}], exposure }
  const cfg = { mcpServers: {} };
  for (const s of spec.servers) {
    cfg.mcpServers[s.name] = makeServer(s.toolCount, spec.exposure);
  }
  fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2) + "\n");
}

function nonce() {
  return Math.random().toString(36).slice(2, 10);
}

function run(label, spec) {
  writeConfig(spec);
  const n = nonce();
  const out = path.join(OUT_DIR, `${label}.jsonl`);
  const t0 = Date.now();
  const r = spawnSync(
    NODE,
    [
      PI,
      "--model", "ollama/qwen3.8:27b-mlx",
      "--thinking", "off",
      "--no-session",
      "--mode", "json",
      "--append-system-prompt", `bench-nonce-${n}`,
      "-p", PROMPT,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 420000 }
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(out, r.stdout || "");

  let usage = null;
  const text = r.stdout || "";
  for (const l of text.trim().split("\n").filter(Boolean)) {
    try {
      const o = JSON.parse(l);
      if (o.type === "message_end" && o.message && o.message.role === "assistant" && o.message.usage) {
        usage = o.message.usage;
      }
    } catch {}
  }
  const toolNameHits = (text.match(/list_documents/g) || []).length;

  return {
    label,
    servers: spec.servers.length,
    toolsPerServer: spec.servers[0].toolCount,
    totalTools: spec.servers.reduce((a, s) => a + s.toolCount, 0),
    exposure: spec.exposure,
    nonce: n,
    elapsed: Number(elapsed),
    usage,
    promptTokens: usage ? usage.input + usage.cacheRead : null,
    toolNameHits,
  };
}

const plan = [
  // 1) 低 n 区 codemode（P0 缺口）
  { label: "5-codemode",  spec: { servers: [{ name: "bench", toolCount: 5 }],  exposure: "codemode" } },
  { label: "10-codemode", spec: { servers: [{ name: "bench", toolCount: 10 }], exposure: "codemode" } },
  // 2) 多 server：60 工具拆 3 × 20
  { label: "3x20-codemode", spec: { servers: [
      { name: "benchA", toolCount: 20 },
      { name: "benchB", toolCount: 20 },
      { name: "benchC", toolCount: 20 },
    ], exposure: "codemode" } },
  { label: "3x20-direct", spec: { servers: [
      { name: "benchA", toolCount: 20 },
      { name: "benchB", toolCount: 20 },
      { name: "benchC", toolCount: 20 },
    ], exposure: "direct" } },
  // 3) 单 server 60（对照，v2 已有，重跑保证同批次）
  { label: "1x60-codemode", spec: { servers: [{ name: "bench", toolCount: 60 }], exposure: "codemode" } },
];

const results = [];
for (const p of plan) {
  process.stderr.write(`running ${p.label} ...\n`);
  const res = run(p.label, p.spec);
  results.push(res);
  process.stderr.write(
    `  → promptTokens=${res.promptTokens} (input=${res.usage && res.usage.input} cacheRead=${res.usage && res.usage.cacheRead}) elapsed=${res.elapsed}s toolNameHits=${res.toolNameHits}\n`
  );
}

fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(r => ({
  label: r.label,
  servers: r.servers,
  totalTools: r.totalTools,
  exposure: r.exposure,
  promptTokens: r.promptTokens,
  toolNameHits: r.toolNameHits,
  elapsed: r.elapsed,
})), null, 2));
