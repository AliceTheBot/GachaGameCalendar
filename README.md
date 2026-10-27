# 活动日历 · 原神 / 星铁 / 绝区零 / 鸣潮 / 终末地

五款游戏的**限时活动**图文日历，顶部 tab 切换游戏，进行中的活动实时显示剩余时间。
持续整版本的长线活动、战令、常驻玩法会收进折叠区，不占主列表。

## 页面

- `index.html` — 部署用。图片在 `assets/`，两者需一起发布。
- `standalone.html` — 单文件版，图片已内嵌 base64，可直接发给别人 / 本地双击打开。

## 数据从哪来

| 来源 | 用途 |
|---|---|
| B 站官方账号动态（`opus/feed/space`） | 活动封面图、活动起止时间 |
| 米哈游内容 API / 各游戏官网公告 | 交叉核对版本与活动时间 |
| `data/curated.json` | 人工校验后的活动底表（标题、时间、分类、配图） |

`build.mjs` 每次构建会抓一遍五个官方账号的最新动态，自动发现底表里没有的新活动：
要求正文含「活动时间 / 活动期间」、标题出现在时间之前、且标题不是多條动态反复出现的版本口号，
再下载封面压成 webp 存入 `assets/`，写进页面。抓不到就退回 `data/cache/*.json` 的上次缓存。

## 本地运行

```bash
npm install --ignore-scripts   # sharp 的安装脚本在受限环境下会被拦，忽略即可
npm run build
```

产物：`index.html`、`standalone.html`、`data/last-build.json`（本次构建的结构化结果）。
`npm run build:no-discover` 只渲染 `curated.json`，不联网抓新活动，适合离线改样式。

## 自动更新

`.github/workflows/weekly.yml`：每周五 12:00（北京时间，cron `0 4 * * 5` UTC）自动
`npm ci` → `node build.mjs` → 提交回仓库；也可以在 Actions 页面手动 `workflow_dispatch`。

## 部署

1. 推到 GitHub 仓库；
2. Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`；
3. 等 Actions 跑完即可访问 `https://<用户名>.github.io/<仓库名>/`。

Cloudflare Pages 同理：构建命令留空，输出目录填 `/`。

## 维护

- 新活动时间以官方公告为准，写进 `data/curated.json`；`st: true` 表示"整版本长线活动"，会直接进折叠区。
- 主列表的判定：时长 ≤ 21 天且未结束；折叠区保留最近 7 天内结束的长线活动；已结束保留 21 天。
- 封面统一存 `assets/<game>-NN.webp`，建议 16:9；长条 banner 在 `curated.json` 里加 `fit: "contain"` 避免裁掉文字。
