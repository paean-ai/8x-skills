# 小红书小工具专用平台能力与官方 Skill 更新指南

本文档汇总小红书（RedNote）小工具的**官方 Skill 获取与更新方式**，以及小工具专用平台能力——**引导关注创作者（`followAuthor` / `getFollowStatus`）**、**专用排行榜（`submitScore` / `getRankList` / `getMyRank`）**、**专用云存储（`addCloudStorage` / `updateCloudStorage` / `queryCloudStorage` / `removeCloudStorage`）**、**本地持久存储（`setStorage` / `getStorage`）**与**发笔记激励/存相册（`postNote` / `writeTempFile` / `saveImageToPhotosAlbum`）**的完整接入契约、错误码、UI 布局与**审核预览环境功能完整性兜底规范**。

---

## 1. 官方 Skill 下载与更新地址

小红书小工具上传页提供官方构建与审计 Skill 包（`.skill` 文件本质为标准 ZIP 归档）及 `redapp-cli` 管理工具 Skill：

- **当前官方构建规范 Skill 下载地址（`minitool-zip-builder 1.9.0-beta.20261023.1`）**：
  `https://fe-static.xhscdn.com/minitool/test/20261023/dist/minitool-zip-builder-1.9.0-beta.20261023.1.skill`
- **当前官方 CLI 管理 Skill 下载地址（`redapp-cli`）**：
  `https://fe-video-qc.xhscdn.com/fe-platform-file/104101b8326rqruuj5006b6titltg00000000038l066g4`
- **在线容器规范与公开 API 契约（实时基准）**：
  `https://miniapp-sandbox.xiaohongshu.com/minitool/doc`

### 如何下载与更新官方 `minitool-zip-builder` 与 `redapp-cli`

当需要检查或升级工作区/全局的官方 `minitool-zip-builder`（或上传页给出了新时间戳/版本号的 `.skill` 链接）时，检查归档路径安全后解压到当前 Agent 的用户级技能目录（如 `~/.gemini/config/skills/`、`~/.claude/skills/` 或 `~/.codex/skills/`），忽略 `__MACOSX`、`.DS_Store`、`._*`、隐藏文件与软链接：

```bash
SKILL_URL="https://fe-static.xhscdn.com/minitool/test/20261023/dist/minitool-zip-builder-1.9.0-beta.20261023.1.skill"
TMP_SKILL="$(mktemp -t minitool-zip-builder.XXXXXX.zip)"
curl -fsSL "$SKILL_URL" -o "$TMP_SKILL"
unzip -o "$TMP_SKILL" -d ~/.gemini/config/skills/ -x '__MACOSX/*' '*.DS_Store' '._*'
rm -f "$TMP_SKILL"
```

解压后包含：
- `minitool-zip-builder/SKILL.md`：官方工作流与交付自检要求
- `minitool-zip-builder/references/js-api.md`：随包冻结 API 基线（用于与在线文档比对新增能力）
- `minitool-zip-builder/references/mini-tool-manifest.md` & `scripts/write_manifest.mjs`：高消耗能力标记规则，在最终 `dist/` 根目录生成与 `index.html` 同级的唯一一字段 `mini_tool.json`（`{"is_high_consumption_scene": false}` 或 `true`；仅实际使用 Worker / OffscreenCanvas / WebAssembly / Unity·Cocos 引擎时为 `true`）
- `minitool-zip-builder/scripts/audit_artifact.mjs`（及 `.py`）：官方离线包静态体积与目录审计脚本

> **注意**：
> 1. 升级官方 Skill 时，务必保留 `paean-convert-to-rednote` 中沉淀的**跨端输入可靠性、虚拟横屏映射、短屏弹窗布局、视频分享跨端编码与预览环境功能兜底**规则，不要用纯静态基线覆盖项目的交互修复。
> 2. **生产环境 `redapp` CLI（`1.0.4+`）`REDAPP_SOURCE` 服务端白名单注意**：在 `https://edith.xiaohongshu.com` 生产接口中，若传入 `REDAPP_SOURCE="other"` 或 `"gemini_cli"` 会被后端拦截报错 `{"code":"API_REJECTED","message":"未登记的三方来源：..."}`；当目标客户端映射名未在服务端白名单登记时，使用已登记的通用三方 Agent 来源 `REDAPP_SOURCE="thirdAgent"`（会话记录 `.redapp-agent-session.json` 中的标准注册值）。此外，`redapp preview --file preview.json` 仅接受 `appName, iconFileId, version, pkgFileId, md5` 五个字段（不传 `appId` 或 `previewAppId`），而更新已有小工具的 `redapp submit --file submit.json` 传入 `appId` 与新版本字段。

---

## 2. 客户端版本判断与通用调用约定

容器自动注入 `window.xhs`，端能力挂载在 `window.xhs.miniTool`（AI 能力挂载在 `window.xhs.AI`）。**不要引入外部 SDK，也不要直接调用底层 bridge。**

### 2.1 客户端版本计算（`buildVersion`）

`miniToolEnv.buildVersion` 的**末三位为编译序号**，版本比较时必须忽略末三位（除以 `1000` 向下取整）：
- `9460` → 客户端 `9.46.0`（本地缓存 `setStorage` / `getStorage`）
- `9490` → 客户端 `9.49.0`（文件系统、`getWindowInfo`、`getLocation`、`interactionOpenApi`）
- `9500` → 客户端 `9.50.0`（振动 `vibrateShort` / `vibrateLong`、陀螺仪 `startGyroscope`）
- `9510` → 客户端 `9.51.0`（关注作者 `followAuthor` / `getFollowStatus`、专用排行榜、专用云存储）

```js
function readBuildVersion(launchOptions) {
  const env = launchOptions && launchOptions.miniToolEnv;
  return Number(env && env.buildVersion) || 0;
}

export async function getClientVersion() {
  const xhs = typeof window !== "undefined" ? window.xhs : null;
  const syncVer = readBuildVersion(xhs && xhs.launchOptions);
  if (syncVer) return Math.floor(syncVer / 1000);

  const miniTool = xhs && xhs.miniTool;
  if (!miniTool || typeof miniTool.getLaunchOptions !== "function") return 0;
  try {
    const opts = await callXhs("getLaunchOptions", {}, 3000);
    return Math.floor(readBuildVersion(opts) / 1000);
  } catch {
    return 0;
  }
}
```

### 2.2 带短超时的双形态调用封装与 `t = 0ms` 乐观 UI 更新铁律

在小红书真机审核容器或未开通内测白名单的沙箱中，`window.xhs.miniTool` 对象与各方法均存在，但调用 `followAuthor`、`getRankList`、`getMyRank`、`submitScore`、`writeTempFile`、`postNote`、`queryCloudStorage`、`addCloudStorage` 时可能**挂起（永不触发 `success`/`fail` 回调且 Promise 永不 settle）**。若 `timeoutMs` 设为 `6500–8000ms` 且串行 `await` 2–3 个桥接调用才更新 DOM，真机点击按钮会假死 `6.5s–20s`，直接被判「页面按钮无法点击」！

**强制实现规范**：
1. **`t = 0ms` 同步乐观更新**：点击关注作者、打开排行榜、切换榜单/周期、提交成绩、立即云备份、合并恢复、发布笔记、保存相册或 AI 润色文案时，必须在**点击同步帧（`t = 0ms`）立即更新本机存档与 DOM 状态**（发放礼遇/切换按钮文案/刷新排行榜/渲染海报），后台异步触发 `callXhs()` 并在成功时静默覆写或追加提示。
2. **单次桥接超时收敛至 `<= 450ms`**：将 `callXhs` 默认 `timeoutMs` 设为 `420ms`（上限不超过 `450ms`），严禁串行阻塞 UI。
3. **Playwright 必测 Hanging Bridge Mock**：在自动化验收脚本中注入 `window.xhs.miniTool` 与 `window.xhs.AI` 全部方法返回 `new Promise(() => {})`（永不 resolve）的挂起 Mock，强制断言所有按钮在 `t = 0ms` 完成状态切换且无报错。

```js
export function hasXhsApi(name) {
  return !!(
    typeof window !== "undefined" &&
    window.xhs &&
    window.xhs.miniTool &&
    typeof window.xhs.miniTool[name] === "function"
  );
}

export function callXhs(method, params = {}, timeoutMs = 420) {
  return new Promise((resolve, reject) => {
    if (!hasXhsApi(method)) {
      reject({ errCode: -1, errMsg: `${method}:unavailable` });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject({ errCode: 2004, timeout: true, errMsg: `${method}:timeout` });
      }
    }, timeoutMs);

    try {
      const fn = window.xhs.miniTool[method];
      const ret = fn(params);
      if (ret && typeof ret.then === "function") {
        ret.then(
          (res) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(res);
            }
          },
          (err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(err || { errCode: -1 });
            }
          },
        );
      } else {
        clearTimeout(timer);
        settled = true;
        resolve(ret || { errMsg: `${method}:ok` });
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err || { errCode: -1 });
      }
    }
  });
}
```

---

## 3. 首页与顶栏引导关注创作者（`followAuthor` / `getFollowStatus`，9.51+）

### 3.1 接口契约

- **最低版本**：客户端 `9.51+`（`clientVersion >= 9510`）。
- **无业务入参**：`followAuthor()` 与 `getFollowStatus()` 均**不接受用户 ID 参数**，关注目标由平台自动绑定当前小工具创作者。
- **`follow_status` 返回值枚举**：
  - `1`：已关注（含互相关注）
  - `2`：当前用户是小工具作者本人
  - `0`：未关注（含未登录）
  - `-1`：关注操作失败或查询失败（**注意：接口执行失败与 `getFollowStatus` 查询失败均走 `resolve` 并返回 `follow_status: -1`，不走 `reject`；失败结果不缓存**）
- **`followAuthor` 异常拒绝码（`reject` / `fail`）**：
  - `errCode: 20002`：用户关闭确认弹窗（含点击蒙层）或放弃登录
  - `errCode: 15404`：达到自然日关注引导频控上限（同一账号对同一工具每天最多展示 **10 次**确认框，第 11 次拦截；已关注或作者本人等不弹窗调用不计数）
  - `errCode: 10003`：上一次关注确认流程尚未结束，重复调用被拒

### 3.2 布局规范与审核预览环境兜底（防「按钮无法点击」）

1. **双入口或首页显式入口**：
   - **首页/封面主入口**：在首页操作区提供清晰的「＋ 关注创作者」（可带一次性首局应援福利，如「＋关注创作者 · 领应援步数」）按钮，旁配状态标签或副标题。
   - **左上角紧凑社交停靠栏（Social Dock）**：在左上角避让区（`left: calc(var(--xhs-physical-safe-left, 0px) + 88px); top: calc(var(--xhs-physical-safe-top, 0px) + 10px)`，紧邻 32×32 旋转按钮右侧）放置不随画面旋转的紧凑关注胶囊与排行榜快捷按钮。
2. **已关注状态收敛**：
   - 当 `follow_status === 1` 或 `2` 时，紧凑停靠栏中的关注按钮可自动隐藏（`hidden = true`）或显示 `已关注 ✓`，首页按钮切换为已确认状态（如 `已关注创作者 ✓` / `创作者本人 ✓`）。
   - 监听 `document.addEventListener("visibilitychange", ...)`，从宿主关注弹窗返回前台时自动重新调用 `getFollowStatus()` 刷新状态。
3. **非真机 / 审核预览环境必做兜底**：
   - 审核员在 PC 预览器或未注入 9.51+ bridge 的环境中点击「关注创作者」按钮时，**绝不能让按钮毫无反应或直接 `disabled`**！
   - 当检测到 `!hasXhsApi("followAuthor")` 或 `clientVersion < 9510` 时，点击按钮应执行**本地预览体验兜底**（例如发放一次性本地应援步数福利、将按钮文案更新为「已领应援礼 ✓」并弹出清晰 Toast 提示），确保该按钮在任何审核环境下点击都有可见的状态推进与反馈。

---

## 4. 小红书专用排行榜（`submitScore` / `getRankList` / `getMyRank`，9.51+）

> 依据《小工具云存储 & 排行榜 JS API 接入说明》，排行榜能力要求客户端 **9.51+（`9510`）** 且需平台侧为 `appId` 开通内测白名单。

### 4.1 接口与参数速查

| API | 关键入参 | 成功返回（`resolve`） | 说明 |
|---|---|---|---|
| `submitScore` | `{ board?: 1..5, score: number }` | `{ score, errMsg: "submitScore:ok" }` | `board` 默认 `1`；`score` 原值传入（不乘 100），须为有限数值且在配置区间内。一次提交自动同步总/月/周/日四榜，只保留各周期历史最高分；返回总榜历史最高分 |
| `getRankList` | `{ board?: 1..5, period?: "all" \| "month" \| "week" \| "day" }` | `{ data: [{ rank, score, nickname, avatar }], errMsg: "getRankList:ok" }` | 返回前 100 名数组，按分数降序；同分先提交者靠前。`nickname` / `avatar` 可能为 `null`，渲染时兜底为 `"小红薯"`；**仅可使用平台返回的昵称头像，严禁自行采集用户资料** |
| `getMyRank` | `{ board?: 1..5, period?: "all" \| "month" \| "week" \| "day" }` | `{ status, rank, score, errMsg: "getMyRank:ok" }` | **必须先判 `status` 再读 `rank`/`score`**：<br>• `"EXACT"`：前 10000 名内精确排名（`rank` 为正整数）<br>• `"OVER_LIMIT"`：10000 名外（`rank` 为 `null`，展示 `"10000+"`）<br>• `"NO_SCORE"`：本期无成绩（**属正常成功状态，不是报错**） |

- **周期重置规则**：`day`（每日 0 点）、`week`（每周一 0 点）、`month`（每月 1 日 0 点）均按**北京时间**重置，新一期不沿用上期成绩。

### 4.2 错误码与未知状态对账（禁止盲目重发）

| `errCode` | 含义 | 规范处理动作 |
|---|---|---|
| `1001` / `10001` | 参数不合法 | 修正 `board` 或 `score` 参数，不重试 |
| `1004` | 分数超范围或非有限值 | 检查 `Number.isFinite(score)` 与榜单配置区间 |
| `1005` / `10003` | 排行榜未授权 / 容器白名单拒绝 | 标记 `rankDenied = true`，平滑切换到本地排行榜兜底 |
| `2002` | 榜单未就绪 | **绝不能当成空榜渲染**；显示加载态并做有限次退避重试（`500ms → 1000ms → 2000ms → 4000ms`） |
| `2004` | 写入结果未知（含超时） | **严禁就地自动重发**；将本地状态标记为 `"unknown"`，下次进入排行榜时调用 `getMyRank` 对账（若 `myRank.score >= pendingScore` 则转为 `"submitted"`） |
| `2008` / `2999` | 授权服务暂不可用 / 内部错误 | 延迟 `1000ms` 重试一次，仍失败则降级本地榜 |

### 4.3 页面功能完整性铁律：本地排行榜兜底与「提交成绩」按钮永不死锁

在历次「小工具功能缺陷，可能是页面按钮无法点击」审核退回排查中，排行榜面板有两类高发陷阱：
1. **陷阱 A（空面板）**：未开通白名单或浏览器预览下打开排行榜，只显示一行“当前环境暂未开放排行榜”，列表为空。
2. **陷阱 B（禁用按钮）**：新档玩家 0 星 / 0 分时点开首页「排行榜」，面板底部的「提交成绩」按钮因为 `score === 0` 或 `!isRankNativeAvailable()` 被设为 `disabled`，审核员点击毫无反应，直接判定「按钮无法点击」。

**强制实现规范**：
- **内置丰富本地排行榜数据**：当 `!isRankNativeAvailable()` 或原生接口返回未授权/网络异常时，使用预置的本地好友/NPC 基准榜（随 `all` / `month` / `week` / `day` 周期与 `board` 维度动态换算合理分值）与玩家本机成绩合并排序，确保切换任意榜单 Tab 与周期 Tab 都有即时的列表变化。
- **「提交成绩」按钮始终可点**：
  - 不要把 `#rankSubmitBtn` 设为 `disabled`（除非正处于单次异步请求飛行中）。
  - 若玩家在 0 分新档状态下直接点击「提交成绩」，在本地/预览模式下赋予合理的体验基础分（如星星榜 `1 ★`、挑战榜基础分 `120 分`）或记录当前最高分，立即将玩家行插入榜单并高亮（`class="mine"`，显示 `我（本机）` 及精确名次 `第 N 名`），同时弹出 Toast 提示，形成完整的点击→入榜→高亮闭环。

---

## 5. 小红书专用云存储与本地存储（9.46+ / 9.51+）

### 5.1 本地缓存 `Storage` API（9.46+ / `9460`）与 `localStorage` 安全包装

1. **禁止裸读 `window.localStorage`**：
   - 在部分严格 WebView 策略下，**访问 `window.localStorage` 属性 getter 本身就会抛出 `SecurityError`**。若出现在模块顶层，整条启动链直接中断，页面停留在“有样式但所有按钮点不动”的假死状态。
   - 所有浏览器存储读写必须经 `try/catch` 包装，失败时无缝退回内存字典（`memStore`）。
2. **9.46+ 原生 `setStorage` / `getStorage` 同步与串行写入**：
   - 客户端 `9.46+`（`clientVersion >= 9460`）优先使用 `window.xhs.miniTool.getStorage({ key })` 与 `setStorage({ key, data: JSON.stringify(...) })`（单 key 上限 1MB，总上限 10MB）。
   - 启动时先完成原生 `getStorage` 读取并合并进度，**严禁用短超时直接拿空新档覆盖老存档**；写入必须串行排队，并在 `visibilitychange`、`pagehide` 以及调用会离开页面的 `postNote` / `interactionOpenApi` 前主动 flush。

### 5.2 专用云存储 `Cloud Storage` API（9.51+ / `9510` + 白名单）

云存储按「**用户 × 小工具**」隔离在平台侧，同一小红书账号换设备打开工具即可恢复存档；用户关闭云存储时平台自动清空数据。

| API | 关键入参 | 返回结构（`resolve`） | 核心规则 |
|---|---|---|---|
| `addCloudStorage` | `{ collection: string, items: [{ content: object }] }` | `{ data: [{ id, status }], errMsg }` | **注意 `content` 是对象而非 JSON 字符串**；`id` 由服务端生成；逐项 `status` 为 `"SUCCESS" \| "FAILED" \| "UNKNOWN"` |
| `updateCloudStorage` | `{ collection: string, items: [{ id: string, content: object }] }` | `{ data: [{ id, status }], errMsg }` | **整行覆盖而非字段合并**！必须传入完整 `content` 对象；同一批次禁止重复 `id` |
| `queryCloudStorage` | `{ collection?: string, ids?: string[], cursor?: string, limit?: number }` | `{ items: [{ id, collection, content }], nextCursor?, hasMore, errMsg }` | 支持三种查法：`collection + ids` 点查（不返回分页字段）、仅传 `collection` 分类分页（默认 `limit: 20`，末页 `hasMore: false` 时缺省 `nextCursor`）、都不传跨全部分类查询 |
| `removeCloudStorage` | `{ collection: string, ids: string[] }` | `{ data: [{ id, status }], errMsg }` | 硬删不可恢复，但幂等（目标不存在也返回 `SUCCESS`）；删除前确保无在途写入 |

#### 云存储关键注意事项与预览兜底

1. **批量写非事务 & 未知状态对账**：
   - 顶层 `resolve`（含 `errCode: 2003` 部分成功）不代表每一项都成功，必须检查 `res.data[i].status`。
   - 遇到 `errCode: 2004` 或单条 `status === "UNKNOWN"` 时，**严禁盲目重发 `addCloudStorage`**（会产生重复记录），应先通过 `queryCloudStorage` 查询最新快照对账，已存在 `id` 则改走 `updateCloudStorage`。
   - 单条超限（`errCode: 1003`）或批量条数超限（`errCode: 1002`）时，需精简存档结构或按 `chunk` + `complete` 清单分片写入。
2. **非破坏性进度合并（Merge Highest Progress）**：
   - 从云端恢复进度时，推荐使用**最大值合并策略**（每关星级 `Math.max(localStar, cloudStar)`、最高解锁关卡 `Math.max(localUnlocked, cloudUnlocked)`、最高分 `Math.max(localBest, cloudBest)`），避免较早的云端备份意外抹掉玩家本机刚打出的新进度。
3. **无白名单 / 审核预览环境兜底**：
   - 当 `!hasXhsApi("addCloudStorage")`、未授权（`1006` / `10003`）或在浏览器预览时，「云端备份」弹窗中的「立即备份」与「合并恢复」按钮**不得禁用或报错**，应自动读写本机独立备份快照键（如 `<prefix>.cloud.backup.v1`），并给出清晰的成功 Toast 提示。

---

## 6. 分享发笔记激励与保存相册（`postNote` / `writeTempFile` / `saveImageToPhotosAlbum`）

详细激励合规原则参见 [note-rewards.md](note-rewards.md)。在代码实现与审核排查中须遵守以下要点：

1. **三种笔记模式与标准媒体链路（Canvas → 临时文件 → 发笔记 / 存相册）**：
   - `window.xhs.miniTool.writeTempFile({ data })` 支持将 `png / jpeg / webp / gif / mp4` 的 Base64 或带 `data:` 前缀的 Data URI 写入本地临时文件，返回 `{ filePath }`（即用即弃，不可持久化）。
   - `window.xhs.miniTool.postNote` 支持三种 `pageType`：
     - **视频笔记（`pageType: "video_publish"`）**：
       ```js
       await window.xhs.miniTool.postNote({
         title,
         content,
         pageType: "video_publish",
         mediaInfo: {
           video_resources: {
             video_url: videoFilePath, // 必须为 writeTempFile(mp4DataUrl) 返回的本地路径
             ...(coverFilePath ? { cover_url: coverFilePath } : {}), // 仅在 writeTempFile(coverDataUrl) 成功返回 filePath 时传入，切勿传原始 data:image/... 字符串
           },
         },
       });
       ```
     - **实况图片笔记（`pageType: "slides_edit"`，客户端 `9.43+`）**：
       `mediaInfo: { live_photo_sources: [{ url: coverFilePath, video_url: videoFilePath }] }`（1–18 组）。
     - **图文笔记（`pageType: "photo_publish"`）**：
       `mediaInfo: { image_resources: [{ url: coverFilePath || coverDataUrl }] }`（1–18 张，`url` 可为本地 `filePath` 或 `data:` URI）。
     - **保存相册**：`window.xhs.miniTool.saveImageToPhotosAlbum({ filePath: coverFilePath || coverDataUrl })`。

2. **视频分享（`video_publish`）真机变成发图片（`photo_publish`）的四大高发根因与强制修复规范**：
   - **根因 A（`postNote` 短超时误触发 `catch` 图文降级覆盖）**：
     `postNote` 的成功回调要等到**原生发布页被唤起且用户在原生编辑器内点击发布后**才会 resolve（耗时通常数秒至数十秒）。若代码把 `await callXhs("postNote", { pageType: "video_publish", ... }, 420)` 放在 `try { ... } catch {}` 中，并在 `catch` 下方写了兜底的 `postNote({ pageType: "photo_publish" })`，那么原生视频发布页刚拉起 `420ms` 就会因为等待用户操作超时抛错进入 `catch`，随即调用 `photo_publish` 把原生视频编辑器直接覆盖成图文发布页！
     - **修复铁律**：
       1. 乐观奖励仍在点击同步帧（`t = 0ms`）立即发放，绝不阻塞 UI；
       2. `writeTempFile` 涉及数百 KB 至上 MB 的 MP4 / PNG 解码与手机闪存写入，必须使用独立的落盘超时（如 `FILE_IO_TIMEOUT_MS = 5000ms`），不可复用 `400ms` 超时；
       3. 一旦 `tmpVideo.filePath` 获取成功并调用了 `postNote({ pageType: "video_publish", ... })`，**严禁在 `postNote` 超时或异常后继续回退调用 `photo_publish`**！仅当 `writeTempFile` 未能产出 `videoFilePath` 时才可降级为 `photo_publish`。
   - **根因 B（`video_resources.cover_url` 误传 `data:image/png;base64,...`）**：
     不同于 `image_resources[].url` 支持 Data URI，`video_resources.cover_url` 要求传入 `writeTempFile` 返回的本地文件路径。若封面 `writeTempFile` 失败时把 `coverDataUrl` 直接塞进 `cover_url`，会导致 `video_publish` 参数校验失败。**修复**：严格区分 `coverFilePath` 与 `coverDataUrl`，仅在 `coverFilePath` 非空时传入 `cover_url`。
   - **根因 C（iOS WKWebView `MediaRecorder('video/mp4')` 的 `safetyTimer` 过短与 MIME 前缀带 `codecs`）**：
     iOS 硬件编码器（`VideoToolbox`）在 `recorder.stop()` 后封装 `moov` box 并完成 `FileReader.readAsDataURL` 需要 `400ms–900ms`。若 `safetyTimer` 设为 `durationMs + 450ms`，会在 `onstop` 完成前强行中断并返回 `null`。**修复**：将 `safetyTimer` 放宽至 `durationMs + 2500ms`，每帧调用 `videoTrack.requestFrame?.()`，并将读取到的 Data URI 头部统一规范化为 `'data:video/mp4;base64,' + b64`（剥离 `;codecs=avc1...` 参数），确保 `writeTempFile` 准确识别为 `.mp4`。
   - **根因 D（Android WebView 的 `MediaRecorder` 仅支持 `video/webm`，不支持 `video/mp4`）**：
     大量 Android WebView 的 `MediaRecorder.isTypeSupported('video/mp4')` 返回 `false`（仅支持 `video/webm`），而 `writeTempFile` 只接受 `mp4` 不接受 `webm`。**修复**：采用双层录制管线——优先尝试硬件 `MediaRecorder('video/mp4')`；当不可用或返回空时，自动回退到**纯 JS H.264 Constrained Baseline（`avc1.42C01E` `I_PCM` 宏块，BT.601 studio-swing `16..235` YUV420p 免防竞争字节转义 + `faststart` `ftyp + moov + mdat` ISO-BMFF 封装）编码器**，在任何 Android / iOS WebView 与桌面预览器中均可在 `< 40ms` 内从 2D Canvas 合成 100% 合规的 `data:video/mp4;base64,...` 视频流（已通过 `ffprobe` 与 Apple `AVFoundation` `avconvert` 零错误解码验证）。

3. **合理步数/道具激励设计**：
   - 可在**步数耗尽/闯关失败弹窗**提供「发笔记 +5 步续命」、在**首页/选关/局内顶栏**提供「发笔记领 +3 步开局加油包」、在**过关结算/互动剧场弹窗**提供「晒动态视频战报领奖励」。
   - 设定每日奖励上限（如每日最多 3 次激励），且**必须 100% 保留免费重开、免费下一关与正常通关路径**，不得强制发笔记才能继续游玩。
4. **绝对禁止调用 `navigator.clipboard`**：
   - **千万不要**在 `postNote` 不可用的浏览器降级分支里调用 `navigator.clipboard.writeText(...)` 或 `document.execCommand("copy")`！容器禁用剪贴板 API，且构建静态审计脚本 `audit-minitool.mjs` 会直接报错拦截（`PROBLEMS: - clipboard in assets/app.js`）。
   - 在无 `postNote` / `saveImageToPhotosAlbum` 的审核预览环境中，点击「发布小红书笔记」或「保存海报到相册」应直接完成预览闭环（发放预览态步数奖励 + 弹出 Toast 提示），保证按钮 100% 可点击、状态可验证。
