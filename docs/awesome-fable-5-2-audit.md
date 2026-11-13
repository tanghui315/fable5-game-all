# awesome-fable-5.2 清单审核

审核日期 2026-11-13 · 数据源 [fengyiqicoder/awesome-fable-5.2 → all/games.md](https://github.com/fengyiqicoder/awesome-fable-5.2/blob/main/all/games.md)（68 条，按点赞排序）

## 结论先说

- **68 条里 25 条现在本站已有**：8 条原本就在库里，17 条是这次实测后新收的。
- **收录前跑过实测**：无头 Chromium（SwiftShader 软件渲染，1280×800）打开页面、点进游戏、截图；只有截到真实游戏画面（赛道、角色、菜单或对局 UI）的才收，停在加载画面或只有标题的这次都没收。
- **11 条明确不收**：8 条 claude.ai artifact 全部被人机验证挡住且 `frame-ancestors` 禁止 iframe；Worm Rider 没有在线地址；VOWLORN 的链接是博客文章；Hogwarts Royale 是商业 IP 拼贴。
- **12 条平台页待人工确认**：patch.gg / remix.gg / Crayon / wavedash / Spawn 这些站要么在无头环境里跑不出画面，要么禁止 iframe、游戏本体在子页面里，需要人拿真浏览器点一遍。
- **20 条能打开但这次没截到可玩画面**：标题页、加载页或超时，留到第二批复验。

## 怎么验的

1. 解析 `games.md` 的 68 张卡片：标题、在线地址、作者 X 账号、点赞数、作者推文链接。
2. 和 `data/games/*.yaml` 的 `play.url` / `repo.url`、`data/rejected.yaml` 做 URL 归一化比对，去重（清单内部也有一条重复：Saltline 出现在 #2 和 #13 的 "Three Games" 里）。
3. 每条候选跑 Playwright Chromium：导航（20 秒超时）→ 等渲染 → 截图 → 记录 HTTP 状态、`X-Frame-Options` / `frame-ancestors`、控制台错误。
4. 对候选再跑一遍「进游戏」复验：点 Play / Start / BEGIN / 画面中央，再等 5 秒截图，确认画面有内容、能内嵌的页面确实有 canvas 或子 iframe。
5. 证据等级：清单给出作者本人推文链接的，记为 L1，并在 `evidence_notes` 写明推文地址和实测日期；没有推文的（如 IRONDUSK）单独注明来源只有清单本身。

## 总表

| # | 作品 | 作者 | ♥ | 状态 | 说明 |
|---:|---|---|---:|---|---|
| 1 | Starry Nightrider | @ebbyamir | 17.2k | 已收录 | `starry-night-rider` |
| 2 | Saltline — first-person shooter | @felixrieseberg | 14.6k | 不收录 | claude.ai artifact：Cloudflare 人机验证，且 `frame-ancestors` 禁止 iframe |
| 3 | Oil Paint — hand-painted game | @BlendiByl | 7.9k | 平台待确认 | patch.gg 在无头环境显示 not rendered，待人工确认 |
| 4 | CROSSTOWN — open-world New York (early preview) | @mattshumer_ | 7.5k | 待复验 | 页面能打开，但没截到可玩画面 |
| 5 | What the Water Keeps | @kevin_t_ngo | 4.2k | 待复验 | 页面能打开，但没截到可玩画面 |
| 6 | Tennis | @photonstorm | 3.0k | 已收录 | `tennis` |
| 7 | Mirror Earth | @mattshumer_ | 2.4k | **本次收录** | `mirror-earth` |
| 8 | Portals: Endless Worlds | @emollick | 1.9k | 已收录 | `portals-endless-worlds` |
| 9 | Evensong | @kevin_t_ngo | 1.7k | 待复验 | 页面能打开，但没截到可玩画面 |
| 10 | LANTERNFALL | @loktar00 | 1.4k | 已收录 | `lanternfall` |
| 11 | Mist-Locked Mountain Gate — 3D action game | @op7418 | 1.1k | 已收录 | `wumen-gate` |
| 12 | Rooftop Rally — pickleball in Unreal 5.9 | @chongdashu | 1.1k | 平台待确认 | wavedash 托管，禁止 iframe，待人工确认 |
| 13 | Three Games (Saltline · The Clockmaker's Heart · Tidewright) | @felixrieseberg | 810 | 不收录 | claude.ai artifact：同上 |
| 14 | Voxel Engine | @mattshumer_ | 735 | 平台待确认 | Spawn 托管，禁止 iframe；画面已渲染，待人工确认操作 |
| 15 | Patchwork Quilt | @BlendiByl | 607 | 平台待确认 | patch.gg：同上 |
| 16 | I Would Have Gotten Away With It | @emollick | 507 | 待复验 | 页面能打开，但没截到可玩画面 |
| 17 | Childhood Rug Racer | @noclipepe | 412 | **本次收录** | `childhood-rug-racer` |
| 18 | Coloured Pencil | @BlendiByl | 406 | 平台待确认 | patch.gg：同上 |
| 19 | Cloud Stunt 3D | @jev_chat | 329 | **本次收录** | `cloud-stunt-3d` |
| 20 | Gilt & Gutter | @kevin_t_ngo | 323 | 待复验 | 页面能打开，但没截到可玩画面 |
| 21 | Hogwarts Royale | @mattshumer_ | 310 | 不收录 | 《哈利·波特》× Fortnite 同人拼贴，商业 IP，暂不收 |
| 22 | Dread & District | @emollick | 301 | 已收录 | `dread-and-district` |
| 23 | Cayley flight simulator | @lionel_mora | 294 | **本次收录** | `cayley` |
| 24 | Worm Rider | @AmirMushich | 251 | 不收录 | 仓库没有 Pages，要本地 `node serve.mjs`，没有在线地址 |
| 25 | MAAD MAXXING | @Andrew_Blumson | 241 | 待复验 | 页面能打开，但没截到可玩画面 |
| 26 | First Crush | @kieranklaassen | 228 | 待复验 | 页面能打开，但没截到可玩画面 |
| 27 | Cozy Lisbon | @goncalo_canhoto | 166 | **本次收录** | `cozy-lisbon` |
| 28 | Frontline Warfare Deathmatch | @alightinastorm | 163 | 待复验 | 页面能打开，但没截到可玩画面 |
| 29 | Fable 5.2 FPS Repro | @wquguru | 154 | 已收录 | `harbor-model-viewer` |
| 30 | Banana Mine Rush | @0xChuckstock | 154 | 平台待确认 | remix.gg 只到站内列表页，没进游戏 |
| 31 | Rambo Dino | @noclipepe | 146 | 待复验 | 页面能打开，但没截到可玩画面 |
| 32 | Turbo Tails | @petergyang | 138 | 待复验 | 页面能打开，但没截到可玩画面 |
| 33 | Lumina Zombies | @LuminaBench | 124 | 已收录 | `lumina-zombies` |
| 34 | Feed the Backrooms | @LexnLin | 94 | 待复验 | 页面能打开，但没截到可玩画面 |
| 35 | Thunder Valley dino chase | @loktar00 | 92 | **本次收录** | `thunder-valley` |
| 36 | The Waking River | @flxrnc | 86 | 待复验 | 页面能打开，但没截到可玩画面 |
| 37 | SKYWAKE | @aniketjart | 77 | 平台待确认 | Crayon 托管，禁止 iframe，待人工确认 |
| 38 | Save the World | @global_techgirl | 63 | 待复验 | 页面能打开，但没截到可玩画面 |
| 39 | Ringfall | @rehan_shei | 62 | **本次收录** | `ringfall` |
| 40 | HITOFUDE | @positronx_ | 52 | **本次收录** | `hitofude` |
| 41 | Chairmageddon | @argofowl | 48 | 待复验 | 页面能打开，但没截到可玩画面 |
| 42 | VOWLORN | @higgsfield_ai | 46 | 不收录 | 链接是 Higgsfield 的博客文章，不是可玩页面 |
| 43 | Farewell Light | @RyanSael | 44 | **本次收录** | `farewell-light` |
| 44 | Stray Cat | @aimikoda | 43 | 不收录 | claude.ai artifact：同上 |
| 45 | Midnight Pass | @andreysuperior | 42 | 不收录 | claude.ai artifact：同上 |
| 46 | Survivors | @BLACKST0CK | 40 | 平台待确认 | remix.gg：同上 |
| 47 | KUMOKIRI | @aniketjart | 39 | 平台待确认 | Crayon 托管：同上 |
| 48 | Thermal | @loktar00 | 35 | 待复验 | 页面能打开，但没截到可玩画面 |
| 49 | Thimble Knights | @_nilni | 34 | **本次收录** | `thimble-knights` |
| 50 | Tilt Labyrinth | @mylifcc | 32 | 待复验 | 页面能打开，但没截到可玩画面 |
| 51 | Fighting game (plays on phones) | @s_shigel | 32 | 不收录 | claude.ai artifact：同上 |
| 52 | Harbor Lights Grand Prix | @Tetriss112 | 28 | **本次收录** | `harbor-lights-grand-prix` |
| 53 | Hoppy Meadow | @0xChuckstock | 26 | 平台待确认 | remix.gg：同上 |
| 54 | The Vast Horizon | @OdinLovis | 26 | 待复验 | 页面能打开，但没截到可玩画面 |
| 55 | Open-world kart adventure | @realWeZZard | 24 | 不收录 | claude.ai artifact：同上 |
| 56 | Giant Leap | @handsher_NGU | 23 | 待复验 | 页面能打开，但没截到可玩画面 |
| 57 | BRIX '84 | @0xChuckstock | 23 | 平台待确认 | remix.gg：同上 |
| 58 | IRONDUSK — Yard 7 | @vista8 | 20 | **本次收录** | `irondusk` |
| 59 | Cozy Bakery | @goncalo_canhoto | 18 | **本次收录** | `cozy-bakery` |
| 60 | Silicon Seduction | @ZryMiller | 13 | 待复验 | 页面能打开，但没截到可玩画面 |
| 61 | NightClub: Drift & Speed | @Story91_ | 13 | **本次收录** | `nightclub` |
| 62 | Handful: Island God | @_nilni | 11 | **本次收录** | `handful-island-god` |
| 63 | IGNITION fighting game | @s_shigel | 11 | 待复验 | 页面能打开，但没截到可玩画面 |
| 64 | Reef Dive | @boona11 | 10 | 平台待确认 | wavedash：同上 |
| 65 | Great Wave | @_nilni | 7 | **本次收录** | `great-wave` |
| 66 | Roost | @tejas3732 | 6 | 不收录 | claude.ai artifact：同上 |
| 67 | Four-character fighting game | @promodenstudio | 4 | 不收录 | claude.ai artifact：同上 |
| 68 | Vippi | @Shrit1401 | 1 | **本次收录** | `vippi` |

## 数字

| 状态 | 条数 |
|---|---:|
| 已收录（原有） | 8 |
| 本次收录 | 17 |
| 平台待确认 | 12 |
| 待复验 | 20 |
| 不收录 | 11 |

## 本次收录的 17 条

- [Cayley flight simulator](https://lauramionel.github.io/cayley-flight-simulator/) — `cayley`
- [Childhood Rug Racer](https://noclipepe.pages.dev/rug/) — `childhood-rug-racer`
- [Cloud Stunt 3D](https://finderchangchang.github.io/cloud-stunt-3d/) — `cloud-stunt-3d`
- [Cozy Bakery](https://cozybakery.vercel.app) — `cozy-bakery`
- [Cozy Lisbon](https://cozylisbon.vercel.app) — `cozy-lisbon`
- [Farewell Light](https://sael.net/demo/farewell-light/) — `farewell-light`
- [Great Wave](https://www.aigameshare.com/games/great-wave-off-kanagawa?play=1&mode=fullscreen) — `great-wave`
- [Handful: Island God](https://www.aigameshare.com/games/island-god-game?play=1&mode=fullscreen) — `handful-island-god`
- [Harbor Lights Grand Prix](https://tetriss22.github.io/harbor-gp/) — `harbor-lights-grand-prix`
- [HITOFUDE](https://shubhu121.github.io/hitdude/play/) — `hitofude`
- [IRONDUSK — Yard 7](https://qiaomu.t5t6.com/irondusk-yard-7/) — `irondusk`
- [Mirror Earth](https://www.spawn.co/@mattshumer/earth?room=local) — `mirror-earth`
- [NightClub: Drift & Speed](https://www.nightclub-driftspeed.xyz/) — `nightclub`
- [Ringfall](https://patch.gg/games/rehan/ringfall) — `ringfall`
- [Thimble Knights](https://www.aigameshare.com/games/animal-card-battle-game?play=1&mode=fullscreen) — `thimble-knights`
- [Thunder Valley dino chase](https://loktar00.github.io/llm-test-pages/fable52-dino-chase/) — `thunder-valley`
- [Vippi](https://vippi.vercel.app/) — `vippi`

## 第二批要做的

1. **平台页人工点一遍**（12 条）：patch.gg 的 Oil Paint / Patchwork Quilt / Coloured Pencil，remix.gg 的 4 条，Crayon 的 SKYWAKE / KUMOKIRI，wavedash 的 Rooftop Rally / Reef Dive，Spawn 的 Voxel Engine。它们大多是"游戏在子页面里"，我们的探测只看顶层页面。
2. **待复验 20 条**：多是标题页/加载页停住，或者 vercel 冷启动超时（The Vast Horizon、Silicon Seduction、Tilt Labyrinth、Giant Leap）。复验时等更久、多点几次就能判断。
3. **claude.ai artifact 不建议收**：需要 Claude 账号、有人机验证、禁止 iframe，三项都过不了"打开就能玩"。

## 注意

- 清单本身是第三方整理，作者信息和"Fable 5.2 制作"的说法都来自作者推文，收录时按 L1 记录，不改写、不夸大。
- 同一作者多条作品（mattshumer、kevin_t_ngo、loktar00、_nilni、goncalo_canhoto 等）会落到同一个作者页，作者页的 `name` 先用 X handle，等作者认领后再补真名。
