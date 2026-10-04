# 双平台边界与交付

本文件定义专用版本的目标差异，和内置工作流一起使用。源代码与内容规则不能相互代替：能打包不代表具备再分发权，具备许可也不代表离线可运行。

## 目标选择

| 能力 | 小红书小工具版 | 8x / Paean 版 |
|---|---|---|
| 核心玩法 / 工具逻辑 | 本地完整可用 | 本地完整可用，按需扩展 |
| 保存 | 防异常的本地保存；失败时本轮仍可用 | 本地回退 + 经同意的云保存 |
| 排名 | 本机最佳成绩，明确标注 | SDK 真实排行榜与相应授权 |
| 联机 / 远程 AI | 离线容器不提供；核心依赖时需另行确定产品方案 | 按 SDK 文档接入真实服务 |
| 登录 / 购买 / 广告奖励 | 不带无效入口，不以占位成功结果伪造服务 | 用户选定并授权后启用，验收取消和失败状态 |
| 分享 | 宿主已有分享交互；不猜测未文档化的桥接 API | 已文档化的 SDK 分享能力 |
| 语言 | 默认简体中文，服从用户指定 | 使用用户选择的语言及一致的 locale 资源 |
| 交付位置 | Builder Hub → 小工具 | Clide hosting 或 8x Apps Square |

Red Skill 是本地 Agent 技能分发，不是上述任何一个作品容器。SDK 接入不产生发布权限，下载安装本技能也不自动授予小红书或 Paean 账号访问权限。

## 可维护的目录边界

按现有工程结构采用等价布局；新项目可用：

```text
my-work/
  source/                可维护的本地创作源
  targets/
    rednote/
      src/               从创作源派生的适配副本，保留许可
      rednote.config.json
      dist/              构建器生成，根为 index.html
      my-work-minitool.zip
    8x/                  仅在需要时生成的独立可部署目录
  media/                 演示、封面等；不混入作品运行包
  delivery.md            实际产物、差异、检查记录和发布草稿
```

转换器使用 config 所在目录作为构建根，会重建该目录下的 `dist/`，输出 `<name>-minitool.zip`。**先确认构建根属于这次适配目录**，不在用户已有线上产物目录里试跑。当前 CLI 的可靠入口是 `--config`；不要凭帮助注释假定 `--out` 可改写所有输出路径。

在适配副本移除宿主调用，保留原始 8x 代码、`.clide/publish.json`、`clide.json` 与 remix 来源信息。需要发布 8x 版时从其正确项目根运行发布脚本，使访问价格和来源关系随发布保留；不要上传整个双目标工程根、测试素材或凭证。

## 转换路径与检查命令

`SKILL_DIR` 是已安装的完整技能目录。将下面的项目路径替换成当前作品的真实绝对路径。

```bash
node "$SKILL_DIR/workflows/paean-convert-to-rednote/scripts/build-minitool.mjs" --config /path/to/my-work/targets/rednote/rednote.config.json
node "$SKILL_DIR/workflows/paean-convert-to-rednote/scripts/audit-minitool.mjs" /path/to/my-work/targets/rednote/dist
node "$SKILL_DIR/workflows/paean-convert-to-rednote/scripts/audit-minitool.mjs" /path/to/my-work/targets/rednote/my-work-minitool.zip
node "$SKILL_DIR/workflows/paean-convert-to-rednote/scripts/check-host-chrome.mjs" /path/to/my-work/targets/rednote/dist --json
node "$SKILL_DIR/workflows/paean-convert-to-rednote/scripts/check-pointer-parity.mjs" /path/to/my-work/targets/rednote/dist --json
```

按实际 HTML 标签配置 `scriptAnchor`、`stylesheetAnchor` 和 `dropTags`，不要原样复制不匹配的示例。按源码类型选 `entry` 或按顺序的 `scripts`；显式列出运行时素材 `copy`。自检若发现禁用能力，修复目标版本的真实依赖，不能通过混淆名称绕过检查。

体积审计只检查体积；禁用 API 和文件类型检查由构建器的 `selfCheck` 完成。动态检查仍要覆盖完整交互；鼠标拖拽探针不适用纯点击工具时，用实际点击→结果→重置的浏览器检查替代并记录原因。

## 小红书兼容基线

以下采用 8x 当前转换器及已有小工具适配经验（2026-09-29），不是平台永久不变的承诺；用户给出更新规范或审核反馈时先核对差异。

- 最终包 `index.html` 在 ZIP 根；全部运行时资源随包，运行时不依赖网络、账号或 Paean 宿主。
- 当前文件类型：`html css js png jpg jpeg gif webp svg woff woff2 json`。许可文本由转换器内联到 HTML，不能因 `.txt` 不允许而删掉许可。
- 当前构建基线为 Android 8.1 / Chrome 61；不保留 module/import-map、内联脚本/事件、Worker、Wasm、eval 或外部加载。
- 当前体积门槛：ZIP ≤ 10 MiB，推荐 ≤ 2 MiB。它与 Red Skill 上传界面的单文件 10 MB / 总量 30 MB **是不同约束**。
- 顶部留出宿主返回与分享按钮区域；不能只在带触摸屏的设备上显示操作按钮。Pointer Events 与布局断点需覆盖桌面窄窗鼠标操作。

本地平台适配器只用于有权免费离线分发的版本。**购买上游游戏或取得 remix 权限不自动允许将其付费内容解锁后转发。**移植付费、受限或第三方作品前核对实际许可；缺少相应授权时停在兼容性分析，不运行会解除访问限制的转换。

## 8x 登录与发布

不使用云服务的本地创作、转换和录制不需要 Paean 登录。用户选择 8x 发布、需鉴权的 remix 或 Paean TTS 配音时，使用自己的登录态。TTS 另须遵守包内 [安全要求与配音流程](../workflows/paean-tts/SKILL.md)，凭据不能进入作品或发行包：

1. 检查现有环境变量 `PAEAN_AUTH_TOKEN` 或用户本机 `~/.paean/credentials.json`、`~/.zero/credentials.json` 是否可供包内脚本使用；不打印、索取聊天粘贴或打包令牌。
2. 缺少凭证时，用已有 Zero CLI 的 `zero auth login` 完成用户登录。若没有 CLI，可由用户选择 `npx @paean-ai/zero-cli auth login`；它需要联网下载。无法使用浏览器登录时，说明由用户自行设置环境变量或凭证文件的方式。
3. 保留用户已有模型提供方、系统代理和 VPN 配置。若当前 provider 导致登录不可用，说明情况并选择独立 Paean 凭证路径，不自动运行 `zero provider clear`。
4. Remix 已知 hash 时包内脚本可工作；需要按标题/URL 查找作品且现有工具不支持时再考虑 8x MCP，不要求每位用户预装它。
5. 运行包内发布器的 `--dry-run`，检查目录、文件、secretScan、目标模式和价格。向用户解释真实外部效果，并遵从已有授权；请求仅为本地创作/转换时不追加发布。

SDK 真正运行需要 Paean / 8x 宿主。包里包括文档、适配层和本地 mock，**不包括模型服务、账户权益或完整线上宿主**；`paean-sdk.js` 的获取遵循包内 SDK 工作流，不能把 mock 当成线上服务交付。所有外部服务费用与权限按使用者账户和平台现行规则确定。
