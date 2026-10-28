// 给卡池角色抓官方立绘/卡面：优先用 B 站投稿视频封面（角色PV / 角色预告 / 角色展示 / 角色演示 / 战斗演示 / EP），
// 找不到再退回官方动态配图。
// 用法：node scripts/fetch-pool-art.mjs [--force] [--game=genshin]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'assets');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ONLY = (argv.find(a => a.startsWith('--game=')) || '').split('=')[1] || '';

const games = JSON.parse(fs.readFileSync(path.join(DATA, 'games.json'), 'utf8'));
const banners = JSON.parse(fs.readFileSync(path.join(DATA, 'banners.json'), 'utf8'));

const VIDEO_GOOD = /角色PV|角色演示|角色展示|角色预告|战斗演示|干员演示|干员叙事|EP|角色EP|PV/;
const VIDEO_BAD = /攻略|解析|切片|回放|抽奖|二创|搬运|合集|杂谈|反应|reaction/i;
const DYN_GOOD = /角色PV|角色演示|角色展示|角色预告|战斗演示|干员演示|干员档案|代理人档案|角色介绍|立绘|贺图|生日|EP/;
const DYN_BAD = /抽奖|转发|现金|红包|兑换码|预约|壁纸/;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, referer) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer } });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('non-json ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === 3) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function videos(mid, name) {
  const keys = [...new Set([name, name.replace(/[·・\s]/g, ''), name.replace(/[·・].*$/, '')])].filter(Boolean);
  const seen = new Map();
  for (const kw of keys) {
    const url = `https://api.bilibili.com/x/series/recArchivesByKeywords?mid=${mid}&keywords=${encodeURIComponent(kw)}&ps=20`;
    let j;
    try { j = await getJSON(url, `https://space.bilibili.com/${mid}/video`); } catch { continue; }
    for (const a of (j.data && j.data.archives) || []) {
      if (!a.pic) continue;
      seen.set(String(a.aid || a.bvid), { title: a.title || '', pic: a.pic, pub: a.pubdate || 0 });
    }
    await sleep(900);
  }
  return [...seen.values()];
}

const norm = s => String(s).replace(/[·・•∙\.\s]/g, '');

function pickVideo(list, name) {
  const n = norm(name);
  const cand = list.filter(v => norm(v.title).includes(n) && !VIDEO_BAD.test(v.title));
  const score = t =>
    (/角色PV/.test(t) ? 6 : 0) +
    (/角色演示|角色展示|角色预告/.test(t) ? 5 : 0) +
    (/战斗演示|干员演示/.test(t) ? 4 : 0) +
    (/EP/.test(t) ? 3 : 0) +
    (/干员叙事/.test(t) ? 2 : 0);
  return cand.map(v => ({ v, s: score(v.title) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || b.v.pub - a.v.pub)[0]?.v || null;
}

async function feed(mid, pages = 6) {
  const out = [];
  let offset = '';
  for (let i = 0; i < pages; i++) {
    const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space?host_mid=${mid}&offset=${encodeURIComponent(offset)}`;
    let j;
    try { j = await getJSON(url, `https://space.bilibili.com/${mid}/dynamic`); } catch { break; }
    const d = j.data || {};
    for (const it of d.items || []) out.push({ text: (it.content || '').replace(/\u00a0/g, ' '), cover: it.cover?.url || '' });
    if (!d.has_more || !d.offset) break;
    offset = d.offset;
    await sleep(600);
  }
  return out;
}

function pickDyn(list, name, used) {
  const cand = list.filter(p => p.cover && p.text.includes(name) && !used.has(p.cover));
  const scored = cand.map(p => {
    const head = p.text.split('\n')[0];
    let s = 0;
    if (head.includes(name)) s += 5;
    if (DYN_GOOD.test(head) && !DYN_BAD.test(head)) s += 3;
    if (head.length < 40) s += 1;
    return { p, s };
  }).filter(x => {
    const head = x.p.text.split('\n')[0];
    return x.s > 0 && DYN_GOOD.test(head) && !DYN_BAD.test(head);
  }).sort((a, b) => b.s - a.s);
  return scored[0]?.p || null;
}

async function save(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  await sharp(buf).resize(1200, 675, { fit: 'cover', position: 'attention' }).webp({ quality: 86 }).toFile(dest);
}

const used = new Set(banners.flatMap(b => b.imgs || []).filter(Boolean));
let changed = 0;

for (const g of games) {
  if (ONLY && g.id !== ONLY) continue;
  const mine = banners.filter(b => b.game === g.id);
  if (!mine.length) continue;
  const need = mine.flatMap(b => b.chars.map((c, i) => ({ b, c, i })))
    .filter(({ b, i }) => FORCE || !b.imgs?.[i]);
  if (!need.length) continue;

  console.log(`${g.name}: 待处理 ${need.length} 位（${need.map(n => n.c).join('、')}）`);
  let dynCache = null;

  for (const { b, c, i } of need) {
    let hit = null, from = '';
    try {
      const list = await videos(g.mid, c);
      hit = pickVideo(list, c);
      from = '视频';
      if (hit) hit = { pic: hit.pic, label: hit.title };
    } catch { /* ignore */ }

    if (!hit) {
      if (!dynCache) dynCache = await feed(g.mid);
      const d = pickDyn(dynCache, c, used);
      if (d) { hit = { pic: d.cover, label: d.text.split('\n')[0] }; from = '动态'; }
    }

    if (!hit) { console.log(`  ✗ ${c}：视频和动态都没找到`); continue; }
    const bi = banners.indexOf(b);
    const keep = b.imgs?.[i] ? path.basename(b.imgs[i]) : '';
    const file = keep || `pool-${g.id}-${bi}-${i}.webp`;
    await save(hit.pic, path.join(ASSETS, file));
    b.imgs = b.imgs || [];
    b.imgs[i] = 'assets/' + file;
    used.add(hit.pic);
    changed++;
    console.log(`  ✓ ${c} ← [${from}] ${hit.label.slice(0, 44)}`);
    await sleep(800);
  }
}

if (changed) {
  fs.writeFileSync(path.join(DATA, 'banners.json'), JSON.stringify(banners, null, 2) + '\n');
  console.log(`\n已更新 data/banners.json（${changed} 张）`);
} else {
  console.log('\n没有需要补的图');
}
