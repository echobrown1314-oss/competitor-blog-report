import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "showcase-state.json");
const REPORT_FILE = path.join(DATA_DIR, "showcase-report-latest.md");
const ENV_FILE = path.join(ROOT, ".env");
const REPORT_TIMEZONE = "Asia/Shanghai";

const SOURCES = [
  {
    name: "MagicHour",
    home: "https://magichour.ai/products/",
    allowedHosts: ["magichour.ai"],
    itemPatterns: [/^https:\/\/magichour\.ai\/products\/[^/?#]+\/?$/i],
    maxItems: 200
  },
  {
    name: "Viddo AI",
    home: "https://viddo.ai/video-effects",
    allowedHosts: ["viddo.ai"],
    itemPatterns: [/^https:\/\/viddo\.ai\/.+/i],
    maxItems: 220
  },
  {
    name: "DeeVid AI",
    home: "https://deevid.ai/",
    allowedHosts: ["deevid.ai"],
    itemPatterns: [/^https:\/\/deevid\.ai\/.+/i],
    maxItems: 120
  },
  {
    name: "A2E AI",
    home: "https://a2e.ai/",
    allowedHosts: ["a2e.ai", "video.a2e.ai"],
    itemPatterns: [/^https:\/\/(?:a2e\.ai|video\.a2e\.ai)\/.+/i],
    maxItems: 200
  },
  {
    name: "Kling AI",
    home: "https://kling.ai/",
    allowedHosts: ["kling.ai"],
    itemPatterns: [/^https:\/\/kling\.ai\/.+/i],
    maxItems: 120
  },
  {
    name: "InVideo",
    home: "https://invideo.io/",
    allowedHosts: ["invideo.io"],
    itemPatterns: [/^https:\/\/invideo\.io\/.+/i],
    maxItems: 180
  },
  {
    name: "Higgsfield AI",
    home: "https://higgsfield.ai/",
    allowedHosts: ["higgsfield.ai"],
    itemPatterns: [/^https:\/\/higgsfield\.ai\/.+/i],
    maxItems: 180
  }
];

const EXCLUDED_TEXTS = new Set([
  "",
  "home",
  "pricing",
  "price",
  "blog",
  "docs",
  "documentation",
  "support",
  "help",
  "contact",
  "contact us",
  "about",
  "about us",
  "api",
  "quick start",
  "start for free",
  "start free",
  "start creating",
  "create now",
  "sign in",
  "log in",
  "login",
  "register",
  "affiliate",
  "my creations",
  "view all",
  "view more",
  "more tools",
  "learn more",
  "read more",
  "try now",
  "try it now",
  "try deevid ai",
  "try deevid",
  "experience now",
  "platform homepage",
  "free trial",
  "open main menu",
  "tools",
  "effects",
  "ai effect",
  "ai video",
  "ai image",
  "ai voice",
  "ai music",
  "video tools",
  "image tools",
  "image models",
  "video models",
  "voice model",
  "company"
]);

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

async function loadEnv() {
  const merged = { ...process.env };
  try {
    const text = await fs.readFile(ENV_FILE, "utf8");
    return { ...parseEnv(text), ...merged };
  } catch {
    return merged;
  }
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj[key]) return obj[key];
  }
  return "";
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function normalizeState(state) {
  return {
    snapshots: state?.snapshots && typeof state.snapshots === "object" ? state.snapshots : {}
  };
}

async function loadState() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(text));
  } catch {
    return normalizeState({});
  }
}

async function saveState(state) {
  await ensureDataDir();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isAllowedHost(url, source) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return source.allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function matchesItemPattern(url, source) {
  if (!source.itemPatterns || source.itemPatterns.length === 0) return true;
  return source.itemPatterns.some((pattern) => pattern.test(url));
}

function shouldKeepItem(candidate, source) {
  const title = normalizeText(candidate.title);
  if (!title) return false;

  const key = title.toLowerCase();
  if (EXCLUDED_TEXTS.has(key)) return false;
  if (title.length < 3 || title.length > 90) return false;
  if (/^(home|more|new|hot)$/i.test(title)) return false;
  if (!/[A-Za-z0-9]/.test(title)) return false;

  const url = normalizeUrl(candidate.url);
  if (!url || !isAllowedHost(url, source)) return false;
  if (/^(mailto:|tel:|javascript:)/i.test(url)) return false;

  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") return false;
    if (/\/(?:blog|pricing|docs|documentation|about|contact|login|signin|signup|register)\/?$/i.test(parsed.pathname)) {
      return false;
    }
  } catch {
    return false;
  }

  if (!matchesItemPattern(url, source) && candidate.anchorDepth <= 1) return false;

  return true;
}

function itemId(item) {
  return crypto.createHash("sha1").update(`${item.title}|${item.url}`).digest("hex");
}

async function extractItemsFromPage(page, source) {
  const anchors = await page.locator("a[href]").evaluateAll((nodes) => {
    const pageHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    return nodes.map((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const rect = node.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const container =
        node.closest("article, main article, section, li, .card, .item, .tool, .template, .effect, .product") ||
        node.parentElement ||
        node;
      const contextText = ((container && container.textContent) || text).replace(/\s+/g, " ").trim().slice(0, 300);
      const pathDepth = (() => {
        try {
          return new URL(node.href).pathname.split("/").filter(Boolean).length;
        } catch {
          return 0;
        }
      })();
      return {
        href: node.href || "",
        text,
        contextText,
        top,
        pageHeight,
        pathDepth
      };
    });
  });

  const deduped = new Map();
  for (const anchor of anchors) {
    const title = normalizeText(anchor.text);
    const url = normalizeUrl(anchor.href);
    const top = Number(anchor.top || 0);
    const pageHeight = Number(anchor.pageHeight || 0);

    if (!url || !title) continue;
    if (top < 140) continue;
    if (pageHeight > 0 && top > pageHeight * 0.92) continue;

    const candidate = {
      title,
      url,
      contextText: normalizeText(anchor.contextText),
      anchorDepth: Number(anchor.pathDepth || 0)
    };

    if (!shouldKeepItem(candidate, source)) continue;

    const id = itemId(candidate);
    if (!deduped.has(id)) {
      deduped.set(id, {
        id,
        title: candidate.title,
        url: candidate.url
      });
    }
  }

  return [...deduped.values()].slice(0, source.maxItems);
}

async function scrapeSource(browser, source) {
  const context = await browser.newContext({
    locale: "en-US",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
  });

  try {
    const page = await context.newPage();
    await page.goto(source.home, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1800);
    await page.mouse.wheel(0, 1600).catch(() => {});
    await page.waitForTimeout(1200);
    const items = await extractItemsFromPage(page, source);
    console.log(`[进度] ${source.name} 当前捕获 ${items.length} 个候选页面`);
    if (items.length === 0) {
      throw new Error("未提取到可用页面");
    }
    return items;
  } finally {
    await context.close().catch(() => {});
  }
}

function diffNewItems(previousItems, currentItems) {
  const previousIds = new Set((previousItems || []).map((item) => item.id));
  return currentItems.filter((item) => !previousIds.has(item.id));
}

function renderDingTalkText(items, generatedAt) {
  const dateStr = new Intl.DateTimeFormat("zh-CN", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(generatedAt);

  const lines = ["竞品模板/玩法页监测日报", `生成时间：${dateStr}（上海）`, ""];
  for (const source of items) {
    lines.push(`${source.name}：${source.newItems.length} 个`);
    if (source.error) {
      lines.push(`抓取异常：${source.error}`);
      lines.push("");
      continue;
    }
    if (source.initialized) {
      lines.push("首次运行，已建立基线");
      lines.push("");
      continue;
    }
    if (source.newItems.length === 0) {
      lines.push("今日未发现新页面");
      lines.push("");
      continue;
    }
    for (const item of source.newItems) {
      lines.push(`- ${item.title}`);
      lines.push(item.url);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderMarkdownReport(items, generatedAt) {
  const dateStr = new Intl.DateTimeFormat("zh-CN", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(generatedAt);

  const lines = ["# 竞品模板/玩法页监测日报", "", `生成时间：${dateStr}（上海）`, ""];
  const total = items.reduce((sum, item) => sum + item.newItems.length, 0);
  lines.push(`新增页面总数：${total}`, "");

  for (const source of items) {
    lines.push(`## ${source.name}（${source.newItems.length}）`);
    if (source.error) {
      lines.push(`- 抓取异常：${source.error}`, "");
      continue;
    }
    if (source.initialized) {
      lines.push("- 首次运行，已建立基线", "");
      continue;
    }
    if (source.newItems.length === 0) {
      lines.push("- 今日未发现新页面", "");
      continue;
    }
    for (const item of source.newItems) {
      lines.push(`- [${item.title}](${item.url})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function sendToDingTalk(text, env) {
  if (pick(env, "DRY_RUN_DINGTALK") === "1") {
    return { skipped: true, reason: "DRY_RUN_DINGTALK=1" };
  }

  const webhook = pick(env, "DINGTALK_WEBHOOK");
  const secret = pick(env, "DINGTALK_SECRET");
  if (!webhook) {
    return { skipped: true, reason: "未配置 DINGTALK_WEBHOOK" };
  }

  const url = new URL(webhook);
  if (secret) {
    const timestamp = Date.now();
    const sign = crypto.createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text } })
  });

  const result = await response.text();
  if (!response.ok) {
    throw new Error(`钉钉发送失败 HTTP ${response.status}: ${result}`);
  }

  return { skipped: false, result };
}

async function main() {
  await ensureDataDir();
  const env = await loadEnv();
  const state = await loadState();
  const generatedAt = new Date();
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox"]
  });

  const reportItems = [];
  try {
    for (const source of SOURCES) {
      console.log(`\n[开始] ${source.name}`);
      try {
        const currentItems = await scrapeSource(browser, source);
        const previousItems = Array.isArray(state.snapshots[source.name]) ? state.snapshots[source.name] : null;
        const initialized = !previousItems;
        const newItems = initialized ? [] : diffNewItems(previousItems, currentItems);
        state.snapshots[source.name] = currentItems;
        reportItems.push({ name: source.name, newItems, initialized, error: "" });
        console.log(`[完成] ${source.name} 新增 ${newItems.length} 个页面`);
      } catch (error) {
        reportItems.push({
          name: source.name,
          newItems: [],
          initialized: false,
          error: error instanceof Error ? error.message : String(error)
        });
        console.log(`[异常] ${source.name}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const markdown = renderMarkdownReport(reportItems, generatedAt);
  const dingTalkText = renderDingTalkText(reportItems, generatedAt);
  await fs.writeFile(REPORT_FILE, markdown, "utf8");
  await saveState(state);

  const sendResult = await sendToDingTalk(dingTalkText, env).catch((error) => ({
    skipped: false,
    error: error instanceof Error ? error.message : String(error)
  }));

  console.log(markdown);
  if (sendResult.skipped) {
    console.log(`\n钉钉发送：已跳过，${sendResult.reason}`);
  } else if (sendResult.error) {
    console.log(`\n钉钉发送：失败，${sendResult.error}`);
    process.exitCode = 1;
  } else {
    console.log("\n钉钉发送：成功");
  }
}

await main();
