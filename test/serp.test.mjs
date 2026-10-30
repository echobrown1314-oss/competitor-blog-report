import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dateInZone, previousDay, normalizeUrl, queryId, collectQuery, compareQuery,
  buildReports, csvCell, runMonitor } from '../monitor-serp.mjs';

const base = JSON.parse(await readFile(new URL('../serp-config.json', import.meta.url), 'utf8'));
const keyword = base.keywords[0];
const fixedNow = () => new Date('2026-10-30T01:17:00Z');
const apiKey = 'test-secret-never-a-live-key';

function items(n = 10, first = 1) {
  return Array.from({ length: n }, (_, i) => ({ position: i + 1,
    title: `Example ${first + i}`, link: `https://site${first + i}.example/page` }));
}
function response(url, organic = items(), extra = {}) {
  return { ok: true, status: 200, json: async () => ({
    search_metadata: { status: 'Success', id: 'fixture-search', created_at: '2026-10-30 01:17:00 UTC' },
    search_parameters: Object.fromEntries(new URL(url).searchParams), organic_results: organic, ...extra,
  }) };
}
async function collected(organic = items(), extra = {}) {
  return collectQuery(base, keyword, 'desktop', {
    apiKey, now: fixedNow, fetchImpl: async url => response(url, organic, extra),
  });
}
async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'serp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('Beijing date boundaries and month/year transitions', () => {
  assert.equal(dateInZone(new Date('2026-10-30T16:01:00Z'), base.timezone), '2026-10-31');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2028-03-01'), '2028-02-29');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
});

test('URL normalization removes tracking while preserving page identity', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com/a?x=2&utm_source=a#part'), 'https://example.com/a?x=2');
  assert.notEqual(normalizeUrl('https://example.com/a'), normalizeUrl('https://example.com/a/'));
  assert.notEqual(normalizeUrl('https://example.com/a?v=1'), normalizeUrl('https://example.com/a?v=2'));
  assert.throws(() => normalizeUrl('javascript:alert(1)'));
  assert.throws(() => normalizeUrl('https://user:password@example.com'));
});

test('requests fix country, language and device without using obsolete num parameter', async () => {
  const current = await collectQuery(base, keyword, 'mobile', { apiKey, now: fixedNow,
    fetchImpl: async url => {
      assert.equal(url.hostname, 'serpapi.com');
      for (const [key, value] of Object.entries({ engine: 'google', q: keyword, gl: 'us', hl: 'en',
        device: 'mobile', location: 'United States', start: '0', no_cache: 'false' })) {
        assert.equal(url.searchParams.get(key), value);
      }
      assert.equal(url.searchParams.has('num'), false);
      return response(url);
    } });
  assert.equal(current.status, 'ok');
  assert.equal(current.results.length, 10);
  assert.ok(!JSON.stringify(current).includes(apiKey));
});

test('pagination follows only offset and deduplicates overlapping results', async () => {
  const seen = [];
  const current = await collectQuery(base, keyword, 'desktop', { apiKey, now: fixedNow,
    fetchImpl: async url => {
      seen.push(url.href);
      return seen.length === 1 ? response(url, items(7), {
        serpapi_pagination: { next: 'https://untrusted.example/?start=10&api_key=stolen&q=wrong' },
      }) : response(url, items(5, 7));
    } });
  assert.equal(current.status, 'ok');
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[1]).hostname, 'serpapi.com');
  assert.equal(new URL(seen[1]).searchParams.get('q'), keyword);
  assert.equal(current.results[7].url, 'https://site8.example/page');
  assert.equal(current.results[9].rank, 10);
});

test('insufficient organic results are incomplete, not a valid top ten', async () => {
  const current = await collected(items(6));
  assert.equal(current.status, 'incomplete');
  assert.equal(current.results.length, 6);
  const diff = compareQuery(current, await collected());
  assert.equal(diff.comparable, false);
  assert.deepEqual(diff.exited, []);
});

test('empty results and malformed positions are errors', async () => {
  assert.equal((await collected([])).status, 'error');
  const organic = items();
  delete organic[0].position;
  assert.equal((await collected(organic)).status, 'error');
});

test('quota errors, invalid JSON, timeouts and missing keys never become no-change reports', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
    async () => { throw new Error(`network request api_key=${apiKey}`); },
  ]) {
    const result = await collectQuery(base, keyword, 'desktop', { apiKey, now: fixedNow, fetchImpl });
    assert.equal(result.status, 'error');
    assert.ok(!JSON.stringify(result).includes(apiKey));
  }
  const noKey = await collectQuery(base, keyword, 'desktop', {
    now: fixedNow, fetchImpl: async () => assert.fail('must not request without key'),
  });
  assert.equal(noKey.requests, 0);
  assert.match(noKey.error, /SERPAPI_API_KEY/);
});

test('provider error text redacts secrets', async () => {
  const current = await collected(items(), { error: `Bad key: ${apiKey} https://serpapi.com/?api_key=${apiKey}` });
  assert.equal(current.status, 'error');
  assert.ok(!JSON.stringify(current).includes(apiKey));
});

test('rejects mismatched devices, corrected keywords and stale dates', async () => {
  const mismatch = await collected(items(), { search_parameters: { q: keyword, device: 'mobile' } });
  assert.equal(mismatch.status, 'error');
  const corrected = await collected(items(), { search_information: { showing_results_for: 'different query' } });
  assert.equal(corrected.status, 'error');
  const stale = await collected(items(), { search_metadata: { status: 'Success', created_at: '2026-10-29T01:00:00Z' } });
  assert.equal(stale.status, 'error');
});

test('compares ranks, entries, exits, title edits and one-to-one same-domain replacements', async () => {
  const previous = await collected();
  const organic = items();
  [organic[0], organic[1]] = [organic[1], organic[0]];
  organic.forEach((r, i) => r.position = i + 1);
  organic[0].title = 'Updated title';
  organic[9].link = 'https://site10.example/new-page';
  const current = await collected(organic);
  const diff = compareQuery(current, previous);
  assert.equal(diff.comparable, true);
  assert.equal(diff.rows[0].delta, 1);
  assert.equal(diff.rows[0].title_changed, true);
  assert.equal(diff.rows[1].delta, -1);
  assert.equal(diff.rows[9].change, '新进入前十');
  assert.equal(diff.exited[0].rank, 10);
  assert.equal(diff.replacements[0].domain, 'site10.example');
});

test('missing or failed yesterday does not label everything as a new entry', async () => {
  const current = await collected();
  for (const previous of [undefined, { ...current, status: 'error' }]) {
    const diff = compareQuery(current, previous);
    assert.equal(diff.comparable, false);
    assert.ok(diff.rows.every(r => r.change === '不可对比'));
    assert.deepEqual(diff.exited, []);
  }
});

test('changed location or device cannot reuse old comparison scope', async () => {
  const current = await collected();
  assert.notEqual(queryId(base, keyword, 'mobile'), current.id);
  assert.notEqual(queryId({ ...base, location: 'New York,New York,United States' }, keyword, 'desktop'), current.id);
  assert.equal(compareQuery({ ...current, id: 'new-scope' }, current).comparable, false);
});

test('CSV cells cannot run spreadsheet formulas', () => {
  for (const input of ['=1+1', '+cmd', '-cmd', '@SUM(A1)', ' =1', '\tformula']) {
    assert.ok(csvCell(input).startsWith('"\''));
  }
  assert.equal(csvCell('quoted "text"'), '"quoted ""text"""');
});

test('first run builds all six groups and rerun consumes no more requests', async t => {
  const dataDir = await tempDir(t);
  let calls = 0;
  const fetchImpl = async url => { calls++; return response(url); };
  const first = await runMonitor({ config: base, dataDir, apiKey, now: fixedNow, fetchImpl });
  assert.equal(first.requests, 6);
  assert.equal(first.failed, 0);
  const second = await runMonitor({ config: base, dataDir, apiKey, now: fixedNow, fetchImpl });
  assert.equal(second.requests, 0);
  assert.equal(second.reused, 6);
  assert.equal(calls, 6);
  const report = await readFile(path.join(dataDir, 'latest.md'), 'utf8');
  assert.match(report, /建立基线/);
  assert.match(report, /未进入前十（范围外名次未知）/);
  const csv = await readFile(path.join(dataDir, 'latest.csv'), 'utf8');
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 61);
});

test('partial failure is persisted; rerun retries only the failed group', async t => {
  const dataDir = await tempDir(t);
  const failId = queryId(base, keyword, 'mobile');
  const first = await runMonitor({ config: base, dataDir, apiKey, now: fixedNow, fetchImpl: async url =>
    url.searchParams.get('q') === keyword && url.searchParams.get('device') === 'mobile' ?
      { ok: false, status: 429 } : response(url) });
  assert.equal(first.failed, 1);
  const json = JSON.parse(await readFile(path.join(dataDir, 'snapshots', '2026-10-30.json'), 'utf8'));
  assert.equal(json.queries[failId].status, 'error');
  assert.match(await readFile(path.join(dataDir, 'latest.md'), 'utf8'), /采集不完整/);
  const retry = await runMonitor({ config: base, dataDir, apiKey, now: fixedNow, fetchImpl: async url => response(url) });
  assert.equal(retry.reused, 5);
  assert.equal(retry.requests, 1);
  assert.equal(retry.failed, 0);
});

test('compares against yesterday only, not an older successful snapshot', async t => {
  const dataDir = await tempDir(t);
  await runMonitor({ config: base, dataDir, apiKey, now: fixedNow, fetchImpl: async url => response(url) });
  const later = () => new Date('2026-11-01T01:17:00Z');
  await runMonitor({ config: base, dataDir, apiKey, now: later, fetchImpl: async url => response(url, items(), {
    search_metadata: { status: 'Success', created_at: later().toISOString() },
  }) });
  assert.match(await readFile(path.join(dataDir, 'latest.md'), 'utf8'), /没有昨天的快照/);
});

test('next day reports real movements while desktop and mobile stay separate', async t => {
  const dataDir = await tempDir(t);
  await runMonitor({ config: base, dataDir, apiKey, now: fixedNow, fetchImpl: async url => response(url) });
  const nextDay = () => new Date('2026-10-31T01:17:00Z');
  await runMonitor({ config: base, dataDir, apiKey, now: nextDay, fetchImpl: async url => response(url,
    url.searchParams.get('device') === 'mobile' ? items(10, 2) : items(),
    { search_metadata: { status: 'Success', created_at: nextDay().toISOString() } }) });
  const report = await readFile(path.join(dataDir, 'latest.md'), 'utf8');
  assert.match(report, /可与昨天对比：6\/6/);
  assert.equal((report.match(/新进入 1 条/g) || []).length, 3);
  assert.equal((report.match(/新进入 0 条/g) || []).length, 3);
});

test('damaged historical state is not overwritten', async t => {
  const dataDir = await tempDir(t);
  await mkdir(path.join(dataDir, 'snapshots'), { recursive: true });
  const file = path.join(dataDir, 'snapshots', '2026-10-30.json');
  await writeFile(file, '{broken');
  await assert.rejects(runMonitor({ config: base, dataDir, apiKey, now: fixedNow }), /避免覆盖历史数据/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('report flags tracked domain and handles title formatting safely', async () => {
  const config = { ...base, keywords: [keyword], devices: ['desktop'] };
  const organic = items();
  organic[0].link = 'https://www.aireel.net/';
  organic[0].title = 'AI | Video <script> [test]';
  const current = await collected(organic);
  const snapshot = { date: '2026-10-30', updated_at: fixedNow().toISOString(), queries: { [current.id]: current } };
  const report = buildReports(config, snapshot, null);
  assert.match(report.markdown, /aireel.net：第 1 位/);
  assert.match(report.markdown, /&#124;/);
  assert.ok(!report.markdown.includes('<script>'));
});
