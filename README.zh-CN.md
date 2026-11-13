[English](README.md) | 简体中文

<img src="apps/site/public/logo.svg" width="62" height="40" alt="">

# 票根 Stub

> 仓库名：`fable5-game-all`
> 线上站点：<https://stubhall.com>

一个**非官方**的社区收录站：集中试玩用 Fable 5.x（Anthropic 的大模型）生成的网页游戏，展示作者、开源地址和生成过程（提示词、轮数、成本、证据等级）。

没有数据库和服务器。投稿、审核、上架、巡检全部在 GitHub 上完成：

- 上架 = 合并候选 PR，审核记录公开可查；
- 站点是 Astro 静态站，合并后自动部署到 Cloudflare Pages；
- 每周巡检坏链，连续失败的作品自动从列表隐藏并开 Issue。

站点默认英文（`/`），中文镜像在 `/zh/`；每个作品的标题和简介都有中英两版，Pagefind 会分别建立两个语言的索引。

> **非官方声明**：本站与 Anthropic 没有任何关联，也不代表 Anthropic 的立场。作品版权归原作者所有，本站只做链接和嵌入。站名、Logo 不得让人误以为是官方产品。

## 仓库结构

```
packages/schema/      zod 数据模型（Game / Author / Rejected）、校验与 JSON Schema
apps/site/            Astro 静态站，构建到 apps/site/dist（含 Pagefind 索引、_headers）
apps/crawler/         发现、补全、探测、AI 预审、开 PR、健康巡检 CLI
data/
  authors/<id>.yaml   作者（人工审核）
  games/<id>.yaml     作品条目（人工审核）
  rejected.yaml       驳回记录，防止重复提名
  _state/seen.json    爬虫去重状态（机器人写）
  _generated/         star 数、健康状态（机器人写）
media/<game-id>/      封面和预览图
.github/workflows/    validate / deploy / discover / submission / healthcheck
.github/ISSUE_TEMPLATE/  投稿、下架表单
docs/design.md        设计与数据模型
docs/admin.md         管理员审核手册
```

## 本地开发

要求 pnpm 9.12.3、Node 22+。

```bash
pnpm install
pnpm validate              # schema / 唯一性 / 作者 / 媒体大小
pnpm validate --online     # 额外检查 play.url 可达
pnpm --filter site dev     # 本地站点
pnpm --filter site build   # 构建 dist + Pagefind
pnpm --filter crawler build
pnpm --filter crawler test
```

### Crawler 常用命令

```bash
# 补全一个仓库或在线地址，输出 YAML 草稿、截图和 review.md（不联网写仓库）
pnpm --filter crawler crawler enrich https://github.com/wquguru/fable52-fps-repro

# 开候选 PR（需要 GITHUB_REPOSITORY=owner/repo 和一个有写权限的 token）
GITHUB_REPOSITORY=tanghui315/fable5-game-all \
GITHUB_TOKEN=... BOT_TOKEN=... \
  pnpm --filter crawler crawler enrich <url> --pr

# 每日发现：先看排名，再真正开 PR
pnpm --filter crawler crawler discover --limit 10 --dry-run
GITHUB_REPOSITORY=tanghui315/fable5-game-all BOT_TOKEN=... \
  pnpm --filter crawler crawler discover --limit 10

# 健康巡检并写入 data/_generated
pnpm --filter crawler crawler health --write

# 本地复现一次投稿
pnpm --filter crawler crawler submission --body /tmp/issue.md --issue 42 --pr
```

`ANTHROPIC_API_KEY` 可选；没配置时 AI 预审自动退回确定性启发式（`--no-ai` 可强制跳过）。

## 工作闭环

```
投稿 Issue ──► submission.yml ──► crawler enrich ──► 候选 PR
每日 GitHub/HN 搜索 ──► discover.yml ────────────────┘   （review.md + YAML + 截图）
                                                              │
                                              validate.yml ◄──┤ schema / 媒体 / 在线地址
                                                              ▼
                                          管理员审核 PR（改 YAML / 合并 / 关闭）
                                                              │ 合并 = 上架
                                                              ▼
                     main 分支推送 / 机器人推送完成 ──► deploy.yml ──► Cloudflare Pages
                                                              ▲
                     每周 healthcheck ──► data/_generated ──────┘
                       （连续失败两次：列表隐藏 + 开 Issue）
```

驳回：给 PR 加 `rejected` 和一个 `reason:*` 标签后关闭，submission.yml 会把仓库写进
`data/rejected.yaml`，以后不再提名。

## 上线清单

以下假设仓库是 `tanghui315/fable5-game-all`；fork 后替换成自己的 owner/repo。

### 1. 推送仓库并开启 Actions

```bash
git remote add origin git@github.com:tanghui315/fable5-game-all.git
git push -u origin main
```

仓库 **Settings → Actions → General**：

- Workflow permissions 选 **Read and write**；
- 勾选 **Allow GitHub Actions to create and approve pull requests**（仅在没配 `BOT_TOKEN` 时作为回退）。

### 2. 创建标签

Issue 模板和机器人依赖这些标签，先建好（可重复执行，`--force` 会更新）：

```bash
gh label create submission --description "投稿 Issue" --color 0e8a16 --force
gh label create takedown   --description "下架 / 纠错申请" --color b60205 --force
gh label create candidate  --description "机器人生成的候选 PR" --color fbca04 --force
gh label create rejected   --description "驳回；关闭后写入 data/rejected.yaml" --color 5319e7 --force
gh label create healthcheck --description "每周巡检失败" --color B60205 --force

for reason in not-a-game no-evidence ip-clone broken malicious duplicate author-optout; do
  gh label create "reason:$reason" --description "驳回原因：$reason" --color e99695 --force
done
for level in L1 L2 L3; do
  gh label create "evidence:$level" --description "证据等级 $level" --color 1d76db --force
done
gh label create kind:game --description "游戏" --color c5def5 --force
gh label create kind:demo --description "技术演示" --color d4c5f9 --force
```

### 3. 创建 Cloudflare Pages 项目与凭据

```bash
# 也可以在 Cloudflare Dashboard 创建；生产分支必须叫 main
npx wrangler pages project create fable5-game-all --production-branch=main
```

绑定自定义域名 `stubhall.com`（域名已托管在同一个 Cloudflare 账号下时，DNS 记录会自动创建）：
Dashboard → Workers & Pages → `fable5-game-all` → Custom domains → Set up a custom domain → 输入 `stubhall.com`。
也可以在本机直接部署（不依赖 GitHub Actions）：

```bash
pnpm --filter @fable5/schema build && pnpm --filter site build
cd apps/site && npx wrangler pages deploy dist --project-name=fable5-game-all --branch=main
```

在 Cloudflare 创建一个 API Token（权限：**Account → Cloudflare Pages → Edit**），然后：

```bash
gh secret set CLOUDFLARE_API_TOKEN     # 粘贴 Pages Edit token
gh secret set CLOUDFLARE_ACCOUNT_ID    # Dashboard 右侧的 Account ID
gh secret set BOT_TOKEN                # 见下表
gh secret set GH_SEARCH_TOKEN          # 可选，但推荐
gh secret set ANTHROPIC_API_KEY        # 可选，没有就只用启发式预审

# 可选变量；不设时默认 fable5-game-all
gh variable set CF_PAGES_PROJECT --body fable5-game-all
```

| Secret / Variable              | 使用方                       | 用途                                                                                                                                                  | 缺失时                                                                     |
| ------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`         | deploy.yml                   | 部署到 Pages                                                                                                                                          | 照常构建，然后在凭据检查处显式报错——不会发布任何内容                      |
| `CLOUDFLARE_ACCOUNT_ID`        | deploy.yml                   | 指定 Cloudflare 账号                                                                                                                                  | 同上                                                                       |
| `BOT_TOKEN`                    | submission.yml、discover.yml | 以 bot 身份建分支/开 PR，让 `pull_request` 触发 validate；fine-grained PAT 或 GitHub App token，仅限本仓库 `Contents` + `Pull requests` + `Issues` 写 | 回退到 `GITHUB_TOKEN`：PR 仍会出现，但不会自动跑 CI，需要手动触发 validate |
| `GH_SEARCH_TOKEN`              | discover.yml                 | 只读 PAT，给代码/仓库搜索独立配额                                                                                                                     | 回退到 `GITHUB_TOKEN`，搜索可用但共享配额                                  |
| `ANTHROPIC_API_KEY`            | submission.yml、discover.yml | AI 预审                                                                                                                                               | 自动使用确定性启发式，PR 正文会注明                                        |
| `CF_PAGES_PROJECT`（variable） | deploy.yml                   | Pages 项目名                                                                                                                                          | 默认 `fable5-game-all`                                                     |

> 为什么要 `BOT_TOKEN`：用 `GITHUB_TOKEN` 推送的分支和打开的 PR **不会触发** `pull_request`
> workflow。因此 PR 写入使用 bot token；机器人对 main 的数据推送仍用 `GITHUB_TOKEN`，
> 所以 deploy.yml 同时监听 `workflow_run`。

### 4. 保护 main

**Settings → Rules → Rulesets → New branch ruleset**（或经典 Branch protection）：

- Target branch：`main`；
- 勾选 **Require a pull request before merging**，Required approvals = **1**；
- 勾选 **Require status checks to pass**，加入 `validate` workflow 的 `validate data` 检查；
- **Bypass list** 加入 **GitHub Actions**（bypass mode：Always）。机器人需要直接推送
  `data/_generated/`、`data/_state/seen.json`、`data/rejected.yaml`；经典分支保护对应
  “Allow specified actors to bypass required pull requests → GitHub Actions”。
- 建议保留 `CODEOWNERS` 对 `data/`、`media/` 的 review 要求。

### 5. 端到端冒烟测试

1. 打开 **Issues → New issue → 投稿游戏**，填一个真实可玩的作品地址和依据，提交。
2. 确认 Issue 自动带 `submission`，**submission** workflow 成功，出现标题以 `Candidate:` 开头的
   PR，正文含 `review.md` 内容、截图、证据等级、外部请求域名，并带 `candidate` / `evidence:*` /
   `kind:*` 标签。
3. 确认 **validate** 在该 PR 上自动运行并变绿（若没跑：Actions → validate → Run workflow，
   ref 填 `refs/pull/<PR 号>/merge`）。
4. 在 PR 里改一处 YAML（例如标题或证据等级），确认 validate 重新通过；合并。
5. 确认关联 Issue 自动关闭，**deploy** workflow 运行，`https://stubhall.com/g/<slug>` 可访问、能玩，
   中文镜像 `https://stubhall.com/zh/g/<slug>` 同样可访问。
6. 在 **Actions → healthcheck → Run workflow** 手动跑一次，确认 `data/_generated/` 有机器人提交，
   deploy 通过 `workflow_run` 再次成功。
7. （可选）驳回链路：新开一个候选 PR，先加 `rejected` 和 `reason:no-evidence`，再关闭，
   确认 `data/rejected.yaml` 出现该仓库。

站点已上线：<https://stubhall.com>。请保持 `.github/ISSUE_TEMPLATE/config.yml` 里的链接指向该域名。
