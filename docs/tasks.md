# 任务规划

> 对应 [design.md](design.md)（方案 B）。每个任务都写了验收标准；时间按一人兼职粗估。
> 进度标记：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成

## 里程碑总览

| 里程碑 | 目标 | 预计 | 产出 |
|---|---|---|---|
| M0 基础设施 | 仓库骨架、数据 schema、校验 CI | 2 天 | 可以往 `data/` 里加合法的 YAML |
| M1 站点 MVP | 种子数据上线，能浏览、能玩、能搜；视觉按 design.md §8 | 7 天 | **第一个公开版本** |
| M2 补全 + 投稿 | 给一个链接，自动生成候选 PR | 5 天 | 投稿 Issue 自动变成 PR |
| M3 自动发现 | 每天自动搜 GitHub / HN，定期巡检 | 4 天 | 管理员只需要审 PR |
| M4 增强 | 多语言、统计、徽章、认领、镜像 | 按需 | — |
| M5 远期 | SDK、复现挑战、周刊、迁移方案 A | 按需 | — |

依赖关系：M0 → M1 → M2 → M3；M4 的各项互相独立，M1 之后都能做。

---

## M0 基础设施

- [ ] **T0.1 初始化 workspace**
  - pnpm workspace：`packages/schema`、`apps/site`、`apps/crawler`；TypeScript、ESLint、Prettier；Node 22（`.nvmrc`）
  - 验收：`pnpm install && pnpm -r build` 通过
- [ ] **T0.2 数据 schema**（`packages/schema`）
  - 用 zod 定义 Game、Author、Rejected，字段按 design.md §5
  - 导出 TS 类型和 JSON Schema；在 YAML 文件头加 `# yaml-language-server: $schema=...`，编辑器里能直接提示和校验
  - 验收：示例 YAML 能通过，故意写错的 YAML 会报出具体字段
- [ ] **T0.3 校验脚本** `pnpm validate`
  - schema 校验；`id` / `slug` 唯一；`author` 存在；`media` 文件存在且不超过大小上限（封面 150 KB、预览 1 MB）
  - `--online` 参数：额外检查 `play.url` 可达
  - 验收：每类错误都有对应的测试用例
- [ ] **T0.4 PR 校验 CI**（`.github/workflows/validate.yml`）
  - 改动 `data/` 或 `media/` 的 PR 跑 `pnpm validate --online`
  - 验收：一个故意出错的 PR 显示红色 ✗
- [ ] **T0.5 权限**
  - `CODEOWNERS`：`data/`、`media/` 指给管理员
  - main 分支保护：需要 1 个批准，并且 validate 通过（在 GitHub 设置里手动开，步骤写进 README）
- [ ] **T0.6 README**：项目介绍、本地开发、怎么投稿、非官方声明

## M1 站点 MVP（第一个公开版本）

- [ ] **T1.1 种子数据**
  - 作者 `wquguru`；示例仓库的 5 个入口（`04-fps` 记为 game，其余记为 demo；`01-audio-1h` 的处理见 design.md §11 第 6 条）
  - 封面先手动截图，压成 WebP；成本数据从 `data/metrics.tsv` 手动抄过来
  - 验收：`pnpm validate --online` 通过
- [ ] **T1.2 Astro 站点骨架**
  - Astro 加 `@astrojs/react` 集成；构建时读取 `data/` 和 `data/_generated/` 并合并
  - 全局布局（顶栏、页脚非官方声明），12 列网格，最大宽度 1200px
- [ ] **T1.3 设计变量与基础组件**（design.md §8）
  - `tokens.css`：展厅和放映厅两套颜色、字号阶梯、间距、圆角、焦点环
  - 思源黑体按全站用字子集化后自己托管；小票用 JetBrains Mono
  - 基础组件：按钮、筛选标签、证据等级圆点、生成小票（锯齿底边）
  - 验收：所有文字和可交互元素对比度不低于 4.5:1；只用键盘就能操作全部组件
- [ ] **T1.4 首页**
  - 首屏放本周推荐：预览动图 + 生成小票 + "开始游戏"
  - 封面网格（无卡片外框，16:10），桌面端悬停播放预览，手机端不自动播放
  - React 组件 `FilterBar`：类型（默认只显示游戏）/ 标签 / 操作方式 / 适配手机；排序：最新、star 数；筛选条件同步到 URL
  - 空状态文案和"清除筛选"按钮
  - 验收：手机和桌面布局都正常，没有 JS 也能看到列表
- [ ] **T1.5 详情页** `/g/[slug]`
  - React 组件 `GamePlayer`：先显示封面，点"开始游戏"后才加载 iframe，并播放"灯光调暗"过渡（400ms，开启减少动态效果时直接切换）
  - iframe 属性按 design.md §7；全屏、新窗口打开、退出游戏（反向过渡），并提示"按 Esc 释放鼠标"
  - `embeddable: false` 或原地址失效时，按 design.md §8.6 的文案退回；手机上遇到不支持触屏的作品，显示建议在电脑上玩
  - 作者信息、GitHub 地址、协议、证据等级（悬停显示依据）、生成小票、同仓库其他作品
  - 验收：在详情页里能玩示例 FPS，鼠标锁定和全屏都正常；退出游戏后页面恢复浏览状态
- [ ] **T1.6 作者页** `/a/[author]`、**关于页** `/about`（收录标准、证据等级、下架方式）
- [ ] **T1.7 搜索**：React 组件 `SearchBox`；构建后跑 Pagefind 生成索引；`/search` 页面和顶栏搜索框
- [ ] **T1.8 Issue 模板**
  - `submit-game.yml`：在线地址（必填）、仓库地址、作者联系方式、"用 Fable 5.x 做的"依据、是否本人作品
  - `takedown.yml`：下架申请
- [ ] **T1.9 部署**（`.github/workflows/deploy.yml`）
  - main 分支有推送就构建并发布到 Cloudflare Pages；`_headers` 里设置 CSP（`frame-src` 放开 https，`script-src` 收紧）
  - 验收：合并一个 PR 后，几分钟内线上能看到更新

## M2 自动补全 + 投稿自动化

- [ ] **T2.1 crawler 骨架**
  - CLI：`crawler enrich <url>`、`crawler discover`、`crawler health`
  - 封装 GitHub API 客户端（带速率限制重试）
- [ ] **T2.2 元数据补全**
  - 输入仓库地址或在线地址，两种都要支持
  - 拉取描述、协议、topics、star 数、`homepageUrl`、README、作者资料
  - 找可玩入口：`homepageUrl`、gh-pages 分支、`**/index.html`（排除 `node_modules`、`dist`）
  - 验收：对示例仓库能找出全部 5 个入口
- [ ] **T2.3 Playwright 探测**
  - 检查可达性；看响应头判断能否嵌入
  - 截封面；录约 5 秒动态预览，转 WebP 并压到大小上限以内
  - 记录控制台报错和外部请求域名
  - 验收：示例 FPS 生成的封面不是黑屏（要等 WebGL 渲染出画面）
- [ ] **T2.4 AI 预审**
  - 调用 Claude，输出结构化 JSON（字段见 design.md §6.2 第 5 步）；模型 ID 和单次 token 上限都写在配置里
  - 输入里的 README 要截断，并明确标注为"不可信数据"
  - 验收：示例仓库的 kind、证据等级、成本数据判断正确
- [ ] **T2.5 生成 PR**
  - 写 YAML 草稿和媒体文件 → 新建分支 → 开 PR
  - PR 正文是预审报告，带截图、证据引用和风险提示；打标签
  - 一个仓库一个 PR；同一个仓库已经有打开的 PR 就更新它，不重复开
- [ ] **T2.6 投稿自动化**（`submission.yml`）
  - Issue 带 `submission` 标签时：解析表单 → `enrich` → 开 PR 并关联这个 Issue → PR 合并后自动关闭 Issue
  - 验收：从提交表单到出现 PR 全程不需要人工操作
- [ ] **T2.7 驳回闭环**：PR 带 `rejected` 标签关闭时，机器人把仓库追加到 `data/rejected.yaml`（原因取自标签，如 `reason:ip-clone`）

## M3 自动发现 + 巡检

- [ ] **T3.1 GitHub 搜索来源**
  - `queries.yaml` 里配置代码搜索和仓库搜索的查询词（design.md §6.1）
  - 结果去重，再按信号打分（命中模型 ID、有 Pages 地址、有 `index.html`、star 数）
- [ ] **T3.2 去重状态**：`data/_state/seen.json` 记录仓库 ID 和最后一次处理时间；仓库有新提交时才重新评估
- [ ] **T3.3 每日发现**（`discover.yml`，cron 每天一次）
  - 按分数从高到低处理，每天最多开 N 个 PR（默认 10），防止淹没管理员
- [ ] **T3.4 Hacker News 来源**：Algolia 搜索关键词，从帖子和评论里抽 GitHub / Pages 链接，交给 `enrich`
- [ ] **T3.5 健康巡检**（`healthcheck.yml`，每周一次）
  - 更新 `data/_generated/health.json` 和 `repos.json`，由机器人直接提交到 main（这类文件不需要审核）
  - 连续两次检查失败就开 Issue 提醒管理员
- [ ] **T3.6 运营手册**（`docs/admin.md`）：怎么审 PR、证据等级怎么定、驳回原因怎么选、下架流程

## M4 增强（M1 之后可以按需挑着做）

- [ ] 界面多语言：英文、日文
- [ ] 全站深色模式（展厅也提供深色版，沿用墨蓝色系）
- [ ] 播放统计：Cloudflare Web Analytics 或 Umami，再加一个"最热"排序
- [ ] "Featured on …" 徽章：生成 SVG 和 README 代码片段，作者可以挂回自己的仓库
- [ ] 作者认领：作者通过 Issue 认领，验证 GitHub 身份后可以改自己作品的简介
- [ ] Reddit 来源；关系扩散来源（已收录作者的其他仓库、fork 链）
- [ ] 镜像：独立域名 `play.<domain>`，只对允许的协议启用，原站挂了时自动切换
- [ ] 性价比榜：有成本数据的作品按"质量 / 成本"排序
- [ ] `media/` 迁到 R2，减小仓库体积

## M5 远期

- [ ] 平台 SDK：游戏通过 `postMessage` 上报分数，做跨游戏排行榜
- [ ] 复现挑战：同一个提示词，不同人、不同模型版本跑出来的结果放在一起对比
- [ ] 每周精选周刊
- [ ] 达到 design.md §10 的条件后迁移到方案 A

---

## 开工前需要你确认

见 design.md §11。M0 不依赖这些答案；M1 部署前需要定下 **名称和域名**、**部署平台**、**管理员名单**；M2 开始前需要 **API key 和预算上限**。
