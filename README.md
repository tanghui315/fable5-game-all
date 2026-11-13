English | [简体中文](README.zh-CN.md)

<img src="apps/site/public/logo.svg" width="62" height="40" alt="">

# Stub (票根)

> Repository: `fable5-game-all`
> Live site: <https://stubhall.com>

An **unofficial** community collection of browser games made with Fable 5.x (Anthropic's model). Each entry is playable in place and shows the author, the source repository and how the game was made: prompt, turns, cost and evidence level.

No database and no server. Submission, review, publishing and health checks all happen on GitHub:

- Publishing means merging a candidate PR, and the review trail is public.
- The site is a static Astro build that deploys to Cloudflare Pages on merge.
- A weekly health check finds dead links; games that fail twice are hidden from listings and an issue is opened.

The site defaults to English at `/`, with a Chinese mirror under `/zh/`. Every game has an English and a Chinese title and summary, and both locales are indexed by Pagefind.

> **Unofficial**: this site is not affiliated with Anthropic and does not represent Anthropic's views. Every game remains the copyright of its author; this site only links and embeds. The name and logo must not suggest an official product.

## Repository layout

```
packages/schema/     zod models (Game / Author / Rejected), validation and JSON Schema
apps/site/           Astro static site, builds to apps/site/dist (Pagefind index, _headers)
apps/crawler/        discovery, enrichment, probing, AI pre-review, PR opening, health checks
data/
  authors/<id>.yaml  authors (reviewed by hand)
  games/<id>.yaml    game entries (reviewed by hand)
  rejected.yaml      rejections, so the same repository is not nominated again
  _state/seen.json   crawler dedupe state (written by the bot)
  _generated/        stars and health status (written by the bot)
media/<game-id>/     covers and previews
.github/workflows/    validate / deploy / discover / submission / healthcheck
.github/ISSUE_TEMPLATE/  submission and takedown forms
docs/design.md       design and data model
docs/admin.md        admin review handbook
```

## Local development

Requires pnpm 9.12.3 and Node 22+.

```bash
pnpm install
pnpm validate              # schema / uniqueness / authors / media size
pnpm validate --online     # also check that play.url is reachable
pnpm --filter site dev     # local site
pnpm --filter site build   # build dist + Pagefind
pnpm --filter crawler build
pnpm --filter crawler test
```

### Crawler commands

```bash
# Enrich a repository or live URL; writes a YAML draft, screenshots and review.md
# (does not write to the repository or use the network for writes)
pnpm --filter crawler crawler enrich https://github.com/wquguru/fable52-fps-repro

# Open a candidate PR (needs GITHUB_REPOSITORY=owner/repo and a token with write access)
GITHUB_REPOSITORY=tanghui315/fable5-game-all \
GITHUB_TOKEN=... BOT_TOKEN=... \
  pnpm --filter crawler crawler enrich <url> --pr

# Daily discovery: inspect the ranking first, then actually open PRs
pnpm --filter crawler crawler discover --limit 10 --dry-run
GITHUB_REPOSITORY=tanghui315/fable5-game-all BOT_TOKEN=... \
  pnpm --filter crawler crawler discover --limit 10

# Health check, writing data/_generated
pnpm --filter crawler crawler health --write

# Reproduce a submission locally
pnpm --filter crawler crawler submission --body /tmp/issue.md --issue 42 --pr
```

`ANTHROPIC_API_KEY` is optional. Without it, AI pre-review falls back to deterministic heuristics (`--no-ai` forces the fallback).

## How publishing works

```
submission issue ──► submission.yml ──► crawler enrich ──► candidate PR
daily GitHub/HN search ──► discover.yml ──────────────────┘   (review.md + YAML + screenshots)
                                                              │
                                              validate.yml ◄──┤ schema / media / live URL
                                                              ▼
                                          admin reviews the PR (edit YAML / merge / close)
                                                              │ merge = published
                                                              ▼
                     push to main / bot push completes ──► deploy.yml ──► Cloudflare Pages
                                                              ▲
                     weekly healthcheck ──► data/_generated ───┘
                       (two failures in a row: hide from listings + open an issue)
```

Rejection: add the `rejected` and a `reason:*` label to a PR, then close it. `submission.yml` writes the repository to `data/rejected.yaml`, so it is not nominated again.

## Launch checklist

The steps below assume the repository is `tanghui315/fable5-game-all`. Replace the owner/repo if you fork it.

### 1. Push the repository and enable Actions

```bash
git remote add origin git@github.com:tanghui315/fable5-game-all.git
git push -u origin main
```

In **Settings → Actions → General**:

- Set Workflow permissions to **Read and write**.
- Enable **Allow GitHub Actions to create and approve pull requests** (only used as a fallback when `BOT_TOKEN` is not configured).

### 2. Create labels

The issue templates and the bot depend on these labels. Create them up front (safe to re-run; `--force` updates them):

```bash
gh label create submission --description "Submission issue" --color 0e8a16 --force
gh label create takedown   --description "Removal / correction request" --color b60205 --force
gh label create candidate  --description "Candidate PR opened by the bot" --color fbca04 --force
gh label create rejected   --description "Rejected; closing writes data/rejected.yaml" --color 5319e7 --force
gh label create healthcheck --description "Weekly health check failure" --color B60205 --force

for reason in not-a-game no-evidence ip-clone broken malicious duplicate author-optout; do
  gh label create "reason:$reason" --description "Rejection reason: $reason" --color e99695 --force
done
for level in L1 L2 L3; do
  gh label create "evidence:$level" --description "Evidence level $level" --color 1d76db --force
done
gh label create kind:game --description "Game" --color c5def5 --force
gh label create kind:demo --description "Tech demo" --color d4c5f9 --force
```

### 3. Create the Cloudflare Pages project and credentials

```bash
# You can also create it in the Cloudflare dashboard; the production branch must be main
npx wrangler pages project create fable5-game-all --production-branch=main
```

Attach the custom domain `stubhall.com` (when the domain is in the same Cloudflare account, the DNS record is created automatically): Dashboard → Workers & Pages → `fable5-game-all` → Custom domains → Set up a custom domain → enter `stubhall.com`.

You can also deploy from your machine (without GitHub Actions):

```bash
pnpm --filter @fable5/schema build && pnpm --filter site build
cd apps/site && npx wrangler pages deploy dist --project-name=fable5-game-all --branch=main
```

Create a Cloudflare API token (permission: **Account → Cloudflare Pages → Edit**), then:

```bash
gh secret set CLOUDFLARE_API_TOKEN     # paste the Pages Edit token
gh secret set CLOUDFLARE_ACCOUNT_ID    # Account ID from the dashboard
gh secret set BOT_TOKEN                # see the table below
gh secret set GH_SEARCH_TOKEN          # optional, but recommended
gh secret set ANTHROPIC_API_KEY        # optional; without it only heuristics run

# Optional variable; defaults to fable5-game-all
gh variable set CF_PAGES_PROJECT --body fable5-game-all
```

| Secret / variable              | Used by                      | Purpose                                                                                                                                                                                                 | If missing                                                                  |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`         | deploy.yml                   | Deploy to Pages                                                                                                                                                                                         | Builds, then fails the job with an explicit error — nothing is published |
| `CLOUDFLARE_ACCOUNT_ID`        | deploy.yml                   | Selects the Cloudflare account                                                                                                                                                                          | Same as above                                                               |
| `BOT_TOKEN`                    | submission.yml, discover.yml | Creates branches/PRs as the bot so `pull_request` triggers validate; a fine-grained PAT or GitHub App token with `Contents` + `Pull requests` + `Issues` write on this repository only                   | Falls back to `GITHUB_TOKEN`: the PR still appears, but CI does not run automatically; trigger validate by hand |
| `GH_SEARCH_TOKEN`              | discover.yml                 | Read-only PAT that gives code/repository search its own quota                                                                                                                                           | Falls back to `GITHUB_TOKEN`; search works but shares that quota             |
| `ANTHROPIC_API_KEY`            | submission.yml, discover.yml | AI pre-review                                                                                                                                                                                           | Deterministic heuristics are used and the PR body says so                    |
| `CF_PAGES_PROJECT` (variable)  | deploy.yml                   | Pages project name                                                                                                                                                                                      | Defaults to `fable5-game-all`                                                |

> Why `BOT_TOKEN`: branches pushed and PRs opened with `GITHUB_TOKEN` do **not** trigger `pull_request` workflows. The bot therefore writes PRs with a bot token. Its direct pushes to `data/` on main still use `GITHUB_TOKEN`, which is why deploy.yml also listens for `workflow_run`.

### 4. Protect main

**Settings → Rules → Rulesets → New branch ruleset** (or classic branch protection):

- Target branch: `main`.
- Enable **Require a pull request before merging** with Required approvals = **1**.
- Enable **Require status checks to pass** and add the `validate data` check from the `validate` workflow.
- Add **GitHub Actions** to the **Bypass list** (bypass mode: Always). The bot must push `data/_generated/`, `data/_state/seen.json` and `data/rejected.yaml` directly. In classic branch protection this is “Allow specified actors to bypass required pull requests → GitHub Actions”.
- Consider keeping `CODEOWNERS` review requirements for `data/` and `media/`.

### 5. End-to-end smoke test

1. Open **Issues → New issue → 投稿游戏** (submit a game), enter a real playable URL and the evidence, and submit.
2. Confirm the issue gets the `submission` label, the **submission** workflow succeeds, and a PR titled `Candidate:` appears. Its body should contain the `review.md` content, screenshots, the evidence level, the external request domains and the `candidate` / `evidence:*` / `kind:*` labels.
3. Confirm **validate** runs automatically on that PR and turns green. If it did not run: Actions → validate → Run workflow, set ref to `refs/pull/<PR number>/merge`.
4. Edit a YAML field in the PR (for example the title or evidence level), confirm validate passes again, and merge.
5. Confirm the linked issue closes automatically, the **deploy** workflow runs, and the game page at `https://stubhall.com/g/<slug>` is reachable and playable. The Chinese mirror is at `https://stubhall.com/zh/g/<slug>`.
6. Run **Actions → healthcheck → Run workflow** once. Confirm a bot commit lands in `data/_generated/` and deploy succeeds again through `workflow_run`.
7. (Optional) Test rejection: open a candidate PR, add `rejected` and `reason:no-evidence`, then close it. Confirm the repository appears in `data/rejected.yaml`.

The site is live at <https://stubhall.com>; keep the links in `.github/ISSUE_TEMPLATE/config.yml` pointing at that domain.
