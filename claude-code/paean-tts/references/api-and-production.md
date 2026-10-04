# Paean TTS：接口与制作细节

## 已验证的契约

于 2026-10-04 根据 `zero-api` 的路由与服务源码核对；本次技能更新未调用真实合成。上线实现可能变化，执行前读取状态；返回的音色列表不等于长期固定的完整能力。

| 方法与路由 | 认证 | 输入 / 输出 |
|---|---|---|
| `GET https://api.paean.ai/dashscope/status` | 无 | `success`, `data.configured`, `data.services.tts.voices`, `data.services.tts.maxTokens` |
| `POST https://api.paean.ai/dashscope/tts` | `Authorization: Bearer <本机登录 token>` | JSON `{ "text": "…", "voice": "Cherry" }` → `success`, `data.audioUrl`, `data.requestId`, `data.textLength`, `data.voice` |

此处 Bearer token 是调用者自己的 **Paean JWT**，不是 DashScope key、公开应用标识或可随作品分发的共享 token。先遵守 [SKILL.md 的安全要求](../SKILL.md#安全要求jwt-是账号凭据不能随作品交付)。JWT 只能由本地脚本在进程内载入，不要在终端拼接真实 Authorization 字符串，也不要以 `curl -v` 或 fetch/axios 原始异常打印请求上下文。静态作品不直接携带 JWT 调用这些 REST 接口，运行时使用玩家宿主的 SDK 授权。

后端代码核对入口是 `src/routes/dashscope.routes.ts` 与 `src/services/dashscope-mcp.service.ts`。所检版本普通路由默认使用 `qwen-tts`；响应不回报解析后的模型 revision，因此只能报告“代码默认值”，不能保证当前线上具体模型版本。

同仓库还有 `/dashscope/tts-cached`（接受 `text/voice/lang/model`）及缓存 lookup，但本 helper 只用上述一次性普通接口：公共短语缓存不是长旁白的默认方案，缓存键跨用户，且 `lang` 在所检缓存实现中用于 cache key，并未透传为生成语言控制。不要仅为选新模型而偷偷切到缓存路由。所检普通路由没有开放 speed、情绪指令或 voice cloning。

### 按用途区分 API

| 用途 | 接口与契约 |
|---|---|
| 创作固定台词 / 一次性旁白 | 上述 `/dashscope/tts`；本 helper 保存音频并按本地摘要复用 |
| 后端集成的公共高频短语 | `POST /dashscope/tts-cached`，JWT，`{text, voice?, lang?, model?}`；响应 `data` 含 `audioUrl/cacheHit/hash/expiresAt`。`GET /dashscope/tts-cached/lookup` 接受相同 query 字段，响应 `data.found`，未命中也不合成。缓存不按用户隔离，不用于个人信息或私人台词 |
| 已有 OpenAI 兼容后端客户端 | `POST /v1/audio/speech`，Bearer JWT 或平台支持的 API key，`{input, voice, model?}`；`input` 上限 4096 字符，直接返回音频字节，按 `Content-Type` 保存，不解析成 JSON。模型字段默认 `tts-1`，所检实现仍调用 Qwen 引擎，不能据此声称换了模型 |
| 8x 作品运行时朗读 | 通过 Paean Web SDK `ai.tts()`，由宿主代理登录与权限；不是把上述 REST 路由或创作者 token 放入静态网页 |

兼容路由经过额度/计费中间件，并尝试将音频与输入文本保存到用户素材库。不要为了普通旁白擅自切换接口；它与普通路由的返回格式、额度和保存行为不同。所检实现没有处理 `speed`、`response_format` 或 `instructions`，不能把 OpenAI 客户端接受这些字段当成 Paean 已支持。核对入口为 `src/routes/audio.routes.ts` 与 `src/routes/index.ts`。

音频通常为 mono / 24 kHz / PCM WAV，以实际文件头为准。上游 URL 会过期，应在生成后及时保存音频；不把临时 URL 当永久交付，也不把签名写进日志。若 API 已返回本地可用媒体，可直接交付该文件，不重复生成。

## 身份选择

支持 `PAEAN_AUTH_TOKEN` 环境变量（优先）及兼容名 `PAEAN_TOKEN`，或以下固定字段（只扫描这些位置，不递归搜整个用户目录）：

- `~/.paean/credentials.json`：`paean_token`，其次 `token`。
- `~/.zero/credentials.json`：`token`。
- 自定义文件：`--credentials /path/to/credentials.json --token-field token`。

显式凭据文件优先于环境变量。自动发现选第一个非空、未检测为过期的值；JWT exp 的本地判断只是预检，不验证签名/吊销状态，最终以服务端为准。一旦请求被 401/403 拒绝，不拿其他凭据继续试。环境变量为空或过期时明确报错，不悄悄更换身份。检查命令仅输出来源、字段、present、expired，不输出 claims 或 token。

## 长旁白与批处理

status 当前提示上限 512 tokens；token 不等于字符。以语义句群/分镜拆分，每段约一至三句通常更易管理，仍须按内容和服务限制判断。不要按字节切断 UTF-8 文本，也不要把一段话拆成每个词一次请求。多语言品牌专名优先保留正确拼写；可经用户确认调整 TTS 读法，不改屏幕文案。所有发音更正都记录。

在任务目录建立 JSON：

```json
{
  "segments": [
    { "id": "zh-01", "voice": "Cherry", "text": "让想法成为可以体验的作品。" },
    { "id": "en-01", "voice": "Chelsie", "text": "Turn your idea into something playable." }
  ]
}
```

```sh
node scripts/paean_tts.mjs synthesize --manifest /path/to/segments.json --out /path/to/audio --dry-run
node scripts/paean_tts.mjs synthesize --manifest /path/to/segments.json --out /path/to/audio --speed 1.18
```

每个输出 id 仅允许字母、数字、短横线、下划线，唯一且不能是路径。单文本模式固定 id `speech`；不同文本用不同输出目录。批处理中每段明确写 voice，不根据语言自动猜选音色。全批次使用同一后处理倍率；中文、英文需要不同倍率时分成两份 manifest、各自独立输出目录。

输出：`ID.raw.wav`、`ID.receipt.json`，以及非 1× 时的 `ID.speed-X.wav`。receipt 只保存请求摘要、音色、字数、文件名、音频摘要和测量结果；没有 JWT、身份信息或签名 URL。用户文本在自己的源 txt/manifest 中，receipt 不重复存完整文本。

原始 WAV 已保存但处理失败时，再运行同一命令从原始 WAV 继续，不收费重生成。存在无法校验的遗留文件时停止，先检查或选新目录，不自动清理文件。分享本 skill 时不要将这些产物一并压缩进去。

输出目录有 `.paean-tts.lock` 防止同一批次并发重复调用。如果进程被强制终止留下锁，先确认没有仍在运行的生成进程，再由用户/代理处理这个确切的锁文件；不要自动删除锁、删除输出目录或换目录重生成整个批次。

## 错误与停止条件

| 结果 | 行动 |
|---|---|
| 无凭据 / 已过期 | 请用户在自己的客户端登录；不创建账号、不打印 token。 |
| 401 / 403 | 停止，报告登录或权限问题；不切换其他账号尝试。 |
| 400 / 413 | 检查 text、voice、分段长度；不重试同一坏输入。 |
| 429 | 停止批次，等待平台允许后由用户/任务决策继续，不并发刷重试。 |
| 5xx / 网络失败 | 只对未完成段落最多手动重试一次；请求可能已计费。 |
| 非预期媒体域名 / 重定向 | 停止，核实平台实际返回域名后再调整 allowlist；不带 JWT 跟随。 |
| 文件摘要不匹配 / id 冲突 | 保留全部文件，排查或使用新目录；不覆盖。 |

脚本固定 Paean 官方 API origin，不接受任意 API URL，防止误把登录态发往第三方。媒体仅接受 HTTPS 的 Alibaba OSS / Google Cloud Storage 已验证主机范围；历史 Alibaba HTTP URL 仅在匹配 allowlist 时升级为 HTTPS。网络请求有超时、大小上限，禁止重定向，媒体 GET 没有认证头。

## 成品检查

速度 1 表示保存原音频；其他速度要求本机 `ffmpeg`，使用 `atempo` 而非改采样率，不会同时升降音高。为简洁，CLI 不自动剪停顿、做降噪、拼接镜头、加 BGM 或重编码视频。它们属于下一步制作，应按具体任务选择。

`ffprobe` 可用于额外检查时长、声道、采样率；`ffmpeg -v error -i FILE -f null -` 可全量解码检查。主观听感、口音、专名读法与抑扬仍须试听。配乐混音应在人声出现时适当降低 BGM，避免剪掉尾字；流媒体混音可按交付要求选择响度目标，不能把某个 LUFS 数值当平台接口要求。
