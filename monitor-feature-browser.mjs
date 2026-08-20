import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "feature-state.json");
const REPORT_FILE = path.join(DATA_DIR, "feature-report-latest.md");
const ENV_FILE = path.join(ROOT, ".env");
const REPORT_TIMEZONE = "Asia/Shanghai";

const GLOBAL_TERMS = [
  "tool",
  "tools",
  "feature",
  "features",
  "studio",
  "generator",
  "generators",
  "app",
  "apps",
  "agent",
  "workflow",
  "canvas",
  "skill",
  "skills",
  "plugin",
  "plugins",
  "template",
  "templates",
  "editor",
  "suite",
  "explore",
  "product",
  "products",
  "video",
  "image",
  "audio",
  "voice",
  "avatar",
  "effect",
  "effects",
  "toolkit"
];

const STANDARD_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"];
const LOCALE_SEGMENTS = new Set([
  "en",
  "ms",
  "zh",
  "zh-cn",
  "zh-tw",
  "tw",
  "ja",
  "ja-jp",
  "ko",
  "ko-kr",
  "es",
  "es-419",
  "fr",
  "fr-fr",
  "de",
  "de-de",
  "it",
  "it-it",
  "pt",
  "pt-br",
  "ru",
  "ru-ru",
  "ar",
  "ar-sa",
  "th",
  "th-th",
  "tr",
  "tr-tr",
  "pl",
  "nl",
  "id",
  "id-id",
  "nb",
  "da",
  "vi",
  "vi-vn",
  "hi"
]);
const HARD_REJECT_PATH_KEYWORDS = [
  "blog",
  "blogs",
  "guide",
  "guides",
  "docs",
  "documentation",
  "help",
  "support",
  "case-studies",
  "creator-hub",
  "academy",
  "contests",
  "projects",
  "pricing",
  "contact",
  "about",
  "careers",
  "jobs",
  "privacy",
  "terms",
  "affiliate",
  "login",
  "signin",
  "sign-in",
  "download",
  "prompt",
  "prompts",
  "alternative",
  "alternatives",
  "make",
  "preset",
  "presets",
  "template",
  "templates"
];
const ASSET_PATH_RE = /\.(dmg|exe|zip|pdf|png|jpe?g|webp|gif|mp4|mov|avi|webm|svg|ico)$/i;

const GENERIC_LABELS = new Set([
  "",
  "home",
  "pricing",
  "price",
  "blog",
  "news",
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
  "company",
  "menu",
  "close"
]);

const SOURCES = [
  {
    name: "Higgsfield",
    seedUrls: [
      "https://higgsfield.ai/",
      "https://higgsfield.ai/supercomputer",
      "https://higgsfield.ai/canvas-intro",
      "https://higgsfield.ai/plugins/photoshop",
      "https://higgsfield.ai/academy"
    ],
    allowedHosts: ["higgsfield.ai", "www.higgsfield.ai", "geo.higgsfield.ai"],
    pathKeywords: [
      "supercomputer",
      "canvas",
      "plugin",
      "plugins",
      "academy",
      "studio",
      "agent",
      "workflow",
      "tool",
      "tools",
      "app",
      "apps",
      "feature",
      "features",
      "mcp"
    ],
    sitemapIncludePaths: [
      "^/apps(?:/[^/]+)?/?$",
      "^/plugins(?:/[^/]+)?/?$",
      "^/(?:supercomputer|canvas|canvas-intro|mcp|marketing-studio|marketing-studio-intro|cinematic-video-generator|ai-image|ai-video|ai-influencer-studio|app-builder-intro)/?$"
    ],
    rejectKeywords: ["blog", "pricing", "contact", "about", "careers", "jobs", "privacy", "terms"],
    maxItems: 120
  },
  {
    name: "Pollo AI",
    seedUrls: [
      "https://pollo.ai/",
      "https://pollo.ai/video-effects",
      "https://pollo.ai/ai-video-generator",
      "https://pollo.ai/ai-video-editor"
    ],
    allowedHosts: ["pollo.ai", "www.pollo.ai"],
    pathKeywords: [
      "video-effects",
      "ai-video",
      "video-generator",
      "video-editor",
      "tool",
      "tools",
      "app",
      "apps",
      "create",
      "generator",
      "generators",
      "template",
      "templates",
      "effect",
      "effects",
      "image-to-video",
      "video-to-video",
      "text-to-video",
      "face-swap",
      "avatar"
    ],
    rejectKeywords: ["blog", "pricing", "contact", "about", "careers", "jobs", "privacy", "terms"],
    maxItems: 160
  },
  {
    name: "LibTV",
    seedUrls: ["https://libtv.org/"],
    allowedHosts: ["libtv.org", "www.libtv.org"],
    pathKeywords: ["feature", "features", "tool", "tools", "app", "apps", "create", "generator", "studio", "workflow", "video", "skill", "skills"],
    rejectKeywords: ["blog", "pricing", "contact", "about", "privacy", "terms"],
    maxItems: 120
  },
  {
    name: "Flova AI",
    seedUrls: [
      "https://www.flova.ai/",
      "https://www.flova.ai/docs/en",
      "https://www.flova.ai/docs/en/features"
    ],
    allowedHosts: ["flova.ai", "www.flova.ai"],
    pathKeywords: ["docs", "feature", "features", "agent", "workflow", "studio", "skill", "skills", "tool", "tools", "create", "editor", "guide"],
    allowContentPaths: ["^/en/docs/features/"],
    sitemapIncludePaths: ["^/skill/?$", "^/agent-cli/?$", "^/docs/features/[^/]+/?$"],
    rejectKeywords: ["blog", "pricing", "contact", "about", "privacy", "terms"],
    maxItems: 160
  },
  {
    name: "Deevid AI",
    seedUrls: ["https://deevid.ai/", "https://deevid.ai/explore"],
    allowedHosts: ["deevid.ai", "www.deevid.ai"],
    pathKeywords: ["explore", "ai-video", "video", "tool", "tools", "app", "apps", "create", "generator", "template", "templates", "effect", "effects", "avatar", "voice", "music", "image"],
    rejectKeywords: ["blog", "pricing", "contact", "about", "privacy", "terms"],
    maxItems: 140
  },
  {
    name: "Topview AI",
    seedUrls: ["https://www.topview.ai/", "https://www.topview.ai/guides/topview-official-guide"],
    allowedHosts: ["topview.ai", "www.topview.ai"],
    pathKeywords: ["motion", "motion-studio", "video-agent", "ai-video", "ai-image", "ai-avatar", "ai-audio", "tool", "tools", "feature", "features", "studio", "generator", "board", "ads", "image", "audio"],
    sitemapIncludePaths: [
      "^/(?:motion-studio|drama-studio|board|canvas|topview-skill|ai-image-generator|ai-video-generator|ai-avatar|ai-audio|video-character-swap|video-upscale|motion-control|inpaint|image-character-swap|image-face-swap|image-upscale|photo-angle-editor|virtual-try-on|product-photography|voiceover)/?$"
    ],
    rejectKeywords: ["blog", "pricing", "contact", "about", "privacy", "terms"],
    maxItems: 160
  },
  {
    name: "Yapper",
    seedUrls: ["https://getyapper.app/"],
    allowedHosts: ["getyapper.app", "yapper.so", "www.yapper.so", "yapper.ai", "www.yapper.ai"],
    pathKeywords: ["feature", "features", "tool", "tools", "app", "apps", "voice", "dictation", "record", "meeting", "workspace", "assistant", "editor", "studio", "transcribe", "transcription"],
    rejectKeywords: ["blog", "pricing", "contact", "about", "privacy", "terms"],
    maxItems: 120
  },
  {
    name: "Artlist",
    seedUrls: [
      "https://artlist.io/ai",
      "https://artlist.io/blog/new-ai-toolkit",
      "https://help.artlist.io/hc/en-us/categories/33334424159005-AI-Toolkit"
    ],
    allowedHosts: ["artlist.io", "www.artlist.io", "help.artlist.io"],
    pathKeywords: ["ai", "toolkit", "tool", "tools", "feature", "features", "studio", "generator", "music", "video", "voice", "help", "guide", "creator", "editor"],
    rejectKeywords: ["pricing", "contact", "about", "privacy", "terms"],
    maxItems: 160
  }
];

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

function stripLocalePath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 1 && LOCALE_SEGMENTS.has(parts[0].toLowerCase())) {
    return `/${parts.slice(1).join("/")}`;
  }
  return pathname || "/";
}

function canonicalPageKey(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let pathname = stripLocalePath(parsed.pathname.toLowerCase()).replace(/\/+$/, "");
    if (!pathname) pathname = "/";
    return `${hostname}${pathname}${parsed.search}`;
  } catch {
    return normalizeUrl(url);
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

function containsAny(text, terms) {
  const value = (text || "").toLowerCase();
  return terms.some((term) => value.includes(String(term).toLowerCase()));
}

function isGenericLabel(text) {
  return GENERIC_LABELS.has(normalizeText(text).toLowerCase());
}

function isAllowedContentPath(pathname, source) {
  const patterns = source.allowContentPaths || [];
  return patterns.some((pattern) => new RegExp(pattern, "i").test(pathname));
}

function isHardRejectedPath(pathname, source) {
  const normalized = pathname.toLowerCase();
  if (isAllowedContentPath(normalized, source)) return false;
  const keywords = source.hardRejectKeywords || HARD_REJECT_PATH_KEYWORDS;
  return keywords.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[\\/._-])${escaped}(?:$|[\\/._-])`, "i").test(normalized);
  });
}

function matchesPathPatterns(pathname, patterns = []) {
  const normalized = stripLocalePath(pathname.toLowerCase()).replace(/\/+$/, "") || "/";
  return patterns.some((pattern) => new RegExp(pattern, "i").test(normalized));
}

function shouldKeepSitemapCandidate(candidate, source) {
  try {
    const parsed = new URL(candidate.url);
    const pathname = parsed.pathname.toLowerCase();
    if (source.sitemapIncludePaths?.length && !matchesPathPatterns(pathname, source.sitemapIncludePaths)) {
      return false;
    }
  } catch {
    return false;
  }

  return shouldKeepCandidate(candidate, source);
}

function scoreCandidate(candidate, source) {
  const title = normalizeText(candidate.title);
  const context = normalizeText(candidate.contextText);
  const pathname = candidate.pathname.toLowerCase();
  const haystack = `${title} ${context} ${candidate.url}`.toLowerCase();

  let score = 0;
  if (containsAny(pathname, source.pathKeywords)) score += 2;
  if (containsAny(title, source.pathKeywords)) score += 2;
  if (containsAny(context, source.pathKeywords)) score += 1;
  if (containsAny(haystack, GLOBAL_TERMS)) score += 1;
  if (containsAny(pathname, source.rejectKeywords) && !containsAny(pathname, source.pathKeywords)) score -= 4;
  if (isGenericLabel(title)) score -= 2;
  if (title.length < 3 || title.length > 100) score -= 1;
  if (!/[A-Za-z0-9]/.test(title)) score -= 1;
  return score;
}

function shouldKeepCandidate(candidate, source) {
  const url = normalizeUrl(candidate.url);
  if (!url || !isAllowedHost(url, source)) return false;
  if (/^(mailto:|tel:|javascript:)/i.test(url)) return false;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (ASSET_PATH_RE.test(pathname)) return false;
    if (isHardRejectedPath(pathname, source)) return false;
    const candidateCopy = { ...candidate, url, pathname };
    return scoreCandidate(candidateCopy, source) >= 2;
  } catch {
    return false;
  }
}

function itemId(item) {
  return crypto.createHash("sha1").update(item.canonicalKey || `${item.title}|${item.url}`).digest("hex");
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = stripLocalePath(parsed.pathname);
    const segments = pathname.split("/").filter(Boolean);
    const slug = segments.at(-1) || parsed.hostname.replace(/^www\./, "");
    return decodeURIComponent(slug)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(ai|ugc|mcp|cli|api|gpt|seo)\b/gi, (match) => match.toUpperCase())
      .replace(/\b\w/g, (match) => match.toUpperCase())
      .trim();
  } catch {
    return normalizeText(url);
  }
}

function parseSitemapXml(xml) {
  const entries = [];
  const urlRe = /<url>\s*([\s\S]*?)\s*<\/url>/gi;
  let match;
  while ((match = urlRe.exec(xml))) {
    const block = match[1];
    const loc = (block.match(/<loc>\s*([^<]+)\s*<\/loc>/i) || [])[1];
    const lastmod = (block.match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/i) || [])[1] || "";
    if (loc) entries.push({ loc: loc.trim().replace(/&amp;/g, "&"), lastmod: lastmod.trim() });
  }

  const sitemaps = [];
  const sitemapRe = /<sitemap>\s*([\s\S]*?)\s*<\/sitemap>/gi;
  while ((match = sitemapRe.exec(xml))) {
    const block = match[1];
    const loc = (block.match(/<loc>\s*([^<]+)\s*<\/loc>/i) || [])[1];
    if (loc) sitemaps.push(loc.trim().replace(/&amp;/g, "&"));
  }

  return { entries, sitemaps };
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/xml,text/xml,text/plain,text/html,*/*",
        "user-agent": "Mozilla/5.0 (compatible; CompetitorFeatureMonitor/1.0)"
      }
    });
    return { ok: response.ok, status: response.status, url: response.url, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverSitemapUrls(source) {
  const candidates = new Set(source.sitemapUrls || []);
  for (const sitemapPath of STANDARD_SITEMAP_PATHS) {
    candidates.add(new URL(sitemapPath, source.seedUrls[0]).toString());
  }

  try {
    const robotsUrl = new URL("/robots.txt", source.seedUrls[0]).toString();
    const robots = await fetchText(robotsUrl);
    if (robots.ok) {
      for (const line of robots.text.split(/\r?\n/)) {
        const match = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (match) candidates.add(match[1]);
      }
    }
  } catch {
    // robots.txt is optional.
  }

  return [...candidates];
}

async function scrapeSitemaps(source) {
  const startUrls = await discoverSitemapUrls(source);
  const queue = [...startUrls];
  const seen = new Set();
  const gathered = new Map();

  while (queue.length && seen.size < 80) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);

    try {
      const response = await fetchText(sitemapUrl);
      if (!response.ok) continue;
      const parsed = parseSitemapXml(response.text);
      for (const nested of parsed.sitemaps) {
        if (!seen.has(nested) && queue.length < 120) queue.push(nested);
      }
      for (const entry of parsed.entries) {
        const url = normalizeUrl(entry.loc);
        const title = titleFromUrl(url);
        const candidate = { title, url, contextText: title };
        if (!shouldKeepSitemapCandidate(candidate, source)) continue;
        const canonicalKey = canonicalPageKey(url);
        if (!gathered.has(canonicalKey)) {
          gathered.set(canonicalKey, {
            id: itemId({ title, url, canonicalKey }),
            title,
            url,
            lastmod: entry.lastmod,
            canonicalKey
          });
        }
      }
    } catch (error) {
      console.log(`[跳过] ${source.name} sitemap -> ${sitemapUrl}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const items = [...gathered.values()].slice(0, source.maxItems);
  if (items.length > 0) {
    console.log(`[进度] ${source.name} sitemap 捕获 ${items.length} 个候选页面`);
  }
  return items;
}

async function extractItemsFromPage(page, source) {
  const anchors = await page.locator("a[href]").evaluateAll((nodes) => {
    return nodes.map((node) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const container =
        node.closest("article, main article, main, section, li, .card, .item, .tool, .template, .effect, .product, .feature, .tile, .panel, .grid") ||
        node.parentElement ||
        node;
      const contextText = ((container && container.textContent) || text).replace(/\s+/g, " ").trim().slice(0, 500);
      const navLike = Boolean(node.closest("nav, footer, aside, [role='navigation']"));
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
        pathDepth,
        navLike
      };
    });
  });

  const deduped = new Map();
  for (const anchor of anchors) {
    if (anchor.navLike) continue;
    const title = normalizeText(anchor.text);
    const url = normalizeUrl(anchor.href);
    if (!url || !title) continue;

    const candidate = {
      title,
      url,
      contextText: normalizeText(anchor.contextText),
      anchorDepth: Number(anchor.pathDepth || 0)
    };

    if (!shouldKeepCandidate(candidate, source)) continue;

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

async function scrapePage(browser, source, url) {
  const context = await browser.newContext({
    locale: "en-US",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
  });

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(800);
    return await extractItemsFromPage(page, source);
  } finally {
    await context.close().catch(() => {});
  }
}

async function scrapeSource(browser, source) {
  const gathered = new Map();
  const sitemapItems = await scrapeSitemaps(source);
  for (const item of sitemapItems) {
    if (!gathered.has(item.id)) gathered.set(item.id, item);
  }

  for (const url of source.seedUrls) {
    console.log(`[采集] ${source.name} -> ${url}`);
    try {
      const items = await scrapePage(browser, source, url);
      for (const item of items) {
        if (!gathered.has(item.id)) gathered.set(item.id, item);
      }
    } catch (error) {
      console.log(`[跳过] ${source.name} -> ${url}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const items = [...gathered.values()];
  console.log(`[进度] ${source.name} 当前捕获 ${items.length} 个候选页面`);
  if (items.length === 0) {
    throw new Error("未提取到可用页面");
  }
  return items;
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

  const changedSources = items.filter((source) => !source.error && source.newItems.length > 0);
  const lines = ["竞品功能/工具页监测日报", `生成时间：${dateStr}（上海）`, ""];
  if (changedSources.length === 0) {
    lines.push("今日未发现新功能/工具页");
    return lines.join("\n");
  }

  for (const source of changedSources) {
    lines.push(`${source.name}：${source.newItems.length} 个`);
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

  const changedSources = items.filter((source) => !source.error && source.newItems.length > 0);
  const lines = ["# 竞品功能/工具页监测日报", "", `生成时间：${dateStr}（上海）`, ""];
  const total = changedSources.reduce((sum, item) => sum + item.newItems.length, 0);
  lines.push(`新增页面总数：${total}`, "");

  if (changedSources.length === 0) {
    lines.push("今日未发现新功能/工具页", "");
    return lines.join("\n");
  }

  for (const source of changedSources) {
    lines.push(`## ${source.name}（${source.newItems.length}）`);
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
