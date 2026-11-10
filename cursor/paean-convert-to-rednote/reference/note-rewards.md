# 发笔记与可选游戏奖励

适用：用户希望把 Paean IAA 的少量奖励点，或部分 IAP 道具获取方式，重新设计为小红书笔记分享。**这是按作品选择的试验方向，不是所有作品默认开启的商业化替代方案。**

## 官方依据与范围（2026-11-02 核验）

- 官方构建技能：[minitool-zip-builder 1.9.0-beta.20261023.1](https://fe-static.xhscdn.com/minitool/test/20261023/dist/minitool-zip-builder-1.9.0-beta.20261023.1.skill) 与官方 CLI 管理技能 [redapp-cli](https://fe-video-qc.xhscdn.com/fe-platform-file/104101b8326rqruuj5006b6titltg00000000038l066g4)。按用户客户端安装到技能目录，读取随包 `references/js-api.md` 与 `references/mini-tool-manifest.md`，再获取[当前小工具文档](https://miniapp-sandbox.xiaohongshu.com/minitool/doc)。随包内容用于比较，在线契约决定可用能力；后续版本按当时上传页的完整口令选择。
- `window.xhs.miniTool.postNote` 支持三种笔记类型：
  1. `pageType: 'video_publish'` + `mediaInfo: { video_resources: { video_url: videoFilePath, cover_url?: coverFilePath } }`（通过 `writeTempFile` 将 `data:video/mp4;base64,...` 落盘为本地临时路径；一旦调用 `video_publish`，严禁在 `postNote` 超时 `catch` 后再调用 `photo_publish` 覆盖原生编辑器）；
  2. `pageType: 'slides_edit'`（客户端 9.43+ 实况图片笔记）+ `mediaInfo: { live_photo_sources: [{ url: coverFilePath, video_url: videoFilePath }] }`；
  3. `pageType: 'photo_publish'` + `mediaInfo: { image_resources: [{ url: coverFilePath || coverDataUrl }] }`。
- `window.xhs.miniTool.postNote` 能带媒体、标题与正文打开原生编辑器；用户可修改或取消。不存在文档保证的“转发完成验证”“最终发布成功查询”或交易凭证接口。
- `postNote:ok` 仅表示发布页被唤起且用户点击发布，**不证明笔记最终通过审核、持续可见或真实付费**。不能拿它承诺强一致权益。
- **技术可调用不等于奖励设计获准。** 本次未找到足以确认所有小工具均可采用“发布换道具”的当前专项规则。单个游戏截图不能证明普遍许可；也不要把已失效的小程序规范或广告物料规则当成现行小工具规则。交付注明试验范围与待平台确认事项，保留纯分享模式的构建开关。

## 从 Paean 设计迁移

| 原设计 | 小红书可选设计 | 保留的边界 |
|---|---|---|
| IAA 自愿复活、提示、结算小奖励 | 在自然停顿点预览真实战报，玩家主动发笔记后获一次小奖励 | 保留拒绝、免费继续/重开；不在 demo、加载或战斗中自动唤起 |
| IAP 少量消耗品、额外装饰 | 按用户意图改为局内获取、金币兑换，或试验性分享奖励 | 明示新获取方式；不伪造支付/广告完成，不自动把所有商品替换为分享 |
| 付费入口、永久扩展、真实货币商品 | 另行设计合法授权的本地版本 | `postNote` 不能替代付费收据；不绕过原作者许可，不剥夺既有免费/已拥有权益 |

先检查游戏是否已有免费复活或全外观开放。不要为了新增分享入口重新锁住它们。奖励优先低价值、非交易、可撤销/局内使用；写清金额、上限、有效范围及不分享的玩法路径。没有合适奖励点时只做战报分享。

## 参数与内容

```js
const api = window.xhs && window.xhs.miniTool;
// 用户已预览，并主动点“编辑并发笔记”；snapshot 是本局真实画面。
const result = await api.postNote({
  title: '我的这一局',                 // 最多 20 字
  content: textWithOptionalTopics,    // 最多 1000 字
  pageType: 'photo_publish',
  mediaInfo: { image_resources: [{ url: snapshot }] },
});
// 奖励还须检查当前上下文、未取消、额度和防重，不只检查这一字段。
const publishPressed = result && result.errMsg === 'postNote:ok';
```

- 上例采用 Promise 形态，不混传 `success` / `fail` / `complete`；传任一回调后返回值为 `undefined`。同步异常、拒绝、空结果、非 Promise 异常实现都不得当作成功。
- 媒体必传，图文为 1–18 张，使用本地产物或 `data:` 图片。较大图片先 `writeTempFile({data})`，临时句柄即时使用，不作为存档。WebGL 截图先同步渲染，再读 Canvas；限制像素和体积，防止黑图、截错场景及主线程卡顿。
- 标题、正文、图片应对应真实玩法和成绩，不捏造记录，不读私人内容。先预览，再交给原生编辑器；不替玩家执行最后的发布动作。
- 用户指定的品牌话题可作为**可编辑正文文本**：`#Paean #PaeanAI #8x #8xgg #游戏中文名`。按游戏主题选用，不堆砌不相关标签。当前契约没有 `topics` / `topicIds` 参数，不发明字段，也不承诺文字自动成为已关联话题。
- `saveImageToPhotosAlbum` 只是保存图片；`interactionOpenApi` 的 `routed` 只是打开评论区且会关闭小工具。两者均不是发布笔记/评论的完成凭证。

## 奖励与返回状态

将截图、原生交互和游戏奖励拆开；共享一个奖励应用入口，来源标记为 `note-participation`，不写成 IAP 或 IAA 成功。

1. 冻结本次游戏/关卡对象、奖励种类、数量与领取意图。限制一个进行中的请求；快速连点只产生一次调用。
2. 主动操作前暂停可暂停的玩法并清空摇杆/按键。返回后仍停在明确的“继续”入口，不依赖音频恢复成功。
3. 只有明确 `postNote:ok`、上下文仍有效、未撤销且未领取，才应用一次奖励。打开编辑器、失焦、回到页面、等待足够久都不算成功。
4. 失败、取消、超时和未知结果不发奖，并允许关闭/继续游戏。取消等待、重开/切局后旧回调无效；超时回调也无效。不要自动重试原生发布。
5. 局内奖励可只绑定当前对局对象，离局失效，并明确告知；不需要为此引入付费库存。跨次使用的道具需把额度/领取意图与库存放在同一原生存档记录，处理写入失败和恢复；存储可清除，不是反作弊凭证。不要声称离线版可提供不可重复领取或跨设备交易一致性。
6. 无 SDK 或缺方法时说明需小红书客户端，可保留预览/免费玩法；不得使用线上包内的 mock 发奖。

## 验证与交付

测试最终 ZIP 的新档正常入口，以及真实鼠标模拟手机和触屏路径：预览、取消、确认、退出后恢复操作，短屏及虚拟横屏的按钮不能被宿主覆盖。用隔离 mock 覆盖明确成功、用户取消、失败、同步抛错、缺方法、空/未知结果、双击、同局二次领取、超时、取消等待后迟到、离局后迟到、资源生成失败；涉及持久奖励时加存档拒绝与重开恢复。

mock 只证明本地状态机，不证明平台发布/审核或真实 iOS 生命周期。交付试验包与开关说明，并将创服平台模拟器、Android 和 iOS 真机的编辑器打开、取消、点击发布回调、返回恢复列为待实测。测试公开发笔记须由用户明确授权，不能为了 QA 自动发帖。
