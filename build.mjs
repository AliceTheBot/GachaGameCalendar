// 每周构建：抓官方动态 → 合并人工数据 → 生成 index.html
// 用法：node build.mjs [--no-discover]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const ASSETS = path.join(ROOT, 'assets');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const TZ = 8 * 3600e3;
const NOW = Date.now();
const DISCOVER = !process.argv.includes('--no-discover');

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

const games = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'games.json'), 'utf8'));
const curated = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'curated.json'), 'utf8'));

// ---------- 抓取 ----------
async function fetchPage(mid, offset) {
  const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space?host_mid=${mid}&offset=${encodeURIComponent(offset)}&timezone_offset=-480`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: `https://space.bilibili.com/${mid}/dynamic` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.code !== 0) throw new Error('code ' + j.code);
      return j.data || {};
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function loadPosts(game) {
  const cacheFile = path.join(CACHE_DIR, game.id + '.json');
  const items = [];
  try {
    let offset = '';
    for (let p = 0; p < 3; p++) {
      const d = await fetchPage(game.mid, offset);
      (d.items || []).forEach(it => items.push({
        opus: String(it.opus_id || ''),
        text: (it.content || '').replace(/\u00a0/g, ' ').trim(),
        cover: it.cover?.url || '',
      }));
      if (!d.has_more || !d.offset) break;
      offset = d.offset;
      await new Promise(r => setTimeout(r, 600));
    }
    if (!items.length) throw new Error('empty feed');
    fs.writeFileSync(cacheFile, JSON.stringify({ at: new Date().toISOString(), items }, null, 1));
    console.log(`  ${game.name}: ${items.length} 条动态`);
    return items;
  } catch (e) {
    console.warn(`  ${game.name}: 抓取失败（${e.message}），用上次缓存`);
    if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8')).items;
    return [];
  }
}

// ---------- 解析 ----------
const DATE = /(\d{4})\s*[年\/.]\s*(\d{1,2})\s*[月\/.]\s*(\d{1,2})\s*日?\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;
const NOYEAR = /(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;

function datesIn(text) {
  const out = [];
  for (const m of text.matchAll(DATE)) {
    out.push({ i: m.index, iso: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]) });
  }
  if (!out.length) {
    for (const m of text.matchAll(NOYEAR)) {
      out.push({ i: m.index, iso: Date.UTC(2026, +m[1] - 1, +m[2], +m[3] - 8, +m[4]) });
    }
  }
  return out;
}

const RANGE = /[~～\-–—至到]/;
function parseWindow(text) {
  const ds = datesIn(text);
  for (let k = 0; k + 1 < ds.length; k++) {
    const a = ds[k], b = ds[k + 1];
    const gap = text.slice(a.i, b.i);
    if (b.i - a.i > 90 || !RANGE.test(gap)) continue;
    let s = a.iso, e = b.iso;
    if (e < s && e + 330 * 864e5 > s) e += 365 * 864e5; // 跨年
    if (e <= s || e - s > 60 * 864e5) continue;
    return { s, e };
  }
  return null;
}

const BAD = /(卡池|唤取|跃迁|寻访|礼包|商城|创作者|激励计划|直播|前瞻|音乐会|周边|兑换码|抽奖|壁纸|表情包|漫画|原声|OST|上架|预约|下载|云游戏|版本更新|更新说明|内容说明|版本说明|维护|预下载|时装|皮肤|通行证|战令|概率提升|赛季)/;
const OKCTX = /(活动时间|活动期间)/;

function pickTitle(text) {
  let m = text.match(/「([^」]{2,26})」/);
  if (m) return m[1].trim();
  m = text.match(/【([^】]{2,26})】/);
  if (m) return m[1].trim();
  const line = text.split(/[\n。！!]/)[0].replace(/^#\S+#\s*/, '').trim();
  return line.slice(0, 26);
}

const norm = s => s.replace(/[\s「」【】·・、，,。!！?？:：'"“”‘’\-–—()（）]/g, '').toLowerCase();

function discover(items, game, existing) {
  const added = [];
  // 同一句话在多条动态里反复出现 → 版本口号/栏目名，不是活动标题
  const textAll = items.map(it => it.text || '');
  for (const it of items) {
    if (!it.cover) continue;
    const text = it.text.replace(/\n/g, ' ');
    if (!OKCTX.test(text)) continue;
    if (text.length > 1500) continue;
    if (/(跃迁|唤取|寻访|概率提升|版本说明|内容说明|更新说明)/.test(text.slice(0, 150))) continue;
    const w = parseWindow(text);
    if (!w) continue;
    const dur = w.e - w.s;
    if (dur < 3600e3 || dur > 21 * 864e5) continue;
    if (w.e < NOW - 3 * 864e5 || w.s > NOW + 21 * 864e5) continue;
    const title = pickTitle(text);
    if (!title || title.length < 3 || BAD.test(title) || BAD.test(text.slice(0, 60))) continue;
    // 标题必须出现在活动时间之前（活动正文的写法），否则多半是从正文里捞到的任务名/口号
    const titleAt = text.indexOf(title);
    if (titleAt < 0 || titleAt > (text.search(OKCTX))) continue;
    if (titleAt > 0 && /任务|章节|幕|委托/.test(text.slice(Math.max(0, titleAt - 18), titleAt))) continue;
    // 跨动态频次：出现在 3 条以上 = 模板口号
    const freq = textAll.filter(t => t.includes(title)).length;
    if (freq >= 3) continue;
    const n = norm(title);
    if (existing.some(e => norm(e.title) === n || norm(e.title).includes(n) || n.includes(norm(e.title)))) continue;
    if (added.some(e => norm(e.title) === n)) continue;
    added.push({ game: game.id, title, s: new Date(w.s).toISOString(), e: new Date(w.e).toISOString(), desc: '由官方动态自动收录，可补充说明。', cover: it.cover, opus: it.opus, auto: true });
  }
  return added;
}

async function saveCover(ev) {
  const hash = crypto.createHash('sha1').update(ev.opus + ev.title).digest('hex').slice(0, 8);
  const file = `auto-${ev.game}-${hash}.webp`;
  const dest = path.join(ASSETS, file);
  if (fs.existsSync(dest)) return 'assets/' + file;
  try {
    const r = await fetch(ev.cover, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const out = await sharp(buf).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    fs.writeFileSync(dest, out);
    return 'assets/' + file;
  } catch (e) {
    console.warn('  封面下载失败', ev.title, e.message);
    return '';
  }
}

// ---------- 归类 ----------
const LONG_MS = 21 * 864e5;
function fmt(ms) {
  const d = new Date(ms + TZ);
  return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const iso = ms => new Date(ms).toISOString();

function buildGame(g, allEvents) {
  const mine = allEvents.filter(e => e.game === g.id);
  const short = [];
  const folded = [];
  const ended = [];
  for (const e of mine) {
    const s = +new Date(e.s), en = +new Date(e.e);
    const dur = en - s;
    if (dur > LONG_MS || e.st) {
      if (en > NOW - 7 * 864e5) folded.push(e);
    } else if (en < NOW) {
      if (en > NOW - 21 * 864e5) ended.push(e);
    } else {
      short.push(e);
    }
  }
  short.sort((a, b) => +new Date(a.e) - +new Date(b.e));
  folded.sort((a, b) => +new Date(a.e) - +new Date(b.e));
  ended.sort((a, b) => +new Date(b.e) - +new Date(a.e));
  const toCard = e => ({ t: e.title, img: e.img || '', s: e.s, e: e.e, d: e.desc || '', fit: e.fit, pos: e.pos, st: e.st });
  // “其他即将开始”只保留还没进主列表的条目；24 小时内开始且有 iso 的，直接提进主列表
  const norm = s => String(s).replace(/[\s·「」《》!！:：,，\-—~～]/g, '').toLowerCase();
  const taken = [...short, ...folded, ...ended].map(e => norm(e.title));
  const rawNotes = curated.notes.filter(n => n.game === g.id);
  const notes = [];
  for (const n of rawNotes) {
    if (taken.some(t => t.includes(norm(n.t)) || norm(n.t).includes(t))) continue;
    const start = n.iso ? +new Date(n.iso) : NaN;
    if (!Number.isNaN(start) && start - NOW < 24 * 3600e3 && start > NOW - 864e5) {
      short.push({ title: n.t, s: n.iso, e: iso(start + 14 * 864e5), desc: n.s || n.d, img: n.img || '' });
      continue;
    }
    notes.push({ t: n.t, d: n.d, s: n.s });
  }
  short.sort((a, b) => +new Date(a.e) - +new Date(b.e));
  return {
    id: g.id, name: g.name, version: g.version, accent: g.accent,
    logo: `assets/logo-${g.id}.webp`,
    events: short.map(toCard),
    soon: notes,
    folded: folded.map(e => ({ n: e.title, time: `${fmt(+new Date(e.s))} – ${fmt(+new Date(e.e))}`, why: e.why || '持续整版本', img: e.img || '' })),
    ended: ended.map(e => ({ n: e.title, time: `${fmt(+new Date(e.s))} – ${fmt(+new Date(e.e))}`, img: e.img || '' })),
  };
}

// ---------- 主流程 ----------
console.log('抓取官方动态…');
const allEvents = curated.events.slice();
if (DISCOVER) {
  for (const g of games) {
    const items = await loadPosts(g);
    const extra = discover(items, g, allEvents);
    for (const ev of extra) {
      ev.img = await saveCover(ev);
      if (!ev.img) continue;
      ev.s = iso(+new Date(ev.s));
      ev.e = iso(+new Date(ev.e));
      allEvents.push(ev);
      console.log(`  + 新活动 ${g.name}：${ev.title}（${fmt(+new Date(ev.s))} – ${fmt(+new Date(ev.e))}）`);
    }
  }
}

const data = games.map(g => buildGame(g, allEvents));
const dateStr = (() => {
  const d = new Date(NOW + TZ);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
})();

const tpl = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
const html = tpl
  .replaceAll('__DATE__', dateStr)
  .replace('__DATA__', JSON.stringify(data));

fs.writeFileSync(path.join(ROOT, 'index.html'), html);

// Cloudflare / 静态托管的发布目录：只含页面和它用到的图
const PUB = path.join(ROOT, 'public');
fs.rmSync(PUB, { recursive: true, force: true });
fs.mkdirSync(path.join(PUB, 'assets'), { recursive: true });
fs.writeFileSync(path.join(PUB, 'index.html'), html);
const used = new Set([...html.matchAll(/assets\/[\w.-]+\.(?:webp|png)/g)].map(m => m[0]));
used.add('assets/favicon.png');
for (const g of data) used.add(`assets/logo-${g.id}.webp`);
for (const rel of used) {
  const src = path.join(ROOT, rel);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PUB, rel));
}
console.log(`发布目录：public/（${used.size} 张图）`);

// 单文件版：图片内嵌 base64，方便直接发给别人/本地打开
const cache = new Map();
const toDataURI = rel => {
  if (cache.has(rel)) return cache.get(rel);
  const p = path.join(ROOT, rel);
  let out = rel;
  if (fs.existsSync(p)) {
    const ext = path.extname(p).slice(1).replace('jpg', 'jpeg');
    out = `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`;
  }
  cache.set(rel, out);
  return out;
};
const standalone = html.replace(/assets\/[\w.-]+\.(?:webp|png)/g, toDataURI);
fs.writeFileSync(path.join(ROOT, 'standalone.html'), standalone);

fs.writeFileSync(path.join(DATA_DIR, 'last-build.json'), JSON.stringify({ at: new Date().toISOString(), data }, null, 1));
console.log(`完成：${dateStr}，${data.reduce((a, g) => a + g.events.length, 0)} 个进行中/即将开始，${data.reduce((a, g) => a + g.folded.length, 0)} 个整版本，${data.reduce((a, g) => a + g.ended.length, 0)} 个已结束`);
