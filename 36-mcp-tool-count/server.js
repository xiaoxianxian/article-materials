#!/usr/bin/env node
/**
 * 零依赖 MCP server（手写 JSON-RPC 2.0 over stdio）
 * 目的：为 Pi 的 codemode vs direct 对照实测提供可控、可复现的工具集。
 *   TOOL_COUNT  暴露的工具数量（默认 20）
 *   DESC_LEN    每个工具描述的目标字符数（默认 900，贴近真实 MCP server）
 */

const TOOL_COUNT = Number(process.env.TOOL_COUNT || 20);
const DESC_LEN = Number(process.env.DESC_LEN || 900);

// ---- 生成贴近真实形态的工具集 ----
const VERBS = [
  "list", "read", "write", "search", "delete", "move", "copy", "stat",
  "diff", "grep", "watch", "sync", "export", "import", "archive", "restore",
  "validate", "transform", "analyze", "summarize", "index", "resolve", "inspect", "trace",
];
const NOUNS = [
  "documents", "repositories", "artifacts", "sessions", "channels", "assets",
  "permissions", "workflows", "entries", "snapshots", "bundles", "tokens",
  "records", "queues", "policies", "metrics", "templates", "variants", "threads", "regions",
];

function pad(text, target) {
  // 用有信息量的填充把描述撑到目标长度，模拟真实 server 的长说明
  const filler =
    " Accepts optional filters for scope, time range, and pagination. " +
    "Returns a structured result envelope containing the matched items, " +
    "a cursor for continuation, and diagnostics about how the request was resolved. " +
    "Prefer narrow filters over broad ones: broad scans are rate limited and may be truncated. " +
    "Errors are reported with a stable error code and a human readable explanation. " +
    "This tool is idempotent for identical arguments unless a mutation flag is supplied. " +
    "Callers should cache results when the underlying collection is known to be stable.";
  let out = text;
  let i = 0;
  while (out.length < target) {
    out += filler;
    if (i++ > 20) break;
  }
  return out.slice(0, target);
}

const TOOLS = [];
for (let i = 0; i < TOOL_COUNT; i++) {
  const verb = VERBS[i % VERBS.length];
  const noun = NOUNS[Math.floor(i / VERBS.length) % NOUNS.length];
  const name = `${verb}_${noun}`;
  const base =
    `${verb.toUpperCase()} ${noun} in the connected workspace. ` +
    `Use this tool to ${verb} one or more ${noun} identified by path, id, or query. `;
  TOOLS.push({
    name,
    description: pad(base, DESC_LEN),
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: `The ${noun} to ${verb}, given as a path or identifier.` },
        query: { type: "string", description: `Optional filter applied before ${verb} runs.` },
        limit: { type: "integer", description: "Maximum number of items to return." },
        dryRun: { type: "boolean", description: "When true, report the plan without applying it." },
      },
      required: ["target"],
    },
  });
}

// ---- JSON-RPC over stdio ----
const PROTOCOL_VERSION = "2025-11-25";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    handle(req);
  }
});

function handle(req) {
  const { id, method, params } = req;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const err = (code, message) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "bench-mock", version: "1.0.0" },
        instructions:
          "Bench mock server. Every tool echoes its arguments and returns a synthetic payload. " +
          "Combine several tools to answer questions about the workspace.",
      });
      break;

    case "tools/list":
      reply({ tools: TOOLS });
      break;

    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const known = TOOLS.some((t) => t.name === name);
      if (!known) {
        reply({
          content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool", name }) }],
          isError: true,
        });
        break;
      }
      reply({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tool: name,
              echo: args,
              items: [
                { id: "a1", name: "alpha", bytes: 1024 },
                { id: "b2", name: "beta", bytes: 2048 },
                { id: "c3", name: "gamma", bytes: 4096 },
              ],
              totalBytes: 7168,
              truncated: false,
            }),
          },
        ],
        structuredContent: { tool: name, ok: true, totalBytes: 7168 },
        isError: false,
      });
      break;
    }

    case "ping":
      reply({});
      break;

    case "notifications/initialized":
      break;

    default:
      if (method && method.startsWith("notifications/")) break;
      err(-32601, `method not found: ${method}`);
  }
}

process.stdin.on("end", () => process.exit(0));
