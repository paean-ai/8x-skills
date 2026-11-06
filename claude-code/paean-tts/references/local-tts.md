# 可选：本机离线 TTS

默认使用 Paean 云端流程。只有用户要求免费或离线，或云端服务不可用且用户接受本地替代时，才使用本文。

本 skill **不附带、也不安装**模型或运行环境。`scripts/free-tts.mjs` 只是调度器，需要使用者自行安装并维护以下命令：

- `~/.local/bin/qwen3-tts`
- `~/.local/bin/kokoro-tts`

## 先检查

`$SKILL_DIR` 是 paean-tts 技能目录（本 `references/` 的上一级）。

```sh
node "$SKILL_DIR/scripts/free-tts.mjs" --list
```

没有可用引擎时，如实告知用户并回到云端流程或等待用户决定。不要自行安装模型，不要改走 `gcloud` / Vertex AI 等计费接口，也不要未经同意退回系统语音（`say`、Siri）。

## 引擎

| `--engine` | 模型与运行环境 | 音色 | 适用 |
|---|---|---|---|
| `qwen3` | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16`，Apple Silicon MLX | `serena`、`vivian`、`uncle_fu`、`ryan`、`aiden`、`ono_anna`、`sohee`、`eric`（四川话）、`dylan`（北京话） | 需要语气控制（`--instruct`）；`--manifest` 单次加载批量合成 |
| `kokoro` | `Kokoro-82M v1.1-zh`，24 kHz ONNX | 中文男声 `zm_*`、中文女声 `zf_*`、英文 `af_maple`、`af_sol`、`bf_vale` | 轻量合成 |
| `paean` | Paean 云端 TTS | 以 `paean_tts.mjs status` 返回为准 | 必须显式指定；使用本机 Paean 登录，可能消耗账号额度 |

默认的 `--engine auto` 按 `qwen3`、`kokoro` 的顺序选择已安装的本地引擎；传入 `zm_` / `zf_` / `af_` / `bf_` 开头的音色时优先 `kokoro`。两者都未安装时直接报错，**不会**自动调用云端。

## 命令

```sh
# 单段
node "$SKILL_DIR/scripts/free-tts.mjs" --engine qwen3 --voice serena --instruct "自然清晰的叙事旁白" --speed 1.05 --text "这里是旁白文案。" --out /path/to/out.wav
node "$SKILL_DIR/scripts/free-tts.mjs" --engine kokoro --voice zm_010 --speed 1.05 --text "这里是旁白文案。" --out /path/to/out.wav

# 批量：manifest 是数组或 { "segments": [...] }，每段含 id、text，可选 voice、instruct、speed、out
node "$SKILL_DIR/scripts/free-tts.mjs" --engine qwen3 --voice serena --manifest /path/to/segments.json --out /path/to/audio-dir
```

本地合成同样要检查实际时长、可解码性和品牌名读音，并按 `SKILL.md` 的要求对齐镜头。本地文件和模型输出不进入作品发行包，除非该音频本身就是作品素材。
