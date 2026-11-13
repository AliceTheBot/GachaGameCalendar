import { execSync } from 'node:child_process';
import fs from 'node:fs';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('no token'); process.exit(1); }
const OWNER = 'AliceTheBot', REPO = 'GachaGameCalendar', BRANCH = 'main';
const api = (p, opt = {}) => fetch(`https://api.github.com${p}`, {
  ...opt,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'dsh-push',
    ...(opt.headers || {}),
  },
});

const base = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
const raw = execSync(`git diff --name-status ${base}..HEAD`, { encoding: 'utf8' }).trim();
const changes = raw.split('\n').filter(Boolean).map(l => {
  const [st, ...rest] = l.split('\t');
  return { st: st[0], path: st[0] === 'R' ? rest[1] : rest[0] };
});
console.log('files', changes.length);

const ref = await (await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)).json();
const parentSha = ref.object.sha;
const parent = await (await api(`/repos/${OWNER}/${REPO}/git/commits/${parentSha}`)).json();

const tree = [];
for (const c of changes) {
  if (c.st === 'D') { tree.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
  const buf = fs.readFileSync(c.path);
  let blob = {};
  for (let i = 0; i < 4; i++) {
    const r = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
    });
    blob = await r.json();
    if (blob.sha) break;
    console.log('retry blob', c.path, r.status, blob.message);
    await new Promise(s => setTimeout(s, 1500));
  }
  if (!blob.sha) { console.error('blob fail', c.path, blob.message); process.exit(1); }
  tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
}

const newTree = await (await api(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: parent.tree.sha, tree }),
})).json();
const msg = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
const commit = await (await api(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message: msg, tree: newTree.sha, parents: [parentSha] }),
})).json();
const upd = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
console.log('push', upd.status, commit.sha);
