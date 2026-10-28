# 活动日历 · 原神 / 星铁 / 绝区零 / 鸣潮 / 终末地

五款游戏的**限时活动**图文日历，顶部 tab 切换游戏，进行中的活动实时显示剩余时间。
持续整版本的长线活动、战令、常驻玩法会收进折叠区，不占主列表。

## 构建产物

- `public/` — **部署目录**，只放 `index.html` 和它用到的图（约 2 MB）。
- `index.html` + `assets/` — 仓库根目录的同款页面，给 GitHub Pages「分支直出」用。
- `standalone.html` — 单文件版，图片内嵌 base64，可直接发给别人 / 本地打开（不进仓库、不入部署）。

## 数据从哪来

| 来源 | 用途 |
|---|---|
| B 站官方账号动态（`opus/feed/space`） | 活动封面图、活动起止时间 |
| 米哈游内容 API / 各游戏官网公告 | 交叉核对版本与活动时间 |
| `data/curated.json` | 人工校验后的活动底表（标题、时间、分类、配图） |
| `data/banners.json` | 当前角色卡池（只记角色名、卡池名与起止时间；结束时间已过就自动消失） |

`build.mjs` 每次构建会抓一遍五个官方账号的最新动态，自动发现底表里没有的新活动：
要求正文含「活动时间 / 活动期间」、标题出现在时间之前、且标题不是多條动态反复出现的版本口号，
再下载封面压成 webp 存入 `assets/`，写进页面。抓不到就退回 `data/cache/*.json` 的上次缓存。

## 本地运行

```bash
npm install --ignore-scripts   # sharp 的安装脚本在受限环境下会被拦，忽略即可
npm run build
```

产物：`public/`、`index.html`、`standalone.html`、`data/last-build.json`（本次构建的结构化结果）。
`npm run build:no-discover` 只渲染 `curated.json`，不联网抓新活动，适合离线改样式。

## 自动更新

`.github/workflows/weekly.yml`：每周五 12:00（北京时间，cron `0 4 * * 5` UTC）自动
`npm ci` → `node build.mjs` → 提交回仓库；也可以在 Actions 页面手动 `workflow_dispatch`。

## 部署

### Cloudflare Workers（当前用的）

仓库里的 `wrangler.jsonc` 已把静态资源目录指到 `./public`，所以**不会**再把 `node_modules` 传上去。

在 Workers & Pages 的构建设置里确认两项：

| 设置 | 值 |
|---|---|
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

`public/` 是构建产物、不进仓库，所以 Build command 里必须有 `npm run build`，否则部署时找不到目录。

### GitHub Pages（备选）

Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。
根目录的 `index.html` + `assets/` 就是完整站点。

## 维护

- 新活动时间以官方公告为准，写进 `data/curated.json`；`st: true` 表示"整版本长线活动"，会直接进折叠区。
- 主列表的判定：时长 ≤ 21 天且未结束；折叠区保留最近 7 天内结束的长线活动；已结束保留 21 天。
- 封面统一存 `assets/<game>-NN.webp`，建议 16:9；长条 banner 在 `curated.json` 里加 `fit: "contain"` 避免裁掉文字。
