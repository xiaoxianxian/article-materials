#!/usr/bin/env node
/**
 * 实验 2：prompt cache 打穿测试
 * 同一 session 连续多轮，前半段固定 exposure，后半段切换 exposure，
 * 观察 cacheRead 是否崩塌 —— 直接验证「工具声明住在请求前缀里」这一设计约束。
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
const SESSION_DIR = "/tmp/pi-cache-session";

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

function writeConfig(exposure) {
  const cfg = {
    mcpServers: {
      bench: {
        command: NODE,
        args: [SERVER],
        env: { TOOL_COUNT: "20", DESC_LEN: "900" },
      },
    },
  };
  if (exposure === "direct") cfg.mcpServers.bench.exposure = "direct";
  fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2) + "\n");
}

function turn(label, prompt, isFirst) {
  const args = [
    PI,
    "--model", "ollama/qwen3.8:27b-mlx",
    "--thinking", "off",
    "--session-dir", SESSION_DIR,
    "--mode", "json",
  ];
  if (!isFirst) args.push("--continue");
  args.push("-p", prompt);

  const t0 = Date.now();
  const r = spawnSync(NODE, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  fs.writeFileSync(path.join(OUT_DIR, `cache-${label}.jsonl`), r.stdout || "");

  let usage = null;
  for (const l of (r.stdout || "").trim().split("\n").filter(Boolean)) {
    try {
      const o = JSON.parse(l);
      if (o.type === "message_end" && o.message && o.message.role === "assistant" && o.message.usage) {
        usage = o.message.usage;
      }
    } catch {}
  }
  return { label, prompt, elapsed: Number(elapsed), usage };
}

const results = [];
// 前三轮：codemode 不变，看缓存是否稳定累积
writeConfig("codemode");
results.push(turn("r1-codemode", "Reply with the single word: OK", true));
results.push(turn("r2-codemode", "Reply with the single word: STILL", false));
results.push(turn("r3-codemode", "Reply with the single word: AGAIN", false));

// 第四轮：切到 direct（工具声明进前缀），看 cacheRead 崩不崩
writeConfig("direct");
results.push(turn("r4-direct", "Reply with the single word: SWITCHED", false));

fs.writeFileSync(path.join(OUT_DIR, "cache-summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
