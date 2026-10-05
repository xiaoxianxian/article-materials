# Pi 0.99.2：`codemode` vs `direct` 挂载成本实测材料

对应文章《MCP 工具挂几个算贵？3 到 8 个是交叉点》（公众号 2026-10-06 已发：<https://mp.weixin.qq.com/s/KPlmlvWeBR_k96jizhA5wg>，"两笔账"那一节的数字出处）。

这是一组**可自己重跑**的实验材料：一个零依赖的 MCP mock server + 四个 runner + 汇总读数。

> 位置：本仓库（[`xiaoxianxian/article-materials`](../README.md)）的 `36-mcp-tool-count/` 目录。所有材料都在这个仓库里，
> 文章正文只引仓库地址，不用到处找散链接。

> ⚠️ 三条先说清楚，别拿错的数去生产环境用：
> 1. 跑在本地 Ollama 上的 27B 模型，**任务完成度不在本次口径里**（本地小模型撑不起编排类任务的验证），本文只测**工具挂载成本**。
> 2. prompt cache 那组跑的是**本地 Ollama 的 prompt cache**，跟 Anthropic / OpenAI 一类商业 API 的 prefix caching 不是一回事。这里给的是**机制判断**（前缀一变，后面全断），命中率数字**不能跨环境外推**。
> 3. **耗时一列不进结论**。本机同时还在跑别的东西，MLX 负载不稳，同一配置两次跑能差一倍。要引的是 token 那一列。

---

## 环境

| 项 | 值 |
|---|---|
| 被测运行时 | Pi 0.99.2（`npm pack @earendil-works/pi-coding-agent` 解包核对） |
| 模型 | Ollama 0.34.1 + `qwen3.8:27b-mlx`（MLX 4-bit + BF16 embed） |
| 机器 | Apple Silicon，48GB 统一内存 |
| MCP server | 本目录下的 `server.js`，零依赖、手写 JSON-RPC 2.0 over stdio |
| 变量 | `TOOL_COUNT` 控工具数（默认 20）、`DESC_LEN` 控单描述长度（默认 900 字符） |

## 目录

```
server.js       零依赖 MCP mock server，工具数与描述长度完全可控
run-bench.js    runner v1：无 nonce 版对照
run-bench2.js   runner v2：加 nonce 版对照（文章里的数主要是这版）
run-bench3.js   runner v3：补充组
run-cache-test.js / run-cache-r5.js   prompt cache 打穿实验的 runner
data/*.json     汇总读数（四份，见下）
05-实测记录.md  完整的逐轮记录与实验设计取舍
```

`data/` 四份读数分别是：

- `run1-summary.json` — v1 无 nonce 版主表（20 / 60 工具）
- `run2-summary.json` — v2 有 nonce 版主表（0-none / 5 / 10 / 20 / 60）
- `run2b-lown-summary.json` — 低 n 区补测（5 / 10，用来夹出临界点）
- `cache-summary.json` — prompt cache 六轮（r1–r6）读数

## 复现

```bash
# 1) 装 Pi（沙箱里 npm 会静默失败，用独立 cache + 新目录）
mkdir -p fresh && cd fresh
echo '{"name":"bench","version":"1.0.0"}' > package.json
npm install @earendil-works/pi-coding-agent --ignore-scripts --no-audit --no-fund --cache /tmp/pi-npm-cache

# 2) 配本地模型 ~/.pi/agent/models.json
#    baseUrl 必须写 127.0.0.1 —— 本机 localhost 有 ::1 映射坑

# 3) 跑（--append-system-prompt 的 nonce 不能省，否则缓存不对齐）
node <fresh>/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  --model ollama/qwen3.8:27b-mlx --thinking off --no-session \
  --mode json --append-system-prompt "bench-nonce-XXXXXXXX" -p "Reply with the single word: OK"

# 4) 取最后一个 role=assistant 的 message_end 的 usage，prompt = input + cacheRead
```

runner 里的路径都是相对 `fresh/` 解析的，`NODE_BIN` 环境变量可覆盖 Node 路径（默认取 `node`）。想连跑一整张表，直接 `node run-bench2.js`。

## 已知局限（写引用前请自己先说这一句）

1. **每组只跑了一次**（v1/v2 偏差 <5 tokens，但严格讲不是重复实验）。
2. **只测了单 server 内工具数变化**，没测多 server 并联。
3. **本地 27B 模型**，`codemode` 的任务侧收益没法在这里验证，本文不写那个结论。
4. 临界点跟工具描述长度强相关：本机 mock（900 字符 / 305 tokens）算出来约 7.6，真实描述长度（约 652 tokens/工具）重算约 3.5 —— **两边不是一个口径，别混着用**。

---

数据日期：2026-10-01。`05-实测记录.md` 里有逐轮原始读数和三个"决定成败的取舍"，要看细节翻它。
