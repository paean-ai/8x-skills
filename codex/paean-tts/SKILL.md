---
name: paean-tts
description: Generate speech assets and narration through Paean TTS using the creator's local Paean login. Use for paean tts, game dialogue, spoken tutorials, bilingual voiceovers, demo-video narration, voice samples, and resumable speech batches during creation. For dynamic in-app speech use paean-sdk; does not clone voices or install a local TTS model.
---

# Paean TTS (Codex)

通过 Paean 平台生成旁白，使用自己的 **Paean JWT** 鉴权，无需提供上游 DashScope API key；上游凭据由 Paean 服务端管理。附带的 Node.js CLI 从本机登录态读取 JWT，以 `Authorization: Bearer <Paean JWT>` 请求 `https://api.paean.ai/dashscope/tts`，保存原始 WAV，并可用 FFmpeg 做保持音高的语速调整。无需上游 key 不代表匿名调用、免费或无限额度。

> **Using this skill in Codex.** Install this directory under `~/.agents/skills/`
> or the project's `.agents/skills/` for discovery. Existing clients that already load
> `$CODEX_HOME/skills/` (default `~/.codex/skills/`) can update that directory in place.
> You can also reference `8x-skills/codex/paean-tts/SKILL.md` directly.
> Keep the bundled scripts and references beside this file; avoid duplicate installations.

## 安全要求：JWT 是账号凭据，不能随作品交付

- **仅在创作机器的本地脚本进程内读取 JWT。** 使用已有登录凭据文件或进程环境变量，不让用户把真实 token 粘贴到对话、提示词、示例代码或命令行参数。不要打印完整环境、请求头、JWT claims 或原始网络异常。
- **绝不把 JWT、API key 或凭据文件写入作品。** 包括 HTML/JS/JSON、浏览器存储、前端构建时注入的环境变量、source map、Git、日志、截图、作品 ZIP 和技能分享包。Base64、混淆和压缩不能保护前端秘密；`.gitignore` 也不能防止文件被静态服务器或 ZIP 暴露。
- **JWT 只发给固定的 `https://api.paean.ai` 合成接口。** 不放在 URL/query 或文本内容中，不直传上游服务。音频存储地址使用独立、不带 Authorization 的请求下载；不把 JWT 转发给音频域名或重定向目标。脚本对此固定 API origin，并禁用重定向。
- **作品运行时使用玩家自己的宿主登录态。** 通过 Paean SDK `ai.tts()` 和 `ai.tts` scope，由宿主处理认证；作品不得读取、保存、索要玩家 JWT，也不得借用创作者 JWT。没有宿主、权限或登录时保留文字/本地音频回退，不靠内置 token 让功能“可用”。
- **交付前检查最终目录和压缩包。** 只加入所需音频及公开资源，排除 `.env*`、凭据文件、认证头和带签名的临时音频 URL；不把整个创作工作目录直接打包。检查只报告问题文件位置，不输出秘密值。TTS helper 不负责扫描作品发行包，不能把合成成功当成凭据检查通过。分享 skill 时接收者必须使用自己的账号。
- 如发现 JWT 已进入仓库、日志或公开产物，立即停止继续分发，通知用户通过 Paean/Zero 支持的登出或会话撤销机制使其失效，再清理泄露内容；仅删除文件或改成占位符不能撤销已经泄露的凭据。

## 创作时如何选用

- 游戏角色台词、剧情旁白、教程语音、语言学习示例、演示视频解说需要固定文案音频时，采用本 skill。在创作简报中明确用途、文案、语言与音色；生成一次后将音频保存在作品素材目录或视频制作目录，播放时复用。
- 用户要求带配音的作品，或已采用的创作方案包含配音时，可在该范围内合成，不必要求用户另说“调用 TTS”。一般游戏创作不要求每个作品都加旁白。
- 玩家输入或实时 AI 对话需要动态朗读时，转到 `paean-sdk` 的 `reference/design-ai.md`，使用宿主的 `ai.tts()` 和 `ai.tts` scope；创作者 JWT 只供本地制作，不能嵌入网页。
- 小红书离线小工具禁止运行时 TTS 网络请求，当前文件白名单也不允许直接打包 WAV/MP3。可为独立演示视频配音，或为单独交付的 8x 版生成音频，不把不能运行的朗读按钮留在离线版。

## 工作边界

- 在用户请求或创作方案包含配音的范围内调用合成接口；整理文档、检查配置和测试脚本不代表允许付费合成。文字会发送到 Paean 及其语音服务，可能产生平台用量。
- 不改系统代理、VPN、全局配置；不自动安装依赖或更换用户的登录身份。
- 原配音的音色名不等于本接口音色，不承诺复刻，也不上传旧音频进行克隆。
- 保留原始音频和旧成片。只生成旁白不意味着可以改画面、文案、发布作品或覆盖已有视频。

## 快速流程

脚本在本 skill 的 `scripts/paean_tts.mjs`；下列命令以该 skill 目录为工作目录。需要 Node.js 20+；只有 `--speed` 不为 1 时需要 FFmpeg。

1. `node scripts/paean_tts.mjs credentials`：仅查看凭据保存位置、字段名、存在与过期状态。不会输出值。默认优先环境变量 `PAEAN_AUTH_TOKEN`（与 publish/remix 一致），兼容 `PAEAN_TOKEN`，其次当前用户目录的 `.paean/credentials.json`（`paean_token` / `token`），再其次 `.zero/credentials.json`（`token`）。如需指定来源，用 `--credentials FILE --token-field FIELD`，不要传 token 内容。
2. `node scripts/paean_tts.mjs status`：不带认证读取实时服务状态与音色列表。`configured: false` 时停止合成并报告服务未配置；`true` 并不证明用户登录有效或有额度。没有登录时请用户通过自己的 Paean/Zero 客户端登录；不要寻找其他人的凭据或绕过鉴权。
3. 尊重用户选定的语言、音色和文案。未定音色时按作品选择合适起点；质量依赖音色选择时先做少量同文案短句试听，再批量。已确认音色时不必重复试音。所检后端列出 `Cherry`、`Serena`、`Ethan`、`Chelsie`，实际使用前以状态接口为准；它们不是自动语言路由，中文 Cherry / 英文 Chelsie 可作为试听起点。
4. 在任务工作目录准备 UTF-8 文本，先 dry run，再实际合成：

   ```sh
   node scripts/paean_tts.mjs synthesize --text-file /path/to/vo.txt --voice Cherry --out /path/to/voice-output --dry-run
   node scripts/paean_tts.mjs synthesize --text-file /path/to/vo.txt --voice Cherry --out /path/to/voice-output
   ```

5. 多段、长旁白、语言切换、异常处理或接入其他代码时，先读 [references/api-and-production.md](references/api-and-production.md)。批处理按语义和镜头拆段，不把整个长脚本无条件塞进一个请求。
6. 检查实际生成时长、音频可解码性和品牌名读音。用可播放的音频/试听页交给用户；文件检查或 ASR 不等于已经听过。无法主观监听时明确留给用户确认，不声称音质已审核。

## 语速与镜头对齐

`/dashscope/tts` 当前仅确认支持 `text` / `voice`。不要把语气、speed、instructions、模型选择等未经证实的字段伪装成生效参数，也不要把导演指令加进会被念出的文字。

```sh
node scripts/paean_tts.mjs synthesize --text-file /path/to/vo.txt --voice Chelsie --speed 1.18 --out /path/to/voice-output
```

`--speed` 是本地 FFmpeg `atempo` 后处理，保持音高，保留原始 WAV。相同输出目录、文案和音色可以重跑并复用原音频；变更语速只渲染新速度，不重复请求云端。改变文字或音色时用新目录或新段落 id，脚本拒绝悄悄覆盖。

- “快一些”可以先尝试 1.1–1.2×，根据实测长度与用户听感调整，不把某次影片的倍率固定成全局标准。
- 同一语言/段落优先统一倍率。不要为了赶结束点只加速尾句；必要时保留合理气口、调整旁白切入时间，再向用户说明。未经许可不改文案或画面时长。
- 完整混音与 MP4 封装只在用户要求时进行；人声、BGM 和画面分别保留。确认最终混音的峰值、响度、无截字，以及画面与旁白关系。

## 重试与凭据保护

CLI 不自动重试 POST。遇 401/403 停止并让用户处理登录/权限，不自动切换另一个账号；429 按平台限制处理；5xx 或网络失败最多尝试一次单段续跑，若仍失败则报告，不循环消耗额度。网络中断可能发生在服务已生成之后，重复请求有额外计费可能。

CLI 会验证输出 WAV 和 SHA-256，断点续跑只跳过请求内容与文件校验都一致的段落。完成文件不会重复生成；遇不匹配或残留未知文件会停下，不删除用户内容。音频下载使用独立无认证请求，绝不转发 Paean JWT 给存储站点。

## 分享与安装

分享整个 `paean-tts/` 文件夹或它的 ZIP，不分享自己的凭据、生成音频或任务输出。接收者将对应版本放入自己的 skills 目录（Claude Code：`~/.claude/skills/`；Zero CLI：`~/.zero/skills/`；Codex：`~/.agents/skills/`，已有客户端使用的 `~/.codex/skills/` 可原地更新），或直接引用本文件。使用接收者自己的 Paean 登录，在能发现新 skill 的会话中调用 `paean tts`。

离线自测（不读取真实凭据，不调用付费接口）：

```sh
node --test scripts/paean_tts.test.mjs
```
