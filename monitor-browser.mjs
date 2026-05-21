import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "state-browser.json");
const REPORT_FILE = path.join(DATA_DIR, "browser-report-latest.md");
const ENV_FILE = path.join(ROOT, ".env");

const REPORT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_SITEMAP_PATHS = ["/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/post-sitemap.xml", "/blog-sitemap.xml"];

const SOURCES = [
  {
    name: "LitMedia",
    home: "https://www.litmedia.ai/resource/",
    articlePatterns: [/^https:\/\/www\.litmedia\.ai\/resource\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "MindVideo",
    home: "https://www.mindvideo.ai/blog/",
    articlePatterns: [/^https:\/\/www\.mindvideo\.ai\/blog\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "Topview",
    home: "https://www.topview.ai/blog",
    articlePatterns: [/^https:\/\/www\.topview\.ai\/blog\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "DataCamp",
    home: "https://www.datacamp.com/blog",
    articlePatterns: [/^https:\/\/www\.datacamp\.com\/blog\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "WaveSpeed",
    home: "https://wavespeed.ai/blog/",
    articlePatterns: [/^https:\/\/wavespeed\.ai\/blog\/posts\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "WeShop AI",
    home: "https://www.weshop.ai/blog/",
    articlePatterns: [/^https:\/\/www\.weshop\.ai\/blog\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "Atlas Cloud",
    home: "https://www.atlascloud.ai/blog",
    articlePatterns: [/^https:\/\/www\.atlascloud\.ai\/blog\/(?:guides|ai-updates|case-studies)\/[^/]+\/?$/i],
    maxCandidates: 16
  },
  {
    name: "TopMediai",
    home: "https://www.topmediai.com/video-tips/",
    articlePatterns: [/^https:\/\/www\.topmediai\.com\/video-tips\/[^/]+\/?$/i],
    maxCandidates: 12
  },
  {
    name: "JXP",
    home: "https://www.jxp.com/blog",
    articlePatterns: [/^https:\/\/www\.jxp\.com\/blog\/[^/]+\/?$/i],
    maxCandidates: 12
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
    reported: state?.reported && typeof state.reported === "object" ? state.reported : {}
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
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isCandidateUrl(url, source) {
  return source.articlePatterns.some((pattern) => pattern.test(url));
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return "";
}

function extractVisibleDate(text) {
  const top = (text || "").slice(0, 8000);
  const match = top.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\b|\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b|\b\d{2}\/\d{2}\/\d{4}\b/i
  );
  return match?.[0] || "";
}

function extractArticleDates(html, bodyText, fallbackDate = "", contextText = "") {
  const publishedAt = extractFirst(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"uploadDate"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ]);

  const updatedAt = extractFirst(html, [
    /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:updated_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
    /"dateModified"\s*:\s*"([^"]+)"/i,
    /"lastmod"\s*:\s*"([^"]+)"/i
  ]);

  const visibleDate = extractVisibleDate(bodyText);
  const contextDate = extractVisibleDate(contextText);

  return {
    publishedAt: publishedAt || visibleDate || contextDate || fallbackDate || "",
    updatedAt: updatedAt || fallbackDate || ""
  };
}

function extractTitle(html, bodyText, fallback) {
  const title =
    extractFirst(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    ]) ||
    bodyText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 8) ||
    fallback;

  return normalizeText(title);
}

function safeDate(value) {
  if (!value) return null;
  const normalized = value.trim();
  const direct = new Date(normalized);
  if (!Number.isNaN(direct.getTime())) return direct;

  const monthDay = normalized.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthDay) {
    const parsed = new Date(`${monthDay[1]} ${monthDay[2]}, ${monthDay[3]} 12:00:00 GMT+0800`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const slash = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    const parsed = new Date(`${yyyy}-${mm}-${dd}T12:00:00+08:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const isoDay = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDay) {
    const parsed = new Date(`${normalized}T12:00:00+08:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function hasExplicitTime(value) {
  return /T\d{2}:\d{2}|\b\d{1,2}:\d{2}(?::\d{2})?\b|Z$|[+-]\d{2}:?\d{2}$/.test(value || "");
}

function effectiveArticleDate(article) {
  const published = safeDate(article.publishedAt);
  const updated = safeDate(article.updatedAt);
  if (published && updated) return published >= updated ? article.publishedAt : article.updatedAt;
  if (updated) return article.updatedAt || "";
  if (published) return article.publishedAt || "";
  return "";
}

function shanghaiDayStamp(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function twentyFourHoursAgo(referenceDate) {
  return new Date(referenceDate.getTime() - 24 * 60 * 60 * 1000);
}

function sevenDaysAgo(referenceDate) {
  return new Date(referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function isRecent(article, generatedAt) {
  const dateText = effectiveArticleDate(article);
  const date = safeDate(dateText);
  if (!date) return false;

  if (hasExplicitTime(dateText)) {
    return date >= twentyFourHoursAgo(generatedAt);
  }

  const today = shanghaiDayStamp(generatedAt);
  const yesterday = shanghaiDayStamp(twentyFourHoursAgo(generatedAt));
  const articleDay = shanghaiDayStamp(date);
  return articleDay === today || articleDay === yesterday;
}

function reportKey(article) {
  return crypto.createHash("sha1").update(`${article.url}|${effectiveArticleDate(article)}`).digest("hex");
}

function getReportedKeys(state, sourceName, generatedAt) {
  const entries = Array.isArray(state.reported[sourceName]) ? state.reported[sourceName] : [];
  const cutoff = sevenDaysAgo(generatedAt);
  const kept = entries.filter((entry) => {
    const date = new Date(entry.reportedAt || "");
    return !Number.isNaN(date.getTime()) && date >= cutoff;
  });
  state.reported[sourceName] = kept;
  return new Set(kept.map((entry) => entry.key));
}

function appendReported(state, sourceName, articles, generatedAt) {
  const existing = Array.isArray(state.reported[sourceName]) ? state.reported[sourceName] : [];
  const merged = new Map(existing.map((entry) => [entry.key, entry]));
  for (const article of articles) {
    const key = reportKey(article);
    merged.set(key, {
      key,
      url: article.url,
      date: effectiveArticleDate(article),
      reportedAt: generatedAt.toISOString()
    });
  }
  state.reported[sourceName] = [...merged.values()];
}

function compareArticlesDesc(a, b) {
  const left = safeDate(effectiveArticleDate(a))?.getTime() || 0;
  const right = safeDate(effectiveArticleDate(b))?.getTime() || 0;
  return right - left;
}

function compareCandidatesDesc(a, b) {
  const left = safeDate(a.listDate || "")?.getTime() || 0;
  const right = safeDate(b.listDate || "")?.getTime() || 0;
  return right - left;
}

function buildDefaultSitemapUrls(source) {
  const origin = new URL(source.home).origin;
  return DEFAULT_SITEMAP_PATHS.map((item) => new URL(item, origin).toString());
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.text();
}

async function discoverSitemapUrls(source) {
  const discovered = new Set(buildDefaultSitemapUrls(source).filter((url) => !url.endsWith("/robots.txt")));
  const robotsUrl = new URL("/robots.txt", source.home).toString();

  try {
    const robotsText = await fetchText(robotsUrl);
    for (const line of robotsText.split(/\r?\n/)) {
      const match = line.match(/^Sitemap:\s*(\S+)/i);
      if (match?.[1]) {
        discovered.add(match[1].trim());
      }
    }
  } catch {
    // Ignore missing or blocked robots.txt
  }

  return [...discovered];
}

function parseUrlSetEntries(xmlText) {
  const entries = [];
  const urlMatches = xmlText.matchAll(/<url\b[\s\S]*?<\/url>/gi);
  for (const match of urlMatches) {
    const block = match[0];
    const loc = decodeHtml(extractFirst(block, [/<loc>([\s\S]*?)<\/loc>/i]));
    if (!loc) continue;
    const lastmod = decodeHtml(extractFirst(block, [/<lastmod>([\s\S]*?)<\/lastmod>/i]));
    entries.push({ url: normalizeUrl(loc), lastmod: lastmod || "" });
  }
  return entries;
}

function parseNestedSitemapUrls(xmlText) {
  const urls = [];
  const matches = xmlText.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi);
  for (const match of matches) {
    const loc = decodeHtml(extractFirst(match[0], [/<loc>([\s\S]*?)<\/loc>/i]));
    if (loc) urls.push(normalizeUrl(loc));
  }
  return urls;
}

async function fetchSitemapCandidates(source) {
  const queue = (await discoverSitemapUrls(source)).map((url) => ({ url, depth: 0 }));
  const seenSitemaps = new Set();
  const collected = new Map();

  while (queue.length > 0 && seenSitemaps.size < 20 && collected.size < source.maxCandidates * 6) {
    const current = queue.shift();
    if (!current || seenSitemaps.has(current.url)) continue;
    seenSitemaps.add(current.url);

    try {
      const xmlText = await fetchText(current.url);
      const nested = parseNestedSitemapUrls(xmlText);
      if (current.depth < 1) {
        for (const child of nested) {
          if (!seenSitemaps.has(child)) {
            queue.push({ url: child, depth: current.depth + 1 });
          }
        }
      }

      for (const entry of parseUrlSetEntries(xmlText)) {
        if (!isCandidateUrl(entry.url, source)) continue;
        if (!collected.has(entry.url)) {
          collected.set(entry.url, {
            url: entry.url,
            anchorText: "",
            contextText: "",
            listDate: entry.lastmod || ""
          });
        }
      }
    } catch {
      // Ignore individual sitemap failures
    }
  }

  return [...collected.values()].sort(compareCandidatesDesc).slice(0, source.maxCandidates * 2);
}

function mergeCandidates(primary, secondary, limit) {
  const merged = new Map();
  for (const candidate of [...primary, ...secondary]) {
    const key = normalizeUrl(candidate.url);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      continue;
    }
    merged.set(key, {
      ...existing,
      anchorText: existing.anchorText || candidate.anchorText || "",
      contextText: existing.contextText || candidate.contextText || "",
      listDate: existing.listDate || candidate.listDate || ""
    });
  }
  return [...merged.values()].sort(compareCandidatesDesc).slice(0, limit);
}

async function extractCandidateLinks(page, source) {
  const links = await page.locator("a[href]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rawText = (node.textContent || "").replace(/\s+/g, " ").trim();
      const container =
        node.closest("article, main article, li, .post, .blog-card, .blog-item, section, div") ||
        node.parentElement ||
        node;
      const contextText = ((container && container.textContent) || rawText).replace(/\s+/g, " ").trim().slice(0, 600);
      return {
        href: node.href || "",
        text: rawText,
        contextText
      };
    })
  );

  const deduped = new Map();
  for (const link of links) {
    const normalized = normalizeUrl(link.href);
    if (!normalized || !isCandidateUrl(normalized, source)) continue;
    if (!deduped.has(normalized)) {
      deduped.set(normalized, {
        url: normalized,
        anchorText: link.text,
        contextText: link.contextText,
        listDate: extractVisibleDate(link.contextText)
      });
    }
  }

  return [...deduped.values()].sort(compareCandidatesDesc).slice(0, source.maxCandidates);
}

async function scrapeArticle(context, candidate) {
  const page = await context.newPage();
  try {
    await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    const bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const dates = extractArticleDates(html, bodyText, candidate.listDate || "", candidate.contextText || "");
    return {
      url: candidate.url,
      title: extractTitle(html, bodyText, candidate.anchorText || candidate.url),
      anchorText: candidate.anchorText || "",
      publishedAt: dates.publishedAt || "",
      updatedAt: dates.updatedAt || ""
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeArticleWithFallback(context, candidate) {
  try {
    return await scrapeArticle(context, candidate);
  } catch {
    return {
      url: candidate.url,
      title: candidate.anchorText || candidate.url,
      anchorText: candidate.anchorText || "",
      publishedAt: candidate.listDate || "",
      updatedAt: candidate.listDate || ""
    };
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

async function scrapeSource(browser, source) {
  const context = await browser.newContext({
    locale: "en-US",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
  });

  try {
    const page = await context.newPage();
    await page.goto(source.home, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    const pageCandidates = await extractCandidateLinks(page, source);
    const sitemapCandidates = await fetchSitemapCandidates(source);
    const candidates = mergeCandidates(pageCandidates, sitemapCandidates, source.maxCandidates);

    console.log(`[进度] ${source.name} 页面候选 ${pageCandidates.length}，站点地图候选 ${sitemapCandidates.length}，合并后 ${candidates.length}`);

    if (candidates.length === 0) {
      throw new Error("未获取到可用文章链接");
    }

    const articles = await mapWithConcurrency(candidates, 3, async (candidate) => scrapeArticleWithFallback(context, candidate));
    const dedupedArticles = new Map();
    for (const article of articles) {
      if (!dedupedArticles.has(article.url)) {
        dedupedArticles.set(article.url, article);
      }
    }
    return [...dedupedArticles.values()].sort(compareArticlesDesc);
  } finally {
    await context.close().catch(() => {});
  }
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

  const lines = ["竞品博客监测日报", `生成时间：${dateStr}（上海）`, ""];
  for (const source of items) {
    lines.push(`${source.name}：${source.articles.length} 篇`);
    if (source.error) {
      lines.push(`抓取异常：${source.error}`);
      lines.push("");
      continue;
    }
    if (source.articles.length === 0) {
      lines.push("今日未发现新文章");
      lines.push("");
      continue;
    }
    for (const article of source.articles) {
      lines.push(`- ${article.title} | ${effectiveArticleDate(article)}`);
      lines.push(article.url);
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

  const lines = ["# 竞品博客监测日报", "", `生成时间：${dateStr}（上海）`, ""];
  const total = items.reduce((sum, item) => sum + item.articles.length, 0);
  lines.push(`新增文章总数：${total}`, "");

  for (const source of items) {
    lines.push(`## ${source.name}（${source.articles.length}）`);
    if (source.error) {
      lines.push(`- 抓取异常：${source.error}`, "");
      continue;
    }
    if (source.articles.length === 0) {
      lines.push("- 今日未发现新文章", "");
      continue;
    }
    for (const article of source.articles) {
      lines.push(`- [${article.title}](${article.url}) | ${effectiveArticleDate(article)}`);
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
        const scraped = await scrapeSource(browser, source);
        const reportedKeys = getReportedKeys(state, source.name, generatedAt);
        const fresh = scraped.filter((article) => isRecent(article, generatedAt));
        const finalFresh = fresh.filter((article) => !reportedKeys.has(reportKey(article)));
        reportItems.push({ name: source.name, articles: finalFresh, error: "" });
        console.log(`[完成] ${source.name} 新增 ${finalFresh.length} 篇`);
      } catch (error) {
        reportItems.push({
          name: source.name,
          articles: [],
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

  const sendResult = await sendToDingTalk(dingTalkText, env).catch((error) => ({
    skipped: false,
    error: error instanceof Error ? error.message : String(error)
  }));

  if (!sendResult.skipped && !sendResult.error) {
    for (const source of reportItems) {
      appendReported(state, source.name, source.articles, generatedAt);
    }
  }

  await saveState(state);

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
