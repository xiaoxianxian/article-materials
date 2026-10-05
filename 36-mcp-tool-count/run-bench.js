#!/usr/bin/env node
/**
 * Pi codemode vs direct 对照实测 runner
 * 每次改 ~/.pi/agent/mcp.json（工具数 + exposure），跑一次最简 prompt，
 * 从 --mode json 的 usage 里取 input/cacheRead/output/totalTokens。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const NODE = process.env.NODE_BIN || "node";
const PI = path.resolve(__dirname, "fresh/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const MCP_JSON = path.join(os.homedir(), ".pi/agent/mcp.json");
const SERVER = path.resolve(__dirname, "mcp-mock/server.js");
const OUT_DIR = path.resolve(__dirname, "results");
const PROMPT = "Reply with the single word: OK";

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function writeConfig(toolCount, exposure) {
  const cfg = {
    mcpServers: {
      bench: {
        command: NODE,
        args: [SERVER],
        env: { TOOL_COUNT: String(toolCount), DESC_LEN: "900" },
      },
    },
  };
  if (exposure === "direct") cfg.mcpServers.bench.exposure = "direct";
  fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2) + "\n");
}

function run(label, toolCount, exposure) {
  writeConfig(toolCount, exposure);
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
      "-p", PROMPT,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 }
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(out, r.stdout || "");

  // 取最后一个带 usage 的 message_end
  let usage = null;
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (o.message && o.message.usage && o.message.role === "assistant" && o.type === "message_end") {
        usage = o.message.usage;
      }
    } catch {}
  }
  return { label, toolCount, exposure, elapsed: Number(elapsed), usage, stderr: (r.stderr || "").slice(-300) };
}

const plan = process.argv[2]
  ? JSON.parse(process.argv[2])
  : [
      { toolCount: 20, exposure: "codemode" },
      { toolCount: 20, exposure: "direct" },
      { toolCount: 60, exposure: "codemode" },
      { toolCount: 60, exposure: "direct" },
    ];

const results = [];
for (const p of plan) {
  const label = `${p.toolCount}-${p.exposure}`;
  process.stderr.write(`running ${label} ...\n`);
  const res = run(label, p.toolCount, p.exposure);
  results.push(res);
  process.stderr.write(
    `  ${label}: elapsed=${res.elapsed}s usage=${JSON.stringify(res.usage)}\n`
  );
}

fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
