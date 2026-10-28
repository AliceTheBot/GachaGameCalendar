// 给卡池角色抓官方立绘：按角色名在官方 B 站动态里找「角色PV / 角色演示 / EP / 干员演示 / 代理人档案 / 生日贺图」
// 用法：node scripts/fetch-pool-art.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const ASSETS = path.join(ROOT, 'assets');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const FORCE = process.argv.includes('--force');

const games = JSON.parse(fs.readFileSync(path.join(DATA, 'games.json'), 'utf8'));
const banners = JSON.parse(fs.readFileSync(path.join(DATA, 'banners.json'), 'utf8'));

const ART = /角色PV|角色演示|EP|干员演示|干员档案|代理人档案|角色介绍|立绘|贺图|生日|PV/;

async function feed(mid, pages = 8) {
  const out = [];
  let offset = '';
  for (let i = 0; i < pages; i++) {
    const url = `https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space?host_mid=${mid}&offset=${encodeURIComponent(offset)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: `https://space.bilibili.com/${mid}/dynamic` } });
    const j = await r.json();
    const d = j.data || {};
    for (const it of d.items || []) {
      out.push({ opus: String(it.opus_id || ''), text: (it.content || '').replace(/\u00a0/g, ' '), cover: it.cover?.url || '' });
    }
    if (!d.has_more || !d.offset) break;
    offset = d.offset;
    await new Promise(r => setTimeout(r, 500));
  }
  return out;
}

function pick(posts, name, used) {
  const cand = posts.filter(p => p.cover && p.text.includes(name) && !used.has(p.cover));
  const scored = cand
    .map(p => {
      const head = p.text.split('\n')[0];
      let score = 0;
      if (head.includes(name)) score += 5;
      if (ART.test(head)) score += 3;
      if (/《[^》]*》/.test(head)) score += 1;
      if (head.length < 40) score += 1;
      if (/抽奖|转发|现金|红包|兑换码|预约|壁纸/.test(head)) score -= 6;
      return { p, score };
    })
    .filter(x => {
      const head = x.p.text.split('\n')[0];
      return x.score > 0 && ART.test(head) && !/抽奖|转发|现金|红包|兑换码|预约|壁纸/.test(head);
    })
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].p : null;
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
  const mine = banners.filter(b => b.game === g.id);
  if (!mine.length) continue;
  const need = mine.flatMap(b => b.chars.map((c, i) => ({ b, c, i })))
    .filter(({ b, i }) => FORCE || !b.imgs?.[i]);
  if (!need.length) continue;

  console.log(`${g.name}: 需要补 ${need.length} 位（${need.map(n => n.c).join('、')}）`);
  const posts = await feed(g.mid);
  console.log(`  抓到 ${posts.length} 条动态`);

  for (const { b, c, i } of need) {
    const hit = pick(posts, c, used);
    if (!hit) { console.log(`  ✗ ${c}：没找到带图的动态`); continue; }
    const file = `pool-${g.id}-${i}.webp`;
    await save(hit.cover, path.join(ASSETS, file));
    b.imgs = b.imgs || [];
    b.imgs[i] = 'assets/' + file;
    used.add(hit.cover);
    changed++;
    console.log(`  ✓ ${c} ← ${hit.text.split('\n')[0].slice(0, 40)}`);
  }
}

if (changed) {
  fs.writeFileSync(path.join(DATA, 'banners.json'), JSON.stringify(banners, null, 2) + '\n');
  console.log(`\n已更新 data/banners.json（${changed} 张）`);
} else {
  console.log('\n没有需要补的图');
}
