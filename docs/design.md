# fable5-game-all 方案文档（方案 B：GitHub 原生）

> 状态：草案 v0.1 · 2026-11-12
> 一个**非官方**的社区平台：收录用 Fable 5.x（Anthropic 大模型）生成的网页游戏，集中试玩，展示作者信息、开源地址和"怎么做出来的"（提示词、轮数、成本）。

---

## 1. 目标与定位

| 目标 | 说明 |
|---|---|
| 集中试玩 | 打开即玩，不用安装，不用一个个去翻推特和 GitHub |
| 尊重作者 | 每个作品都挂作者信息；开源的贴 GitHub 地址；默认嵌入作者自己的原地址，流量归作者 |
| 展示生成过程 | 提示词、轮数、成本、耗时、证据等级，这是本平台和 itch.io 等平台的核心差异 |
| 低运营成本 | 没有数据库、没有服务器；抓取、审核、上架都在 GitHub 上完成 |

**不做的事（MVP 阶段）**：用户账号、评论、在线托管上传、X/推特自动抓取。

## 2. 核心概念

### 2.1 仓库和游戏一对多

一个仓库可能有多个可玩入口。示例仓库 `wquguru/fable52-fps-repro` 有 5 个：

| 入口 | 类型 |
|---|---|
| `demos/04-fps/`（SUBLEVEL 07） | 游戏 |
| `demos/01-audio/`、`demos/01-audio-1h/` | 技术演示（音效） |
| `demos/02-materials/` | 技术演示（材质） |
| `demos/03-models/` | 技术演示（建模） |

所以数据上 **Game 是最小收录单位**，通过 `repo.url + repo.path` 关联到仓库；作品分为 `game`（游戏）和 `demo`（技术演示）两类。

### 2.2 证据等级

"是不是用 Fable 5.x 做的"没法百分百验证，按证据分级并在页面上公开展示：

| 等级 | 条件 | 示例 |
|---|---|---|
| L1 | 作者自述（推文、README 一句话、投稿声明） | "made with Fable 5.2" |
| L2 | 有可检查的痕迹：README 模型徽章、代码/脚本里出现 `claude-fable-5-2` 等模型 ID | — |
| L3 | 公开了提示词原文或运行日志/成本数据 | 示例仓库的 `prompts/` + `data/metrics.tsv` |

管理员可以在审核时调整等级，并在 `evidence_notes` 写明依据。

### 2.3 收录标准

1. 浏览器直接可玩，无需安装；原地址可访问。
2. 证据等级至少 L1。
3. 不是仿冒现有商业游戏或 IP（名字、角色、美术、关卡），否则驳回。
4. 没有恶意代码（挖矿、钓鱼、异常外联），没有成人内容。
5. 开源与否都收：没开源的只放在线地址，标注"未开源"。

## 3. 总体架构

```
            ┌───────────── 发现来源 ─────────────┐
            │ GitHub 代码/仓库搜索 · HN · 用户投稿 │
            └──────────────────┬─────────────────┘
                               ▼
  GitHub Actions ── crawler：去重 → 补全元数据 → Playwright 探测/截图 → AI 预审
                               │
                               ▼
               自动开 PR（YAML 草稿 + 截图 + 预审报告）
                               │
                     管理员审核 PR（改 / 合并 / 关闭）
                               │  合并 = 上架
                               ▼
        main 分支 data/ ──► 构建 Astro 静态站 + Pagefind 索引 ──► Cloudflare Pages
                               ▲
          healthcheck（每周）：坏链 / star 数 → 写 data/_generated，坏链开 Issue
```

**关键点**

- **上架 = 合并 PR。** 审核历史、谁在什么时候上架了什么，全部留在 PR 里，公开透明。
- **人工编辑的数据和机器写的数据分开。** `data/games/*.yaml` 只放人审过的内容；star 数、健康状态这类经常变的数据由机器人写进 `data/_generated/`，避免每周产生一堆 PR 噪音。
- **AI 只出建议，不做决定。** README 是不受信任的输入（可能有提示词注入），AI 预审结果只出现在 PR 正文里，不赋予任何工具权限，也不会自动合并。

## 4. 仓库目录

```
fable5-game-all/
  packages/
    schema/            zod 定义的 Game / Author / Rejected，导出 JSON Schema 和类型
  apps/
    site/              Astro 静态站（交互部分用 React 组件）
    crawler/           发现、补全、探测、预审、开 PR 的 Node 脚本
      queries.yaml     搜索关键词配置
  data/
    authors/<id>.yaml
    games/<id>.yaml
    rejected.yaml      驳回记录（含原因），防止重复提名
    _state/seen.json   爬虫已见过的仓库（机器写）
    _generated/        star 数、健康状态等（机器写）
  media/<game-id>/     cover.webp、preview.webp
  .github/
    workflows/         validate / deploy / discover / submission / healthcheck
    ISSUE_TEMPLATE/    submit-game.yml、takedown.yml
    CODEOWNERS         data/ 和 media/ 需要管理员审核
  docs/
```

技术选型：pnpm workspace + TypeScript + Node 22；站点 Astro + React 组件（见 §8.7）；搜索 Pagefind；探测 Playwright；部署 Cloudflare Pages（能通过 `_headers` 设置 CSP，GitHub Pages 做不到）。

## 5. 数据模型

### 5.1 Game（`data/games/<id>.yaml`）

以示例仓库的 04-fps 为例：

```yaml
id: wquguru--fable52-fps-repro--04-fps   # owner--repo--入口名，全局唯一
slug: sublevel-07                        # URL 用：/g/sublevel-07
kind: game                               # game | demo
status: published                        # published | archived
title:
  zh: SUBLEVEL 07
  en: SUBLEVEL 07
summary:
  zh: 潮湿地下变电站里，持红点卡宾枪击退三波悬浮无人机的单文件 FPS。
  en: Single-file FPS — fight three waves of hovering drones in a wet underground substation.
author: wquguru                          # 对应 data/authors/wquguru.yaml

repo:                                    # 未开源则整个省略
  url: https://github.com/wquguru/fable52-fps-repro
  path: demos/04-fps
  license: MIT

play:
  url: https://wquguru.github.io/fable52-fps-repro/demos/04-fps/
  embeddable: true                       # 探测结果，可人工覆盖
  mirror_url: null                       # P2：镜像地址（仅协议允许时）

media:
  cover: media/wquguru--fable52-fps-repro--04-fps/cover.webp
  preview: media/wquguru--fable52-fps-repro--04-fps/preview.webp

genre: shooter
tags: [fps, threejs, webgl, single-file]
controls: [keyboard, mouse]              # keyboard | mouse | touch | gamepad
mobile: false

model:
  name: fable-5.2
  evidence: L3
  evidence_notes: README 模型徽章；prompts/04-fps.md 公开提示词；data/metrics.tsv 有成本数据

generation:                              # 都是可选字段
  tool: claude-code
  prompt_url: https://github.com/wquguru/fable52-fps-repro/blob/main/prompts/04-fps.md
  turns: 73
  cost_usd: 15.96
  duration_min: 40.8

source:
  discovered_by: seed                    # seed | github-search | submission | hn | manual
  discovered_at: 2026-11-12
  published_at: 2026-11-12
```

### 5.2 Author（`data/authors/<id>.yaml`）

```yaml
id: wquguru
name: wquguru
github: wquguru
x: wquguru
website: null
avatar: https://github.com/wquguru.png
claimed: false        # 作者是否认领过（P2）
```

### 5.3 Rejected（`data/rejected.yaml`）

```yaml
- repo: https://github.com/someone/some-repo
  reason: ip-clone      # not-a-game | no-evidence | ip-clone | broken | malicious | duplicate | author-optout
  note: 仿冒现有商业游戏
  date: 2026-11-20
```

### 5.4 机器生成数据（`data/_generated/`）

- `repos.json`：每个仓库的 star 数、最后提交时间、仓库是否还在。
- `health.json`：每个 `play.url` 的最后检查时间、HTTP 状态、是否可嵌入、控制台报错数。

站点构建时把这些数据和 YAML 合并；`health.status = broken` 的作品在列表里隐藏，详情页显示"原地址暂时无法访问"。

## 6. 发现与抓取

### 6.1 来源

| 来源 | 做法 | 阶段 |
|---|---|---|
| GitHub 代码搜索 | 搜模型 ID 和名称：`claude-fable-5-2`、`"Fable 5.2"`、`fable52`、`fable-5-2` | M3 |
| GitHub 仓库搜索 | 关键词 + topic（`claude-code` 加 `webgl-game` / `threejs` / `game`） | M3 |
| 用户投稿 | Issue 表单，作者或玩家提交链接 | M2 |
| Hacker News | Algolia 搜索接口，抽取 GitHub / Pages 链接 | M3 |
| 关系扩散 | 已收录作者的其他仓库、fork 链 | P2 |
| Reddit | 搜索接口 | P2 |
| X / 推特 | 官方 API 太贵，不做自动抓取；管理员手动粘贴链接走投稿流程 | — |

搜索词集中放在 `apps/crawler/queries.yaml`，加词不用改代码。GitHub 代码搜索需要个人令牌（fine-grained PAT，只读公开仓库），存在 Actions secret 里；注意速率限制（代码搜索约 10 次/分钟）。

### 6.2 补全流水线（`crawler enrich <url>`）

输入是仓库地址或在线地址，步骤如下：

1. **去重**：查 `seen.json`、`rejected.yaml`、已有的 `data/games`，命中就跳过。
2. **拉元数据**：GitHub API 取描述、协议、topics、star 数、`homepageUrl`、README、作者资料。
3. **找可玩入口**：`homepageUrl`、gh-pages 分支、仓库里的 `**/index.html`（排除 `node_modules`、构建产物），推算出 Pages 地址。
4. **Playwright 探测**（对每个入口）：
   - HTTP 是否可达；响应头 `X-Frame-Options`、CSP `frame-ancestors` 是否禁止嵌入；
   - 等待渲染后截图做封面，录几秒做动态预览（WebP，封面 ≤150 KB，预览 ≤1 MB）；
   - 记录控制台报错和外部请求域名（用来发现可疑外联）。
5. **AI 预审**：把 README 摘要、目录结构、探测结果交给 Claude，要求**结构化输出**：
   - `kind`（game / demo / 非游戏）、`genre`、`tags`、`controls`、`mobile`
   - 中英文标题和简介
   - 证据等级建议和依据（引用原文片段）
   - 提示词链接、轮数、成本等（如果仓库里有）
   - 风险提示：疑似仿冒 IP、可疑外联等

   模型 ID 从配置读取，选便宜的小模型即可。
6. **产出**：每个入口一份 YAML 草稿 + 媒体文件，打包成**一个仓库一个 PR**。PR 正文是预审报告（截图、证据、风险），并打上标签：`candidate`、`evidence:L2`、`kind:game` 等。

### 6.3 管理员审核

- `CODEOWNERS` 把 `data/` 和 `media/` 指给管理员，分支保护要求至少一人批准。
- 管理员在 PR 里可以直接改 YAML（标题、标签、等级），然后：
  - **合并** → 自动部署上架；
  - **关闭并加 `rejected` 标签** → 机器人把仓库写进 `rejected.yaml`，以后不再提名。
- `validate` workflow 在每个 PR 上检查：schema、slug 唯一、作者存在、媒体文件存在且不超大、`play.url` 可达。

## 7. 站点（玩家端）

| 页面 | 内容 |
|---|---|
| `/` 首页 | 封面网格，鼠标悬停播放预览；按 类型 / 标签 / 操作方式 / 适配手机 筛选；排序：最新、star 数 |
| `/g/[slug]` 详情 | iframe 播放器 + 全屏 + "新窗口打开"；作者卡片；GitHub 地址和协议；证据等级；**生成数据面板**（提示词、轮数、成本、耗时）；同仓库其他作品 |
| `/a/[author]` 作者页 | 作者资料和全部作品 |
| `/search` | Pagefind 全文搜索（构建时生成索引，纯前端） |
| `/submit` | 跳转 Issue 投稿表单 |
| `/about` | 收录标准、证据等级说明、非官方声明、下架申请方式 |

**播放器 iframe 属性**：

```html
<iframe src="{play.url}"
  allow="fullscreen; pointer-lock; gamepad; autoplay"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
  loading="lazy" referrerpolicy="no-referrer"></iframe>
```

- 嵌入的是作者自己域名下的页面，和本站不同源，所以开 `allow-same-origin` 也读不到本站的 cookie 和存储；FPS 游戏需要 `pointer-lock`。
- 镜像（P2）必须放在**独立域名**（如 `play.<domain>`），绝不能和主站同源。
- `embeddable: false` 时只显示封面和"新窗口打开"按钮。

i18n：数据字段从第一天起就按 `zh` / `en` 存；界面 MVP 先做中文，P2 加英文和日文。

**播放器点击后才加载。** 详情页先显示封面和"开始游戏"按钮，点击后才创建 iframe。WebGL 游戏动辄上百 KB 外加 CDN 依赖，进页面就加载会拖慢浏览，也会在用户没准备好时突然发出声音。

## 8. 视觉与交互设计

### 8.1 设计依据

- **游戏是主角，平台是展厅。** 收录的作品大多是深色的 WebGL 画面，色彩饱和。平台界面要安静，给封面让位，不和它们抢眼球。
- **这个圈子最有特点的东西是"账单"。** 一句提示词、73 轮、40 分钟、$15.96，这些数字是 Fable 作品圈子独有的谈资（示例仓库的副标题就是"提示词与缓存账单"）。平台把生成数据做成一张**生成小票**，这是全站唯一的装饰性元素。
- **浏览和游玩是两种状态。** 浏览时是明亮的展厅；按下"开始游戏"后灯光调暗，进入放映厅。全站唯一的编排动效就花在这里。

> **修订记录**：最初设想的是"近黑背景 + 单一琥珀色强调 + 等宽小标签"。这是当下 AI 生成页面最常见的套路，而且和示例仓库自己的页面（`#0b0d10` + `#ffb347`）几乎一样，用户会以为是同一个站。所以改成"纸面展厅 + 放映厅"的双状态方案，等宽字体也只在小票里出现，因为真实的小票就是等宽打印的。

### 8.2 配色

展厅（浏览状态）：

| 名称 | 色值 | 用途 |
|---|---|---|
| 纸 `--paper` | `#E9EAE4` | 页面背景，偏冷的灰纸色，衬得深色封面像一块块亮着的屏幕 |
| 墨 `--ink` | `#1D2433` | 正文、标题；墨蓝色而不是纯黑，和放映厅同一色系 |
| 铅 `--lead` | `#5A6170` | 次要文字、元信息（在纸色上对比度 5.0:1） |
| 折痕 `--crease` | `#C9CBC3` | 分隔线、输入框边框 |
| 钴蓝 `--cobalt` | `#3046E8` | 唯一的强调色：开始游戏按钮、链接、键盘焦点环（在纸色上 5.5:1） |
| 小票 `--receipt` | `#F8F8F4` | 生成小票的纸面，比页面背景略亮 |

放映厅（游玩状态）：

| 名称 | 色值 | 用途 |
|---|---|---|
| 暗场 `--theater` | `#0F1320` | 播放器周围的背景，墨蓝色压到最暗 |
| 微光 `--glow-text` | `#DCDFE8` | 暗场里的文字 |
| 亮钴蓝 `--cobalt-on-dark` | `#8C9BFF` | 暗场里的强调色（钴蓝在暗场上只有 2.8:1，不够，所以提亮，提亮后 7.4:1） |

规则：

- 钴蓝只用在"可以点"的东西上，不用来装饰。
- 不用渐变、不用彩色阴影。卡片不加阴影，封面本身就是视觉重心。
- 证据等级不用红黄绿，而是用实心点的个数表示：L1 一个点，L2 两个点，L3 三个点。点的颜色统一用墨色。
- 全站深色模式放到 M4。MVP 阶段就是"浅色展厅 + 深色放映厅"。

### 8.3 字体

| 角色 | 字体 | 说明 |
|---|---|---|
| 界面和正文 | 系统黑体栈：PingFang SC / Microsoft YaHei / Noto Sans SC，400 / 700 / 900 | 中文字体包太大（几十 MB），MVP 不自托管；以后需要统一观感时再做子集化 |
| 游戏标题 | 同上，900 字重，大字号，字距收紧 −0.02em | 用字重和字号做出层次，而不是另换一种花哨字体 |
| 生成小票 | JetBrains Mono | 只用在小票里；小票本来就是等宽打印的 |

- 字号阶梯（以 16px 为基准，比例约 1.25）：13 / 16 / 20 / 25 / 31 / 39 / 49。
- 正文行高 1.7（中文需要比英文更宽松），每行不超过 36 个汉字（约 80 个英文字符）。
- 不用全大写标签，不在标题上方加小标签，不用"A · B · C"这种点号拼接的元信息串，按钮文字后面不加"→"。

### 8.4 版式

全部左对齐。网格 12 列，最大宽度 1200px，两侧留白不少于 24px。

**首页**

```
┌──────────────────────────────────────────────────────────┐
│ fable5-game-all          [搜索游戏……]       提交游戏 关于 │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┐  ┌──────────────────┐   │
│ │                              │  │ 生成小票          │   │
│ │   本周推荐：预览动图循环播放   │  │ 提示词 "做一个…"  │   │
│ │   （两栏宽）                  │  │ 73 轮   40.8 分钟 │   │
│ │                              │  │ 合计     $15.96   │   │
│ └──────────────────────────────┘  └─/\/\/\/\/\/\/\/\─┘   │
│ SUBLEVEL 07   作者 wquguru   [开始游戏]                    │
│                                                          │
│ 游戏 | 技术演示    射击 解谜 跑酷 …    键鼠 触屏    最新 ▾   │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│ │ 封面   │ │ 封面   │ │ 封面   │ │ 封面   │              │
│ └────────┘ └────────┘ └────────┘ └────────┘              │
│ 标题        标题        标题        标题                   │
│ 作者 73轮   作者        作者 $8.5   作者                    │
└──────────────────────────────────────────────────────────┘
```

- 首屏开场就是一个**正在动的游戏画面**加它的小票，不放"收录 128 款游戏"这种大数字统计。
- 列表项没有卡片外框，封面（16:10，圆角 6px）下面直接是标题和一行元信息。有成本数据的作品，元信息里显示轮数或成本。
- 筛选栏是一行可点的文字标签，选中状态用墨色实底加纸色文字。

**详情页**

```
浏览状态                                 点击"开始游戏"后
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ ← 全部游戏                    │        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ┌──────────────────────────┐ │        │▓┌──────────────────────────┐▓│
│ │          封面             │ │  ───►  │▓│        游戏 iframe       │▓│
│ │       [ 开始游戏 ]         │ │ 灯光调暗 │▓│                          │▓│
│ └──────────────────────────┘ │        │▓└──────────────────────────┘▓│
│ SUBLEVEL 07                  │        │▓ 全屏  新窗口打开  退出游戏  ▓│
│ 简介……                        │        │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│ ┌────────────┐ ┌───────────┐ │        └──────────────────────────────┘
│ │作者 wquguru │ │ 生成小票   │ │
│ │仓库 / MIT   │ │ ……        │ │
│ │证据 ●●●     │ │ 合计 $15.96│ │
│ │操作 键盘鼠标 │ └─/\/\/\/\/─┘ │
│ └────────────┘               │
│ 同仓库的其他作品 ……             │
└──────────────────────────────┘
```

**生成小票**

```
┌─────────────────────────────┐
│ 生成小票                     │
│ 模型          fable-5.2     │
│ 工具          claude-code   │
│ ─────────────────────────── │
│ 提示词                       │
│ "做一个 3D FPS……"            │
│               查看完整提示词  │
│ ─────────────────────────── │
│ 轮数                    73  │
│ 耗时               40.8 分钟 │
│ 合计（API 折算）      $15.96 │
└─/\/\/\/\/\/\/\/\/\/\/\/\/\──┘
```

- 底边是撕纸锯齿（CSS `mask` 实现），这是小票唯一的装饰。
- 数字右对齐，用等宽字体的等宽数字。
- 没有生成数据的作品不显示小票，而是显示一行"作者没有公开生成过程"。小票里的字段缺哪项就不显示哪项，不写"未知"。

### 8.5 动效

- **只有一个编排动效：灯光调暗。** 点击"开始游戏"后，页面背景在 400ms 内从纸色过渡到暗场色，其余内容淡出，播放器区域保持原位，然后加载 iframe。退出游戏时反向播放。
- 其他动效只用来回应操作：筛选结果更新、小票展开完整提示词。不做滚动入场动画，也不做所有卡片的悬停浮起。
- 首页列表的预览动图：桌面端悬停时播放，手机端不自动播放。
- 开启"减少动态效果"（`prefers-reduced-motion`）时，调暗直接切换，预览不自动播放。

### 8.6 交互与可访问性

- **键盘**：所有可点元素都有钴蓝焦点环（2px，外偏移 2px）。游戏会捕获键盘，所以播放器下方常驻"退出游戏"按钮，并提示"按 Esc 释放鼠标"。
- **手机**：`controls` 里没有 `touch` 的作品，在手机上不显示播放器，而是提示"这个游戏需要键盘和鼠标，建议在电脑上玩"，同时给出"仍然打开"的链接。
- **对比度**：正文和可交互元素都不低于 WCAG AA（4.5:1）。
- **文案**：动词直白，和动作一一对应："开始游戏""退出游戏""新窗口打开""查看源码""提交游戏"。
  - 空状态："没有符合筛选条件的游戏。" + 按钮"清除筛选"
  - 坏链："原地址暂时打不开（上次检查：11 月 12 日）。" + 按钮"查看源码"
  - 不能嵌入："作者的网站不允许嵌入播放。" + 按钮"新窗口打开"

### 8.7 前端实现

- **框架：Astro 生成页面，交互部分用 React 组件**（Astro 的"孤岛"方式）。
  - 静态部分（列表、详情、作者页、关于页）用 Astro 组件，输出纯 HTML，不带 JS。
  - React 组件只用在需要交互的地方：`FilterBar`（筛选和排序）、`GamePlayer`（点击加载、调暗、全屏、退出）、`SearchBox`（调用 Pagefind）。
  - 好处：首页加载快；React 组件以后迁移到方案 A（Next.js）时可以直接复用。
- **样式**：设计变量集中写在 `apps/site/src/styles/tokens.css`（CSS 自定义属性，名字和 §8.2 一致），组件用 Astro 的作用域样式。不引入 Tailwind，变量就是唯一的设计来源。
- **字体**：中文用系统黑体栈；JetBrains Mono 用 `@fontsource/jetbrains-mono` 自己托管，不走 Google Fonts。
- **图片**：封面用 Astro 的 `<Image>` 生成多种尺寸，懒加载。

## 9. 安全与合规

| 风险 | 对策 |
|---|---|
| 第三方脚本作恶 | 只嵌入跨域页面；镜像走独立域名；探测时记录外部请求，有异常就在 PR 里标红 |
| 提示词注入 | README 只当数据；AI 没有工具权限；输出只进 PR，人工审核后才合并 |
| 版权 | 默认只链接、只嵌入，不复制代码；没有开源协议的仓库不做镜像；仿冒 IP 直接驳回 |
| 作者不想被收录 | `/about` 和 takedown Issue 模板；处理后写进 `rejected.yaml`，原因记为 `author-optout` |
| 品牌误导 | 名字和 Logo 不能让人以为是 Anthropic 官方；页脚固定写"非官方社区收录" |
| 外部 CDN 依赖 | 很多作品从 CDN 加载 three.js，健康巡检会发现 CDN 失效导致的坏链 |

## 10. 迁移到方案 A 的时机

出现以下任意一种情况时，再考虑迁到 Next.js + Cloudflare D1/R2：

- 每周候选 PR 超过约 50 个，审核 PR 变得吃力；
- 需要用户账号、评论、点赞、排行榜这类实时数据；
- 媒体文件让仓库体积明显膨胀（可以先只把 `media/` 迁到 R2）。

YAML 数据模型可以原样导入数据库，现在的工作不会白做。

## 11. 待确认事项

1. 平台名称和域名（避免让人误以为是官方）。
2. 部署平台：推荐 Cloudflare Pages（支持自定义响应头）；也可以用 GitHub Pages。
3. 技术演示收不收？建议收，但单独分类，首页默认只显示游戏。
4. 管理员名单（GitHub 账号），写进 `CODEOWNERS`。
5. AI 预审用的 Anthropic API key 和每月预算上限。
6. 示例仓库的 `01-audio` 和 `01-audio-1h` 是同一个任务跑了两次，是收成两条，还是只收一条、在详情里注明？
