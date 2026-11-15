# awesome-fable-5.2 清单审核

审核日期 2026-11-13 · 数据源 [fengyiqicoder/awesome-fable-5.2 → all/games.md](https://github.com/fengyiqicoder/awesome-fable-5.2/blob/main/all/games.md)（68 条，按点赞排序）

## 结论先说

- **68 条里 51 条已经收进站里**：8 条原本就在库，第二批又补了 26 条，加上第一批的 17 条。
- **每条都实际打开点过**：先用无头 Chromium 初筛，打不开的再用带界面的真实 Chromium（有 GPU）复验，确认能进到游戏画面才收；只停在商店页、加载页、标题页的一律不收。
- **11 条明确不收**：8 条 claude.ai artifact 被人机验证挡住且禁止 iframe；Worm Rider 没有在线地址；VOWLORN 链接是博客文章；Hogwarts Royale 是商业 IP 拼贴。
- **剩 6 条待复验**：CROSSTOWN（早期预览，只有标题画面）、MAAD MAXXING（疑似要 WebGPU）、Frontline Warfare（页面提示要重启）、以及 remix.gg / wavedash 上 3 条只到商店页的。

## 怎么验的

1. 解析 `games.md` 的 68 张卡片：标题、在线地址、作者 X 账号、点赞数、作者推文链接。
2. 和 `data/games/*.yaml`、`data/rejected.yaml` 做 URL 归一化比对去重（清单内部 Saltline 也重复出现了两次）。
3. 第一轮：无头 Chromium（SwiftShader）打开、点 Play/Start、截图，记录 HTTP 状态、`X-Frame-Options` / `frame-ancestors`、控制台错误。
4. 第二轮：对平台页和第一轮没截到画面的，改用有界面的 Chromium（真实 GPU）再点一遍，连 iframe 里的子页面一起看。
5. 证据：清单给出作者本人推文的记 L1，`evidence_notes` 写推文地址和实测日期；没有推文的（BRIX '84、Hoppy Meadow、IRONDUSK）注明来源只有清单。

## 总表

| # | 作品 | 作者 | ♥ | 状态 | 说明 |
|---:|---|---|---:|---|---|
| 1 | Starry Nightrider | @ebbyamir | 17.2k | 已收录（原有） | `starry-night-rider` |
| 2 | Saltline — first-person shooter | @felixrieseberg | 14.6k | 不收录 | claude.ai artifact：Cloudflare 人机验证，且 `frame-ancestors` 禁止 iframe |
| 3 | Oil Paint — hand-painted game | @BlendiByl | 7.9k | **本次收录** | `oil-paint` |
| 4 | CROSSTOWN — open-world New York (early preview) | @mattshumer_ | 7.5k | 待复验 | 只停在标题/加载画面，没看到可玩内容（早期预览） |
| 5 | What the Water Keeps | @kevin_t_ngo | 4.2k | **本次收录** | `what-the-water-keeps` |
| 6 | Tennis | @photonstorm | 3.0k | 已收录（原有） | `tennis` |
| 7 | Mirror Earth | @mattshumer_ | 2.4k | **本次收录** | `mirror-earth` |
| 8 | Portals: Endless Worlds | @emollick | 1.9k | 已收录（原有） | `portals-endless-worlds` |
| 9 | Evensong | @kevin_t_ngo | 1.7k | **本次收录** | `evensong` |
| 10 | LANTERNFALL | @loktar00 | 1.4k | 已收录（原有） | `lanternfall` |
| 11 | Mist-Locked Mountain Gate — 3D action game | @op7418 | 1.1k | 已收录（原有） | `wumen-gate` |
| 12 | Rooftop Rally — pickleball in Unreal 5.9 | @chongdashu | 1.1k | 待复验 | wavedash 商店页，加载停在 69% |
| 13 | Three Games (Saltline · The Clockmaker's Heart · Tidewright) | @felixrieseberg | 810 | 不收录 | claude.ai artifact：同上 |
| 14 | Voxel Engine | @mattshumer_ | 735 | **本次收录** | `voxel-engine` |
| 15 | Patchwork Quilt | @BlendiByl | 607 | **本次收录** | `patchwork-quilt` |
| 16 | I Would Have Gotten Away With It | @emollick | 507 | **本次收录** | `i-would-have-gotten-away-with-it` |
| 17 | Childhood Rug Racer | @noclipepe | 412 | **本次收录** | `childhood-rug-racer` |
| 18 | Coloured Pencil | @BlendiByl | 406 | **本次收录** | `coloured-pencil` |
| 19 | Cloud Stunt 3D | @jev_chat | 329 | **本次收录** | `cloud-stunt-3d` |
| 20 | Gilt & Gutter | @kevin_t_ngo | 323 | **本次收录** | `gilt-and-gutter` |
| 21 | Hogwarts Royale | @mattshumer_ | 310 | 不收录 | 《哈利·波特》× Fortnite 同人拼贴，商业 IP，暂不收 |
| 22 | Dread & District | @emollick | 301 | 已收录（原有） | `dread-and-district` |
| 23 | Cayley flight simulator | @lionel_mora | 294 | **本次收录** | `cayley` |
| 24 | Worm Rider | @AmirMushich | 251 | 不收录 | 仓库没有 Pages，要本地 `node serve.mjs`，没有在线地址 |
| 25 | MAAD MAXXING | @Andrew_Blumson | 241 | 待复验 | 画面一直没有出来，疑似依赖 WebGPU |
| 26 | First Crush | @kieranklaassen | 228 | **本次收录** | `first-crush` |
| 27 | Cozy Lisbon | @goncalo_canhoto | 166 | **本次收录** | `cozy-lisbon` |
| 28 | Frontline Warfare Deathmatch | @alightinastorm | 163 | 待复验 | Spawn 页面提示 "This game needs a reboot"，进不去 |
| 29 | Fable 5.2 FPS Repro | @wquguru | 154 | 已收录（原有） | `harbor-model-viewer` |
| 30 | Banana Mine Rush | @0xChuckstock | 154 | 待复验 | remix.gg 只到商店页，游戏本体没起来 |
| 31 | Rambo Dino | @noclipepe | 146 | **本次收录** | `rambo-dino` |
| 32 | Turbo Tails | @petergyang | 138 | **本次收录** | `turbo-tails` |
| 33 | Lumina Zombies | @LuminaBench | 124 | 已收录（原有） | `lumina-zombies` |
| 34 | Feed the Backrooms | @LexnLin | 94 | **本次收录** | `feed-the-backrooms` |
| 35 | Thunder Valley dino chase | @loktar00 | 92 | **本次收录** | `thunder-valley` |
| 36 | The Waking River | @flxrnc | 86 | **本次收录** | `the-waking-river` |
| 37 | SKYWAKE | @aniketjart | 77 | **本次收录** | `skywake` |
| 38 | Save the World | @global_techgirl | 63 | **本次收录** | `save-the-world` |
| 39 | Ringfall | @rehan_shei | 62 | **本次收录** | `ringfall` |
| 40 | HITOFUDE | @positronx_ | 52 | **本次收录** | `hitofude` |
| 41 | Chairmageddon | @argofowl | 48 | **本次收录** | `chairmageddon` |
| 42 | VOWLORN | @higgsfield_ai | 46 | 不收录 | 链接是 Higgsfield 的博客文章，不是可玩页面 |
| 43 | Farewell Light | @RyanSael | 44 | **本次收录** | `farewell-light` |
| 44 | Stray Cat | @aimikoda | 43 | 不收录 | claude.ai artifact：同上 |
| 45 | Midnight Pass | @andreysuperior | 42 | 不收录 | claude.ai artifact：同上 |
| 46 | Survivors | @BLACKST0CK | 40 | **本次收录** | `survivors` |
| 47 | KUMOKIRI | @aniketjart | 39 | **本次收录** | `kumokiri` |
| 48 | Thermal | @loktar00 | 35 | **本次收录** | `thermal` |
| 49 | Thimble Knights | @_nilni | 34 | **本次收录** | `thimble-knights` |
| 50 | Tilt Labyrinth | @mylifcc | 32 | **本次收录** | `tilt-labyrinth` |
| 51 | Fighting game (plays on phones) | @s_shigel | 32 | 不收录 | claude.ai artifact：同上 |
| 52 | Harbor Lights Grand Prix | @Tetriss112 | 28 | **本次收录** | `harbor-lights-grand-prix` |
| 53 | Hoppy Meadow | @0xChuckstock | 26 | **本次收录** | `hoppy-meadow` |
| 54 | The Vast Horizon | @OdinLovis | 26 | **本次收录** | `the-vast-horizon` |
| 55 | Open-world kart adventure | @realWeZZard | 24 | 不收录 | claude.ai artifact：同上 |
| 56 | Giant Leap | @handsher_NGU | 23 | **本次收录** | `giant-leap` |
| 57 | BRIX '84 | @0xChuckstock | 23 | **本次收录** | `brix-84` |
| 58 | IRONDUSK — Yard 7 | @vista8 | 20 | **本次收录** | `irondusk` |
| 59 | Cozy Bakery | @goncalo_canhoto | 18 | **本次收录** | `cozy-bakery` |
| 60 | Silicon Seduction | @ZryMiller | 13 | **本次收录** | `silicon-seduction` |
| 61 | NightClub: Drift & Speed | @Story91_ | 13 | **本次收录** | `nightclub` |
| 62 | Handful: Island God | @_nilni | 11 | **本次收录** | `handful-island-god` |
| 63 | IGNITION fighting game | @s_shigel | 11 | **本次收录** | `ignition` |
| 64 | Reef Dive | @boona11 | 10 | 待复验 | wavedash 商店页，游戏本体没起来 |
| 65 | Great Wave | @_nilni | 7 | **本次收录** | `great-wave` |
| 66 | Roost | @tejas3732 | 6 | 不收录 | claude.ai artifact：同上 |
| 67 | Four-character fighting game | @promodenstudio | 4 | 不收录 | claude.ai artifact：同上 |
| 68 | Vippi | @Shrit1401 | 1 | **本次收录** | `vippi` |

## 数字

| 状态 | 条数 |
|---|---:|
| 已收录（原有） | 8 |
| 本次收录 | 43 |
| 待复验 | 6 |
| 不收录 | 11 |

## 本次收录的 43 条

第一批 17 条：Cayley、童年地毯赛车、云上叠罗汉、惬意烘焙坊、惬意里斯本、Farewell Light、巨浪、Island God、港湾灯光大奖赛、HITOFUDE、IRONDUSK、镜像地球、NightClub、Ringfall、Thimble Knights、雷谷恐龙追逐、Vippi。

第二批 26 条：BRIX ’84、椅子末日、彩色铅笔、晚祷、喂养后室、初榨、巨大的一跃、镀金与阴沟、蹦跳草甸、我本来能脱身的、IGNITION、云切、油画、拼布被、兰博恐龙、拯救世界、硅之诱惑、SKYWAKE、幸存者、辽阔地平线、醒来的河、热气流、倾斜迷宫、涡轮尾巴、体素引擎、水留下的东西。

## 还没收的 6 条

1. CROSSTOWN：7 天做纽约的早期预览，目前只到标题画面，等它把街区补完再看。
2. MAAD MAXXING：依赖 WebGPU，软件渲染和当前 Chrome 都没跑起来。
3. Frontline Warfare：Spawn 页面自己弹 "This game needs a reboot"，需要作者修。
4. Banana Mine Rush（remix.gg）、Reef Dive / Rooftop Rally（wavedash）：点开只到商店页，游戏本体没起来，等平台侧正常后再验。

## 注意

- 清单是第三方整理，作者信息与"Fable 5.2 制作"的说法来自作者推文，按 L1 记录，不改写、不夸大。
- 同一作者多作品（BlendiByl 3 条、0xChuckstock、kevin_t_ngo、_nilni、mattshumer、aniketjart、loktar00 等）共用作者页，`name` 先用 X handle，等作者认领再补真名。
- 我们**不下载、不保存、不自己跑**这些游戏的源码：站里只存封面截图和元数据，播放器用 iframe 指向作者原站；探测时也只是在浏览器里打开原页面截图。
