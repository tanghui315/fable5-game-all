# 落地执行计划（长任务目标）

> 依据 [design.md](design.md) 与 [tasks.md](tasks.md)。本文件是整个落地过程的"总指挥单"，每个阶段完成后更新状态。

## 最终目标（Definition of Done）

1. `pnpm install && pnpm -r build && pnpm validate` 全部通过。
2. 站点本地 `pnpm --filter site preview` 可访问：首页、详情页、作者页、关于页、搜索页齐全；视觉符合 design.md §8；示例 FPS 能在详情页里玩（鼠标锁定、全屏、退出游戏）。
3. 种子数据：示例仓库 `wquguru/fable52-fps-repro` 的入口全部收录，有真实截图封面。
4. `crawler enrich <url>` 对示例仓库能找出全部入口、生成 YAML 草稿 + 截图；配置了 `ANTHROPIC_API_KEY` 时输出 AI 预审，没配时跳过；`--pr` 时开 PR。
5. GitHub workflows 齐全：validate、deploy、submission、discover、healthcheck；Issue 模板齐全。
6. 所有外部凭据（Cloudflare、Anthropic、搜索 PAT）只是 secret 引用，没配也不报错。

## 分工

| 角色 | 职责 |
|---|---|
| 主控（Claude） | 设计、拆任务、写任务单、代码审查、浏览器视觉审查、验收、提交 |
| 执行子代理 | 按任务单编码、自测；只改任务单里指定的目录；不提交 git |

## 阶段与并行泳道

```
阶段 1  M0 基础（单个子代理，其他人依赖它）
          workspace + 全部依赖一次装好 + schema + validate + CI
              │
阶段 2  三条泳道并行（目录互不重叠，不允许再改依赖）
   ├─ A 种子数据：data/ + media/（Playwright 截图）
   ├─ B 站点：apps/site/
   └─ C 爬虫：apps/crawler/
              │
阶段 3  主控审查：代码 review + 浏览器截图对照 §8 → 问题清单
              │
阶段 4  修复轮（按泳道并行）
              │
阶段 5  M3 workflows + Issue 模板 + README → 最终验收 → 提交
```

## 约定

- 包管理 pnpm 9，Node ≥ 22（本机 23），TypeScript strict，ESM。
- 依赖只在阶段 1 安装；之后的子代理需要新依赖时在汇报里写明，由主控统一处理，防止并发改 lockfile。
- 数据字段以 `packages/schema` 为准；站点和爬虫都从它 import 类型。
- 域名 `stubhall.com`（Cloudflare Pages 自定义域名）；CODEOWNERS `@tanghui315`；`01-audio` 与 `01-audio-1h` 合并成一条。

## 状态

- [ ] 阶段 1 M0
- [ ] 阶段 2 A / B / C
- [ ] 阶段 3 审查
- [ ] 阶段 4 修复
- [ ] 阶段 5 收尾
