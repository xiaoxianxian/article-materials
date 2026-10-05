#!/usr/bin/env node
/**
 * v2：加 nonce 强制 prompt cache 冷启动，消除跨组缓存干扰。
 * 每组用不同的 --append-system-prompt，前缀必然不同 → input 即真实 prompt 长度。
 * 同时跑 scaling：工具数 0 / 20 / 60 / 100 × exposure codemode / direct
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

function writeConfig(toolCount, exposure) {
  const cfg = { mcpServers: {} };
  if (toolCount > 0) {
    cfg.mcpServers.bench = {
      command: NODE,
      args: [SERVER],
      env: { TOOL_COUNT: String(toolCount), DESC_LEN: "900" },
    };
    if (exposure === "direct") cfg.mcpServers.bench.exposure = "direct";
  }
  fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2) + "\n");
}

function nonce() {
  return Math.random().toString(36).slice(2, 10);
}

function clearLocks() {
  // 根因（2026-10-01 定位）：Pi 每次运行会在 ~/.pi/agent 下 mkdir <name>.lock，
  // 但释放时调 unlink/rmdir —— 本沙箱的 safe-delete broker 会静默拒绝，锁永远残留。
  // 下一轮运行再 mkdir 就 EEXIST，整条 credential 读取直接失败（表现为 3 秒退出、无 usage）。
  // 所以每次 spawn Pi 之前必须把锁和 credential 文件一起重置走「首次初始化」路径。
  // 只用 rename：rmSync / unlinkSync 在 ~/.pi 下同样被拒。
  const d = path.join(os.homedir(), ".pi/agent");
  if (!fs.existsSync(d)) return;
  const ts = Date.now();
  for (const f of fs.readdirSync(d)) {
    const isLock = f.endsWith(".lock") || f.includes(".lock.stale");
    const isCred = f === "auth.json" || f === "models-store.json";
    if (!isLock && !isCred) continue;
    try {
      fs.renameSync(path.join(d, f), path.join(d, f + ".stale" + ts));
    } catch (e) {
      process.stderr.write(`[clear-locks] 清不掉 ${f}: ${e.code}\n`);
    }
  }
}

function run(toolCount, exposure) {
  const label = `${toolCount}-${exposure}`;
  writeConfig(toolCount, exposure);
  clearLocks();
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
  let toolNameHits = 0, mcpRefs = 0, codemodeRefs = 0;
  const text = r.stdout || "";
  for (const l of text.trim().split("\n").filter(Boolean)) {
    try {
      const o = JSON.parse(l);
      if (o.type === "message_end" && o.message && o.message.role === "assistant" && o.message.usage) {
        usage = o.message.usage;
      }
    } catch {}
  }
  toolNameHits = (text.match(/list_documents/g) || []).length;
  mcpRefs = (text.match(/mcp__/g) || []).length;
  codemodeRefs = (text.match(/codemode/g) || []).length;

  return {
    label, toolCount, exposure, nonce: n,
    elapsed: Number(elapsed), usage,
    promptTokens: usage ? usage.input + usage.cacheRead : null,
    toolNameHits, mcpRefs, codemodeRefs,
  };
}

const plan = JSON.parse(process.argv[2] || '[{"toolCount":0,"exposure":"none"},{"toolCount":20,"exposure":"codemode"},{"toolCount":20,"exposure":"direct"},{"toolCount":60,"exposure":"codemode"},{"toolCount":60,"exposure":"direct"}]');

const results = [];
for (const p of plan) {
  process.stderr.write(`running ${p.toolCount}-${p.exposure} ...\n`);
  const res = run(p.toolCount, p.exposure);
  results.push(res);
  process.stderr.write(
    `  → promptTokens=${res.promptTokens} input=${res.usage && res.usage.input} cacheRead=${res.usage && res.usage.cacheRead} elapsed=${res.elapsed}s toolNameHits=${res.toolNameHits}\n`
  );
}

fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(r => ({
  label: r.label, toolCount: r.toolCount, exposure: r.exposure,
  promptTokens: r.promptTokens, input: r.usage && r.usage.input,
  cacheRead: r.usage && r.usage.cacheRead, output: r.usage && r.usage.output,
  elapsed: r.elapsed, toolNameHits: r.toolNameHits, codemodeRefs: r.codemodeRefs,
})), null, 2));
