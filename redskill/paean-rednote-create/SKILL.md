---
name: paean-rednote-create
description: 为小红书创作可直接体验的网页小游戏和互动小工具，将已有 HTML 作品适配为小红书离线小工具包，并按需制作演示素材、通过 Paean TTS 为视频配音或生成 8x/Paean 平台版本。适用于小红书小游戏创作、小工具移植、双平台交付；不用于抓取笔记、自动运营账号或发布 Red Skill 本身。
---

# 8x 小红书创作工坊

把创意或已有作品做成能在小红书体验的成品。默认交付简体中文的本地可用作品与小工具 ZIP；只有用户需要时才增加 8x 服务、公开部署或宣传素材。先完成当前请求，不要求用户走完整套创作流程。

## 两种包、两个运行环境

- **本技能包**：根目录是 `SKILL.md`，供用户自己的 Agent 安装。脚本在用户机器运行。
- **作品小工具包**：根目录是 `index.html`，交到 Builder Hub 的“小工具”。运行时遵守离线容器约束。
- **8x 平台版**：独立的静态作品目录，可接入 Paean SDK；发布后的真实宿主提供账号、云服务等能力。

本技能不提供小红书账号权限，也不自带模型、图像生成服务或算力。仅有普通聊天能力、不能读写文件或执行命令的助手无法完成构建。根据任务使用已有 Node.js 18+；转换需要项目中的 esbuild，浏览器验收/录制需要 Playwright 与 Chromium。ffmpeg 用于 MP4/GIF/视频海报导出，缺少时录制只能交付 WebM。图像生成是按美术需要选用的宿主能力。

把 `$SKILL_DIR` 设为**此文件所在目录**，`$WORKFLOWS` 为其 `workflows` 子目录；引用脚本时使用由此解析的绝对路径，工作目录始终是用户作品目录。安装包已内置下表资源，无须安装其他 Paean skills。若 `workflows/` 缺失，说明拿到的是发行源目录而非完整包，应取得完整发行包，不猜测本机其他安装路径。

## 按请求读取资源

先读 [双平台边界与交付](references/targets.md)，再只打开实际用到的工作流。

| 请求 | 包内资源 | 使用方式 |
|---|---|---|
| 从想法制作或完善小游戏 | [创作工作流](workflows/paean-game-create/SKILL.md)、其 `references/production-standard.md` | 采用玩法、美术、横竖屏、自动演示和验收标准；应用下述小红书差异 |
| 已有作品转小红书，或解决审核兼容问题 | [转换工作流](workflows/paean-convert-to-rednote/SKILL.md) | 在独立适配目录运行构建，不覆盖上游或 8x 版本 |
| 录制实际玩法、制作演示视频 | [录制工作流](workflows/paean-record-demo/SKILL.md) | 使用本次交付版本录制，不用 8x 特有功能冒充小红书效果 |
| 演示视频旁白、8x 版固定台词或语音教学素材 | [Paean TTS 工作流](workflows/paean-tts/SKILL.md) | 在创作机器用自己的 Paean 登录生成并保存音频；需要 Node.js 20+，无需上游语音服务 key |
| 用户明确需要 8x 云存档、排行、联机、AI 或商业化 | [SDK 工作流](workflows/paean-sdk/SKILL.md) | 只读所选能力指南，在 8x 版接入并验收 |
| 用户要求发布到 8x / Clide | [发布工作流](workflows/paean-publish/SKILL.md) | 先本地检查和 dry-run，再执行已获授权的目标模式 |
| 用户给出 8x 作品要 remix | [Remix 工作流](workflows/paean-remix/SKILL.md) | 保留来源与许可，按目标环境检查是否有权移植 |

这些内置工作流保留了 8x 原版说明。本入口定义专用版本的默认范围：

1. **运行时界面简体中文优先**，语言集中管理；用户选定其他界面语言时遵从用户。不为完成小红书版额外强制制作英文界面。发布标题、描述、标签和作品 README 则**默认英文**，仅在用户明确指定其他语言时改用该语言，不根据对话、原作或平台语言自动切换。按[发布文案标准](workflows/paean-publish/references/release-copy.md)充分表达玩法、风格、画风、主题、背景和设计特色，不写技术表达。
2. **小红书本地版不依赖 Paean 登录、SDK 或付费门控**；原版的必装 SDK、首触付费门控、平台能力计划仅用于所选的 8x 版。禁止用本地适配器绕过上游作品的付费或再分发限制。
3. 小红书的离线约束作用于作品产物，不禁止 Agent 在创作时安装依赖、获取合法素材或使用用户授权的图像工具、Paean TTS。TTS 可用于独立演示视频配音；离线小工具不能调用云 TTS，当前白名单也不允许直接打包 WAV/MP3。8x 版的动态朗读走 SDK 的 `ai.tts`，不嵌入创作者凭据。
4. 保留 8x 的成品质量标准：完整循环、真实反馈、清晰紧凑 UI、触摸与鼠标可用、横竖屏重排、低端运行降级和启动错误提示。**实用小工具按其输入→计算/交互→结果→重置流程验收**，不强加游戏胜负、自动玩法演示或游戏素材尺寸。
5. 工作流提到 `paean-zero-setup` 时，使用 [8x 登录说明](references/targets.md#8x-登录与发布)，不切换用户已有模型提供方配置。没有请求发布时，停在文件交付。

## 创作与适配

先从请求与源码确定：目标是小游戏还是实用小工具、核心交互、输入素材、预期交付平台、是否依赖网络/账号、素材权利及已有作品许可。信息足够时直接实施；缺失项若决定能否离线运行或能否再分发，先澄清该项，继续不依赖它的工作。

默认面向手机竖屏设计并兼顾横屏和桌面。让首屏展示真实用途，用户第一次操作就得到有意义的反馈。小游戏采用无需点击的干净玩法演示，实用工具直接展示可操作的输入和可信示例，避免强制登录或展示无法工作的按钮。

从创作阶段读取[事件处理与交互所有权](workflows/paean-game-create/references/input-reliability.md)：同一手势只执行一次，兼容事件共用状态；取消/滚动不提交，菜单不操作底层玩法，摇杆不同时控制镜头。保留键盘与普通按钮行为，音频失败不能阻断入口；转换后再按目标宿主验证实际事件链。

未来新上架的**游戏**在适配时读取内置转换工作流的 [RedNote 上架呈现标准](workflows/paean-convert-to-rednote/reference/rednote-release-standard.md)：自动玩法演示与入口 UI 保留不遮挡操作的真实版权／来源署名；适合横屏的游戏提供可操作的虚拟横屏按钮，并在桌面鼠标模拟手机与触屏环境实测。`© paean.ai` 只在原作权利声明支持时使用，不替其他作者冒领版权。旧作品仅在用户另行要求时修改。

保留一份可维护的 HTML/CSS/JavaScript 源码，素材本地化且有权使用。生成的新游戏按内置创作标准制作 `favicon.svg`、800×400 `banner.jpg`、512×512 `icon.jpg`；这些是 8x 素材规格，不是 Red Skill 封面规格。小红书封面依据当前发布界面单独制作。

已有作品先读代码确认真实玩法及平台调用。纯联机、远程 AI 或账号数据是核心时，说明离线版能保留什么；未经用户选择，不把产品换成假联机、假云排名或静态演示。可选云功能在小红书版隐藏，完整的本地功能保留。

按 `references/targets.md` 隔离输出，再使用包内转换流程。转换器只完成机械打包与兼容处理，中文文案、SDK 调用替换、核心功能完整性仍需在适配源码中完成。

## 官方规范、小红书专用平台能力与可选笔记奖励

官方构建基线更新为 [minitool-zip-builder 1.9.0-beta.20261023.1](https://fe-static.xhscdn.com/minitool/test/20261023/dist/minitool-zip-builder-1.9.0-beta.20261023.1.skill) 与 [redapp-cli](https://fe-video-qc.xhscdn.com/fe-platform-file/104101b8326rqruuj5006b6titltg00000000038l066g4)（可安全解压更新本地技能），配合[小工具在线文档](https://miniapp-sandbox.xiaohongshu.com/minitool/doc)使用；以后按上传页当时提供的口令选择版本。读取随包 API 基线与高消耗能力标记规范（在 `dist/` 根目录生成一字段 `mini_tool.json`：`{"is_high_consumption_scene": false}` 或 `true`）后获取在线文档，比较并播报新增公开能力，再按在线契约实现。

需要接入小红书专用排行榜（`submitScore` / `getRankList` / `getMyRank`，9.51+，使用 `submitScore` 时 `redapp submit` 必须勾选 `"USER_PROFILE"` 用户头像昵称授权，分数须在 `-1,000,000 ~ 1,000,000` 区间内，`getMyRank` 四态 `EXACT` 1–500 / `OVER_LIMIT` 500+ / `NO_SCORE` / `NOT_PARTICIPATING`）、专用云存储（`addCloudStorage` / `updateCloudStorage` / `queryCloudStorage` / `removeCloudStorage`，9.51+，单批 ≤100 条、单条 ≤64KB、150 QPS）、本地缓存（`setStorage` / `getStorage`，9.46+）、首页/顶栏引导关注创作者（`followAuthor` / `getFollowStatus`，9.51+）、卡片/图片分享（`share` `type: "card" | "image"`，9.53+）或视频/实况/图文笔记发布（`postNote` + `writeTempFile`）时，读[小红书专用平台能力与预览兜底指南](workflows/paean-convert-to-rednote/reference/xhs-platform-apis.md)。在未注入 9.51+ 白名单的审核预览环境、真机审核容器 `window.xhs.miniTool` 异步回调挂起或 0 分新档下，排行榜「提交成绩」、首页「关注创作者」、暂停页「云端备份」与结算页「发布笔记」按钮严禁设为 `disabled` 或等待异步回调，必须在 **`t = 0ms` 同步完成乐观 UI 与本地状态更新**，并将普通查询 `callXhs()` 超时收敛至 `<= 450ms`。发布动态视频笔记（`pageType: "video_publish"`）时，`writeTempFile` 须使用独立文件 I/O 超时（`5000ms`），`video_resources.cover_url` 仅传 `writeTempFile` 返回的 `filePath`（禁传原始 `data:` URI），**严禁在 `postNote({ pageType: "video_publish" })` 超时 `catch` 中回退调用 `photo_publish`**（否则 400ms 后图文发布页会直接覆盖已拉起的原生视频编辑器），并提供纯 JS H.264 Constrained Baseline（`avc1.42C01E` `I_PCM` + `faststart` MP4）编码兜底以兼容 `MediaRecorder` 仅支持 `video/webm` 的 Android WebView。支持软件横屏（`body.xhs-virtual-landscape`）时，安全区别名变量（`--top`、`--left` 等）必须同时声明在 `:root, #app, [data-xhs-orientation-root]` 上，确保软件横屏后顶部 UI 不往下避让（`--top: 0px`）、左侧 UI 往右避让（`--left: 86px`）以避开横屏左手边的小红书系统按钮；同时 3D/2D `resize()` 必须读取 `window.XHSOrientation.size()`（严禁裸读未旋转的 `window.innerWidth / window.innerHeight` 导致横屏画幅压扁），触控坐标必须通过 `window.XHSOrientation.client(x, y)` / `clientToStage(x, y)` 逆向映射。遇到「内容未通过平台综合审核」或涉及梦核/RPG/肉鸽战斗题材时，读[内容与代码双端机审净化指南](workflows/paean-convert-to-rednote/reference/content-audit-sanitization.md)。

用户希望将 IAP/IAA 转成发笔记获得道具时，读[笔记与可选奖励设计](workflows/paean-convert-to-rednote/reference/note-rewards.md)。它是按游戏选择的试验选项：保留免费玩法，预览真实画面，允许取消，限定低价值奖励并去重；**严禁在分享降级分支调用被容器审计禁止的 `navigator.clipboard`**；`postNote:ok` 不代表最终审核通过或付费收据。品牌/游戏话题写入可编辑正文，不虚构话题参数。平台是否允许该激励须单独核对，不自动发布测试笔记。

## 验收与交付

- **小游戏创作源 / 8x 版**：用内置 `paean-game-create/scripts/validate-game.mjs` 验证对应作品目录，且实际完成开始、游玩、结束和重开。不要拿它检查转换产物或实用小工具：它包含 8x 游戏素材和结构要求。
- **小红书产物**：构建器自检后，对 `dist/` 和最终 ZIP 运行 `audit-minitool.mjs` 做体积检查；运行 `check-host-chrome.mjs` 与适用的 `check-pointer-parity.mjs`，再用浏览器操作最终产物。体积检查通过不代表能力、交互或审核通过。
- **功能验收不可跳步**：每次转换/返修按[功能完整性清单](workflows/paean-convert-to-rednote/reference/input-reliability.md)从最终ZIP正常URL和新档开始，覆盖首次引导/对白及出口、短屏按钮可见、主要功能和存档重开；验证取消手势不提交、双指取消后的恢复。QA跳步和定位器自动滚动仅为辅助证据。
- **操作可靠性**：涉及摇杆、按住类动作、演示入口或无法点击的反馈时，先读[交互根因与整包回归](workflows/paean-convert-to-rednote/reference/input-reliability.md)。区分启动失败、控件显隐、混合事件/释放、坐标转换和玩法限制；检查完整兼容桥，避免重复注入。最终ZIP验证真实鼠标与触屏的世界位移、松手归零、连续操作和缩放预览；通用探针超时/未进入玩法不算通过，固定92px检测不作为当前宿主的通用规则。
- **运行检查**：阻断外部网络，检查中文、手机竖/横屏、桌面窄窗鼠标操作、结果与弹层关闭；验证存储被拒、WebGL 不可用时不会成为无响应页面。现代 Chromium 的模拟检查不能证明真实 Chrome 61 全兼容，报告实际覆盖环境。
- **素材**：新游戏的上架交付按内置转换工作流准备 14 字简介候选、与作品一致的 512×512 图标，以及从最终 ZIP 录制的 30 秒高清 MP4 和封面；单纯原型或实用工具按用户实际需求准备展示素材。无 ffmpeg 时如实说明现有格式，不把 WebM 改后缀充当 MP4。
- **交付说明**：列出实际文件、对应上传入口、功能差异与已测/未测项目。按 [交付与发布说明](references/delivery.md) 给出可直接用于笔记的草稿；发布笔记和上传作品属于独立外部操作，须在用户授权范围内执行。

不把本地检查称为“小红书审核通过”，不许诺流量、收益或免费云服务。8x 版如已发布，使用发布器返回的真实链接；未发布时交付本地目录，不虚构网址。
