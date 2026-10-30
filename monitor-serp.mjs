import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = 1;
const DEVICE_NAMES = { desktop: '桌面端', mobile: '移动端' };

export function dateInZone(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function previousDay(day) {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

export function normalizeUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('结果包含无效 URL');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function domainOf(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function profile(config) {
  return {
    engine: 'google', google_domain: config.google_domain, gl: config.gl, hl: config.hl,
    location: config.location, depth: config.depth, ranking: 'organic-url-sequence-v1',
  };
}

export function queryId(config, keyword, device) {
  return createHash('sha256').update(JSON.stringify([profile(config), keyword, device])).digest('hex');
}

export function validateConfig(config) {
  if (!Array.isArray(config.keywords) || !config.keywords.length ||
      config.keywords.some(k => typeof k !== 'string' || !k.trim()) ||
      new Set(config.keywords).size !== config.keywords.length) throw new Error('关键词配置无效或重复');
  if (!Array.isArray(config.devices) || !config.devices.length ||
      config.devices.some(d => !DEVICE_NAMES[d]) ||
      new Set(config.devices).size !== config.devices.length) throw new Error('设备配置无效或重复');
  if (config.depth !== 10 || !Number.isInteger(config.max_pages) ||
      config.max_pages < 1 || config.max_pages > 3) throw new Error('只支持前十；max_pages 需为 1–3');
  for (const key of ['google_domain', 'gl', 'hl', 'location', 'timezone']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`缺少配置：${key}`);
  }
  if (!Array.isArray(config.tracked_domains) || config.tracked_domains.some(d =>
    typeof d !== 'string' || !/^[a-z0-9.-]+$/i.test(d))) throw new Error('tracked_domains 配置无效');
  dateInZone(new Date(), config.timezone);
}

function redact(value, secret) {
  let text = String(value);
  if (secret) text = text.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
  return text.replace(/([?&]api_key=)[^&\s"<>]+/gi, '$1[REDACTED]');
}

function validateResponse(data, expected) {
  if (!data || data.error || data.search_metadata?.status !== 'Success') {
    throw new Error(data?.error || 'SerpApi 未返回 Success，未生成可用排名');
  }
  const actual = data.search_parameters;
  if (!actual || typeof actual !== 'object') throw new Error('响应缺少搜索参数，无法确认采集口径');
  for (const key of ['engine', 'q', 'gl', 'hl', 'device', 'google_domain']) {
    if (actual[key] !== undefined && actual[key] !== expected[key]) throw new Error(`返回的 ${key} 与请求不符`);
  }
  if (actual.q !== expected.q) throw new Error('返回的关键词与请求不符');
  if (!Array.isArray(data.organic_results) || !data.organic_results.length) {
    throw new Error('未返回自然搜索结果，不能将其解释为排名全部消失');
  }
  const correction = data.search_information;
  if (correction?.showing_results_for && correction.showing_results_for !== expected.q) {
    throw new Error('Google 改写了查询，无法按原关键词比较');
  }
}

function nextOffset(data, current) {
  const next = data.serpapi_pagination?.next || data.serpapi_pagination?.next_link || data.pagination?.next;
  if (!next) return null;
  try {
    // Read only the offset. Never follow a response URL with our API key.
    const offset = Number(new URL(next).searchParams.get('start'));
    return Number.isInteger(offset) && offset > current && offset <= 100 ? offset : null;
  } catch { return null; }
}

export async function collectQuery(config, keyword, device, {
  apiKey, fetchImpl = fetch, now = () => new Date(),
} = {}) {
  const result = {
    id: queryId(config, keyword, device), keyword, device, profile: profile(config),
    captured_at: now().toISOString(), status: 'error', requests: 0, results: [], pages: [],
  };
  const seen = new Set();
  let start = 0;
  try {
    if (!apiKey?.trim()) throw new Error('未配置 GitHub Actions Secret：SERPAPI_API_KEY');
    for (let page = 0; page < config.max_pages; page++) {
      const params = {
        engine: 'google', q: keyword, google_domain: config.google_domain,
        gl: config.gl, hl: config.hl, location: config.location, device,
        start: String(start), no_cache: 'false', output: 'json', api_key: apiKey,
      };
      const endpoint = new URL('https://serpapi.com/search.json');
      endpoint.search = new URLSearchParams(params).toString();
      result.requests++;
      let response;
      try {
        response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(60000), redirect: 'error' });
      } catch {
        throw new Error('SerpApi 网络请求失败或超时；可重跑，仅补采失败的组');
      }
      if (!response.ok) {
        const hint = [401, 403].includes(response.status) ? '，请检查 API Key/账号权限' :
          response.status === 429 ? '，请检查额度或频率限制' : '';
        throw new Error(`SerpApi HTTP ${response.status}${hint}`);
      }
      let data;
      try { data = await response.json(); } catch { throw new Error('SerpApi 响应不是有效 JSON'); }
      validateResponse(data, params);
      const sourceTime = data.search_metadata?.created_at;
      if (sourceTime) {
        const parsed = new Date(sourceTime);
        if (!Number.isNaN(parsed.getTime()) &&
            dateInZone(parsed, config.timezone) !== dateInZone(now(), config.timezone)) {
          throw new Error('返回的数据日期不是今天，拒绝将缓存作为今日排名');
        }
      }
      const organic = [...data.organic_results];
      if (organic.some(r => !Number.isInteger(r.position) || r.position < 1) ||
          new Set(organic.map(r => r.position)).size !== organic.length) {
        throw new Error('自然结果缺少有效且唯一的位置字段');
      }
      organic.sort((a, b) => a.position - b.position);
      result.pages.push({ start, search_id: data.search_metadata.id ?? null,
        source_created_at: sourceTime ?? null, organic_count: organic.length });
      for (const item of organic) {
        if (!item.link || typeof item.title !== 'string') throw new Error('自然结果缺少链接或标题');
        const url = normalizeUrl(item.link);
        if (seen.has(url)) continue;
        seen.add(url);
        result.results.push({ rank: result.results.length + 1, title: item.title,
          url, domain: domainOf(url), source_position: item.position, source_start: start });
        if (result.results.length === config.depth) break;
      }
      if (result.results.length === config.depth) {
        result.status = 'ok';
        break;
      }
      const next = nextOffset(data, start);
      if (next === null) break;
      start = next;
    }
    if (result.status !== 'ok') {
      result.status = 'incomplete';
      result.error = `仅采集到 ${result.results.length}/${config.depth} 条；已达到分页上限或没有下一页，不计算排名变化`;
    }
  } catch (error) {
    result.error = redact(error.message, apiKey).slice(0, 500);
  }
  return JSON.parse(redact(JSON.stringify(result), apiKey));
}

export function compareQuery(current, previous) {
  if (current.status !== 'ok') return { comparable: false, rows: [], exited: [], replacements: [] };
  const comparable = previous?.status === 'ok' && previous.id === current.id;
  const old = new Map(comparable ? previous.results.map(r => [r.url, r]) : []);
  const urls = new Set(current.results.map(r => r.url));
  const rows = current.results.map(item => {
    const before = old.get(item.url);
    return { ...item, previous_rank: before?.rank ?? null,
      delta: before ? before.rank - item.rank : null,
      change: !comparable ? '不可对比' : !before ? '新进入前十' :
        before.rank === item.rank ? '持平' : before.rank > item.rank ? `↑${before.rank - item.rank}` : `↓${item.rank - before.rank}`,
      title_changed: Boolean(before && before.title !== item.title),
      previous_title: before?.title ?? null };
  });
  const exited = comparable ? previous.results.filter(r => !urls.has(r.url)) : [];
  const entered = rows.filter(r => r.change === '新进入前十');
  const replacements = [];
  for (const domain of new Set(entered.map(r => r.domain))) {
    const additions = entered.filter(r => r.domain === domain);
    const removals = exited.filter(r => r.domain === domain);
    if (additions.length === 1 && removals.length === 1) {
      replacements.push({ domain, before: removals[0].url, after: additions[0].url });
    }
  }
  return { comparable, rows, exited, replacements };
}

function md(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]])/g, '\\$1');
}

function link(url) { return `[${md(url)}](<${url.replace(/>/g, '%3E').replace(/</g, '%3C')}>)`; }

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildReports(config, snapshot, yesterday, { requests = 0, reused = 0 } = {}) {
  const groups = config.keywords.flatMap(keyword => config.devices.map(device => {
    const id = queryId(config, keyword, device);
    const current = snapshot.queries[id];
    const previous = yesterday?.queries[id];
    return { current, previous, diff: compareQuery(current, previous) };
  }));
  const success = groups.filter(g => g.current.status === 'ok').length;
  const comparable = groups.filter(g => g.diff.comparable).length;
  const lines = [`# Google SERP 前十日报｜${snapshot.date}`, '',
    `市场：${md(config.gl)} / ${md(config.hl)}；定位：${md(config.location)}；设备：${config.devices.map(d => DEVICE_NAMES[d]).join('、')}分别统计。`,
    `生成时间：${snapshot.updated_at}（UTC）；日报日期按 ${config.timezone} 划分。`,
    `有效采集：${success}/${groups.length} 组；可与昨天对比：${comparable}/${groups.length} 组；本次请求 ${requests} 次；复用今日成功组 ${reused} 组。`, '',
    '口径：依次统计自然结果中的前十个不同 URL；排除广告、AI Overview、视频轮播和子链接。仅移除片段和常见追踪参数，不合并不同页面。',
    '排名是固定搜索环境下的采集快照，不代表所有美国用户看到的结果；前十以外的具体名次未知。', ''];
  if (success !== groups.length) lines.push('**采集不完整：失败/不足十条的组不用于判断新进入、跌出或排名无变化。**', '');
  const csv = [['日期', '关键词', '设备', '今日排名', '昨日排名', '变化', '域名', '标题', 'URL', '标题变化', '昨日标题', '采集时间UTC', '说明']];
  for (const { current, previous, diff } of groups) {
    lines.push(`## ${md(current.keyword)}｜${DEVICE_NAMES[current.device]}`, '');
    if (current.status !== 'ok') {
      lines.push(`**数据缺失或不完整：${md(current.error)}**`, '');
      csv.push([snapshot.date, current.keyword, DEVICE_NAMES[current.device], '', '', '数据缺失', '', '', '', '', '', current.captured_at, current.error]);
      continue;
    }
    if (!diff.comparable) {
      const reason = !yesterday ? '没有昨天的快照，建立基线' : !previous ? '昨天没有相同查询设置的记录' : '昨天采集不完整';
      lines.push(`对比状态：${reason}；今日结果有效，变化不计算。`, '');
    } else {
      const entered = diff.rows.filter(r => r.change === '新进入前十').length;
      const moved = diff.rows.filter(r => r.delta !== null && r.delta !== 0).length;
      const titles = diff.rows.filter(r => r.title_changed).length;
      lines.push(`相对 ${previousDay(snapshot.date)}：新进入 ${entered} 条；跌出 ${diff.exited.length} 条；名次变化 ${moved} 条；标题变化 ${titles} 条。`, '');
    }
    for (const tracked of config.tracked_domains) {
      const matches = current.results.filter(r => r.domain === tracked || r.domain.endsWith(`.${tracked}`));
      lines.push(`**${md(tracked)}：${matches.length ? matches.map(r => `第 ${r.rank} 位`).join('、') : '未进入前十（范围外名次未知）'}。**`, '');
    }
    lines.push('| 今日 | 昨日 | 变化 | 域名 | 标题 | URL |', '|---:|---:|---|---|---|---|');
    for (const r of diff.rows) {
      lines.push(`| ${r.rank} | ${r.previous_rank ?? '—'} | ${r.change}${r.title_changed ? '；标题变化' : ''} | ${md(r.domain)} | ${md(r.title)} | ${link(r.url)} |`);
      csv.push([snapshot.date, current.keyword, DEVICE_NAMES[current.device], r.rank, r.previous_rank, r.change,
        r.domain, r.title, r.url, r.title_changed ? '是' : '', r.previous_title, current.captured_at, diff.comparable ? '' : '无有效昨日基线']);
    }
    lines.push('');
    if (diff.exited.length) {
      lines.push('跌出前十：', '');
      for (const r of diff.exited) {
        lines.push(`- 昨日第 ${r.rank} 位：${link(r.url)}`);
        csv.push([snapshot.date, current.keyword, DEVICE_NAMES[current.device], '>10', r.rank, '跌出前十', r.domain, r.title, r.url, '', r.title, current.captured_at, '当前具体名次未知']);
      }
      lines.push('');
    }
    if (diff.replacements.length) {
      lines.push('同域 URL 更替（同一域名各有一个 URL 进出前十，不代表已确认重定向）：', '');
      for (const r of diff.replacements) lines.push(`- ${md(r.domain)}：${link(r.before)} → ${link(r.after)}`);
      lines.push('');
    }
    const changes = diff.rows.filter(r => r.title_changed);
    if (changes.length) {
      lines.push('搜索结果标题变化：', '');
      for (const r of changes) lines.push(`- 第 ${r.rank} 位：${md(r.previous_title)} → ${md(r.title)}`);
      lines.push('');
    }
  }
  return { markdown: lines.join('\n') + '\n', csv: '\uFEFF' + csv.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
    failed: groups.length - success };
}

async function readSnapshot(file, day) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.schema !== SCHEMA || data.date !== day || !data.queries || Array.isArray(data.queries)) {
      throw new Error('快照格式不兼容或日期不符');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`无法读取已有快照 ${path.basename(file)}；为避免覆盖历史数据已停止`);
  }
}

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, 'utf8');
  await rename(temp, file);
}

export async function runMonitor({ config, dataDir, apiKey, fetchImpl = fetch, now = () => new Date() }) {
  validateConfig(config);
  const day = dateInZone(now(), config.timezone);
  const yesterdayDay = previousDay(day);
  const currentFile = path.join(dataDir, 'snapshots', `${day}.json`);
  const snapshot = await readSnapshot(currentFile, day) ?? { schema: SCHEMA, date: day, queries: {} };
  const yesterday = await readSnapshot(path.join(dataDir, 'snapshots', `${yesterdayDay}.json`), yesterdayDay);
  let requests = 0;
  let reused = 0;
  for (const keyword of config.keywords) {
    for (const device of config.devices) {
      if (dateInZone(now(), config.timezone) !== day) throw new Error('执行跨越北京时间零点，请重跑以避免混用两天数据');
      const id = queryId(config, keyword, device);
      if (snapshot.queries[id]?.status === 'ok') {
        reused++;
        continue;
      }
      const result = await collectQuery(config, keyword, device, { apiKey, fetchImpl, now });
      if (dateInZone(now(), config.timezone) !== day) throw new Error('执行跨越北京时间零点，请重跑以避免混用两天数据');
      snapshot.queries[id] = result;
      requests += result.requests;
      snapshot.updated_at = now().toISOString();
      // Checkpoint each query, retaining successful groups when another query fails.
      await atomicWrite(currentFile, JSON.stringify(snapshot, null, 2) + '\n');
    }
  }
  snapshot.updated_at = now().toISOString();
  const report = buildReports(config, snapshot, yesterday, { requests, reused });
  await atomicWrite(currentFile, JSON.stringify(snapshot, null, 2) + '\n');
  await atomicWrite(path.join(dataDir, 'reports', `${day}.md`), report.markdown);
  await atomicWrite(path.join(dataDir, 'reports', `${day}.csv`), report.csv);
  await atomicWrite(path.join(dataDir, 'latest.md'), report.markdown);
  await atomicWrite(path.join(dataDir, 'latest.csv'), report.csv);
  return { date: day, requests, reused, failed: report.failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(path.join(ROOT, 'serp-config.json'), 'utf8'));
    const result = await runMonitor({ config, dataDir: path.join(ROOT, 'data', 'serp'), apiKey: process.env.SERPAPI_API_KEY });
    console.log(`SERP ${result.date}: requests=${result.requests}, reused=${result.reused}, failed=${result.failed}`);
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    console.error(redact(error.message, process.env.SERPAPI_API_KEY));
    process.exitCode = 1;
  }
}
