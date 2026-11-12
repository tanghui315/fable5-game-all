# 管理员审核手册

面向有写权限的维护者。所有上架、驳回和下架都通过 PR / Issue 留痕；不要直接改线上站点。

## 审核候选 PR

候选 PR 由 `submission.yml`（投稿）或 `discover.yml`（自动发现）创建，正文就是 crawler 生成的
`review.md`。一个仓库一个 PR；同一仓库有新提交时会更新原 PR，不会重复开。

逐项检查：

1. **PR 正文与标签**：有 `candidate`、`evidence:L1/L2/L3`、`kind:game|demo`；正文含入口表格、
   截图、探测结果、证据引用、风险和控制台错误。
2. **真的能玩**：在浏览器打开 `play.url`，确认能加载、键盘/鼠标操作正常、没有登录墙。
   手机作品再看触屏。
3. **不是仿冒 IP**：名字、角色、美术、关卡不能照搬现有商业游戏。拿不准就驳回（`reason:ip-clone`）。
4. **证据等级**（design.md §2.2）：
   - L1：作者自述（推文、README、投稿声明）；
   - L2：可检查的痕迹（模型徽章、代码里出现 `claude-fable-5-2` 等模型 ID）；
   - L3：公开提示词原文，或运行日志 / 轮数 / 成本数据。
     机器人给的等级只是建议。以 PR 里的证据引用为准，改 `model.evidence`，并把依据写进
     `model.evidence_notes`。
5. **外部请求域名**：正文里的“外部请求域名”应只有常见 CDN / 字体 / 统计服务。
   出现陌生域名、挖矿、钓鱼、异常外联，直接驳回（`reason:malicious`）。
6. **validate 必须绿**：schema、id/slug 唯一、作者存在、媒体存在且不超大、`play.url` 可达。
   bot 创建的 PR 如果没自动跑 CI（缺少 `BOT_TOKEN`）：Actions → **validate** → Run workflow，
   ref 填 `refs/pull/<PR 号>/merge`（或候选分支名）。
7. **编辑 YAML**：可以直接在 PR 的 “Files changed” 里改，常见修改：
   - `title.zh` / `summary.zh`：文案通顺，别照抄 README 的营销话术；
   - `kind`：游戏还是技术演示；`tags`、`controls`、`mobile`、`genre`；
   - `model.evidence` / `evidence_notes`；
   - `generation`：轮数、成本、提示词链接，只保留作者公开的数据；
   - `status`：默认 `published`；
   - `slug`：短、好记、全局唯一（改 slug 会改 URL）；
   - 媒体：封面 ≤150 KB、预览 ≤1 MB。
     改完等 validate 重新通过再合并。
8. **合并 = 上架**。PR 正文里的 `Closes #N` 会自动关闭投稿 Issue；合并后 deploy 会自动更新站点。

## 驳回

1. 在 PR 上先加 `rejected`，再**加且只加一个** `reason:*` 标签：
   - `reason:not-a-game`：不是可玩网页游戏；
   - `reason:no-evidence`：拿不出至少 L1 证据；
   - `reason:ip-clone`：仿冒现有商业游戏 / IP；
   - `reason:broken`：原地址长期不可访问；
   - `reason:malicious`：恶意代码、钓鱼、异常外联、成人内容；
   - `reason:duplicate`：重复条目；
   - `reason:author-optout`：作者要求不收录。
2. **然后关闭 PR**（不合并）。`submission.yml` 会读取关闭时的标签，把仓库追加到
   `data/rejected.yaml`；没加 `reason:*` 时默认 `not-a-game`。
3. 回到投稿 Issue 说明原因并关闭（关闭 PR 不会自动关闭 Issue）。
4. 如果标签加晚了：重新打开 PR → 补标签 → 再关闭。

## 下架 / 纠错（takedown Issue）

`takedown` Issue 需要人工处理。推荐通过一个 PR 修改 `data/`：

- **保留数据但隐藏**：把作品 YAML 的 `status` 改成 `archived`（列表隐藏，URL 仍可查）。
- **彻底移除**：删除 `data/games/<id>.yaml` 和 `media/<id>/`；作者文件如果不再被引用也一并删除。
- **记录不再提名**：在 `data/rejected.yaml` 追加：

  ```yaml
  - repo: https://github.com/owner/repo
    reason: author-optout
    note: 作者要求下架
    date: 2026-11-12
  ```

  `repo` 是必填的 GitHub 仓库 URL。纯在线、没有仓库的条目无法写入 rejected.yaml，
  请在 Issue 里记录处理结果。

- 涉及恶意代码/版权投诉时优先处理：可以直接合并一个只做删除的 PR，事后再补说明。
- 处理后关闭 Issue，并告知处理结果。

## 每周健康巡检

`healthcheck.yml` 每周一运行，写入 `data/_generated/health.json` 和 `repos.json`。连续两次失败的
作品在列表里自动隐藏（详情页显示原地址不可访问），并在失败达到两次时开一个带 `healthcheck`
标签的 Issue（已存在则不重复开）。

处理方式：

1. 打开失败表格里的 `play.url` 手动确认。可能是 GitHub Pages / CDN 的临时故障。
2. 临时故障：等下一次巡检自动恢复，不用改数据。
3. 长期坏链：
   - 作者换了地址 → 提 PR 更新 `play.url`（必要时 `repo.url`）；
   - 作品已删除/不可恢复 → 将 `status` 改为 `archived`，或删除条目；
   - 有可用镜像且协议允许 → 填 `play.mirror_url`。
4. 不要手改 `data/_generated/*.json`，下次巡检会覆盖。修复后关闭健康巡检 Issue。

## 部署与权限速查

- 合并后站点不更新：看 **deploy** workflow。没有 Cloudflare secrets 时只构建不部署（日志里有
  `::notice::`），配置 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` 后重跑。
- 机器人推 main 失败：确认分支保护 / ruleset 的 bypass 列表包含 **GitHub Actions**，
  且 Actions 的 Workflow permissions 为 Read and write。
- 候选 PR 没有 validate：确认 `BOT_TOKEN` 已配置；否则按上面的手动 dispatch 方式补跑。
