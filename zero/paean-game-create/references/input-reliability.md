# 小红书交互问题：定位、修复与验收

用于转换游戏、修复「按钮无法点击／摇杆卡住／演示无法进入」时。以下来自实际转换与返修经验，不是平台拒审原因的推测，也不是所有作品都要套用的输入框架。实用工具按输入、结果、重置验证，不强加游戏摇杆。旧作品仅在本次任务涉及它们时修改。

## 先分清是哪一层失效

审核模板不能定位根因。先从最终 ZIP 解压运行，记录启动异常、画面状态、事件序列、输入值和玩家世界坐标；按这一链路缩小范围：

1. **启动**：模块是否执行完、监听是否绑定。WebGL、存储 getter、现代 API 抛错可留下有画面但无操作的页面。启动保护只负责呈现失败原因。
2. **入口和布局**：演示是否真的退出、HUD 是否出现、透明层/宿主是否挡住命中点、菜单是否仍暂停输入。
3. **输入**：down/move/up 到达哪些元素、来自哪类事件、谁持有当前手势、何时清理。
4. **玩法**：输入已正确变化，角色是否正攀爬、工作、眩晕、碰墙或等待倒计时。检查进入及退出条件，不把所有停顿改成强制瞬移。
5. **模拟与性能**：帧循环、dt、敌人/弹体/特效清理是否正常。手势值有效但世界不更新，继续查游戏逻辑或负载。

无法复现时报告条件和覆盖范围，不能仅因宽屏鼠标可以点击就排除窄屏输入问题。自动演示能动也不证明玩家控制有效。

## 已出现的错误及修正

| 症状或误判 | 根因 | 修正原则 |
|---|---|---|
| PC 手机视图没有摇杆 | 用 `pointer:coarse` / `maxTouchPoints` 决定控件显隐 | 按游戏布局决定触控 HUD，鼠标准星/hover 才按真实指针类型；窗口与软件转屏后重新求值 |
| 摇杆可见，预览拖不动 | 只监听 touch，或假定预览完整转发 Pointer Events | 以同一持有状态接入 Pointer、独立 Mouse/Touch 与必要的混合事件链；先核对已存在的兼容桥 |
| 快速第二次拖动失效 | 全局800/1200ms时间窗同时吞掉兼容尾事件和新手势 | 按来源、触点、位置及生命周期关联同一手势；新一轮真实 down 立即可用，时间窗只能辅助识别尾事件 |
| 鼠标松开仍移动，或下一次不能按 | up 被弹层截断、丢捕获、失焦或转屏未清理 | 捕获阶段监听全局释放；处理 up/cancel/lostpointercapture、blur、hidden、暂停、转屏；`buttons=0` 和新主指针可恢复漏 up |
| 两指互相抢操作 | 所有触点共用一个全局 active，或任意 touchend 都归零 | 每个控件有自己的 owner；逐个查看 `changedTouches`，只释放匹配触点；第二指可用独立动作按钮 |
| 摇杆边缘按住却不动，反向拖不顺 | 每次按下都把原点移到指尖；显示圆心和计算原点分离 | 在可见底座内以底座中心计算；底座外允许浮动起始，整个手势保持显示与计算一致 |
| 转屏后方向相反或位置跳变 | 混用物理/逻辑坐标、重复旋转、把DPR当CSS缩放 | 鼠标、触摸、按钮/展台拖动共用一次逆变换；布局、相机、画布尺寸同步更新；转屏清理旧手势 |
| 修复后一次动作触发两遍 | 已有鼠标→触摸桥，又给相同控件新增一套监听 | 检查完整入口、委托监听和兼容桥，移除重复路径或缩小旧桥范围；逐控件确认所有权 |
| 点演示无效／一点击就切两次方向 | 入口只有touch；根据 `event.detail` 判断来源；up和click重复消费 | 验证真实鼠标、触屏、仅click和兼容尾事件；方向键只切方向，不能顺便启动游戏/声音或解除暂停 |
| 暂停恢复后突然走动/放技能 | 仅清摇杆动画，键盘、动作边沿、held按钮仍残留 | 打开面板时清理完整输入状态，并明确暂停期间允许的恢复操作；恢复时从释放状态开始 |

真实案例中的边界：COLD GAS 的旧版输入类之外已有鼠标转触摸桥。隔离输入类的失败不能证明旧整包不支持鼠标；迁入统一处理时，比赛控件要退出旧桥，其他仍依赖它的控件要保留。Tiny Bistro、RUNEFALL 和飞车类作品的具体控制结构不同，不直接覆盖整套输入类。

## 实现时保持的约束

- 持有控件、普通菜单点击和方向切换不是同一种动作。为 held 按钮提供 click-only 脉冲时要有明确结束，并抑制同手势尾 click；不能把该节流策略套到所有菜单按钮。
- `setPointerCapture` 可能在合成事件上抛错，捕获不是唯一的 move/up 通路。监听可释放，重进场景不累计处理器。
- `Touch.target` 可能缺失，先安全取目标；需要回退时按 client 坐标命中，不能直接访问 `target.closest`。
- `touch-action:none`、`preventDefault` 限定在玩法控制区；处理需要阻止默认动作的监听时声明 `passive:false`。保留菜单滚动、按钮点击和文字输入。
- CSS缩放手机iframe的父页面坐标与子页client坐标不同；测试驱动负责一次映射，游戏按其自身舞台做一次逆变换。iframe只属于本地测试夹具，不打入小工具ZIP。

## 宿主占位与横竖屏

92px是早期某台带状态栏手机的合计测量，不能当成所有视口的顶部下限。区分系统安全区、实际宿主控件矩形和游戏边距；只加一次。优先模拟器注入的 `--safe-area-inset-*`，否则读取 `env()`，不支持时回退0。

本次工作区采用的布局约定：物理竖屏顶部预算为系统top+48px；物理横屏宿主在左侧时改为系统left+48px，若方向按钮也占这条侧栏则为left+86px；横屏顶部只保留系统top。这些是可调整的项目参数，需按宿主实测修订，不是官方固定尺寸。不得把胶囊局部宽度变成整条画布空带。

方向按钮独立于旋转舞台，外框32×32 CSS px，示例位置 `leftSafe+48, topSafe+10`。零安全区时处于返回键旁边；top=41时y=51。软件顺时针横屏将物理top/right/bottom/left映射为逻辑left/top/right/bottom；逆时针用对应逆映射。启动后安全区变化也要更新，不能只等resize。

`check-host-chrome.mjs` 的默认矩形只是可配置的本地模拟。用 `--viewport`、`--safe-area`、`--host-edge` 或 `--zones` 描述实测宿主。检查真实覆盖矩形和控件命中；不能因工具沿用旧规则就把正确布局改坏，也不能只降低阈值让它变绿。

## 从最终 ZIP 验证

记录ZIP SHA-256，解压同一包测试；交付副本必须字节一致。先用真实入口退出演示、开始一局，再使用必要的状态夹具隔离输入缺陷。录制用的 `record=1`、手动帧推进或暂停截图开关可能冻结循环：检查这些开关，不能把测试夹具停帧误判成游戏卡住。

| 环境/动作 | 需要证明的结果 |
|---|---|
| 手机尺寸（例如390×844）`hasTouch:false,isMobile:false`，实际鼠标 | 可见摇杆/控制按钮；能从入口进入玩法；按住产生方向正确的玩家位移，松开输入归零 |
| 同视口CDP触屏，实体设备另列 | 同样操作有效；两个触点可分别控制摇杆和动作，结束第二指不释放第一指 |
| 竖屏、软件横屏、自然横屏 | 逻辑尺寸、方向、控件位置和暂停/恢复一致，宿主遮罩下可真实点击 |
| CSS缩放手机iframe（例如0.85倍） | 带父容器偏移后仍正确命中和拖动，按可见底座边缘有即时响应 |
| 至少20轮快速左右交替按下/拖动/松开 | 不吞下一次down，无累积偏移；每轮归零，控制世界实际发生变化 |
| 纯MouseEvent、纯TouchEvent、Pointer→Mouse续接 | 各自和混合链均完成一次手势；缺少target/捕获失败不抛错 |
| 拖出控件、cancel、丢捕获、漏up后重按、buttons=0 | 状态能释放或重新获取，不永远卡住 |
| 持有中开菜单、失焦、隐藏、转屏 | 清理所有输入；恢复后重新操作，不残留移动/技能 |
| 演示退出、暂停/返回、关键动作和存档重开 | 断言业务状态；不能只检查盒子、摇柄动画、命中或截图有变化 |

世界位移要与玩家输入相关。自动前进、镜头晃动、敌人移动、粒子和摇柄动画都能改变截图；必要时对比无输入基线或按轴验证转向。功能测试中的测试夹具与人工通关分别记录。

## 报告通过、失败和未验证

- 通用pointer探针是显隐/绑定/画面反应线索，不能证明玩家移动。元素未直接绑定mouse可能由document委托或旧桥承接；“没看到控件”可能尚未进玩法。保留日志，再做项目专用状态断言。
- 探针未传 `--start` 时，空字符串不能直接 `split().map(Number)`，否则横坐标会变成0而不是默认居中，入口可能根本没打开；校验默认入口与显式坐标两条路径。
- 旧探针6个环境顺序启动、等待再测响应，固定等待就约50秒；给整个流程45秒硬截止会提前终止正常检查。采用明确的整体预算，超时输出未验证并关闭它创建的浏览器；不把超时当作产品缺陷或通过。
- 记录通用探针的失败、超时与项目专用证据，不删除不利结果。修正错误测试配置时说明原因，不能暗改断言掩盖真实失败。
- 静态审计、普通浏览器、桥接SDK模拟、创服平台模拟器、Android和iOS真机分开报告。现代Chromium通过不等于Chrome61/GPU兼容，也不等于平台审核通过。

## 演示持续播放、iOS 点击不进入（COLD GAS，2026-10-17）

先查实际最终包，不凭症状判断事件缺失。本例旧小红书包只有 `click` 入口；WebKit 原生触摸实际收到 `pointerdown → touchstart → pointerup → touchend`，但画布没有产生后续 `click`，因而一直播放演示。最新上游则是 Pointer 入口。两者都应测试独立 Touch / Mouse / click 通路；不能概括成“iOS 不支持 Pointer”。

- 入口提交只执行一次：同一完整轻触可由 Pointer、Touch 或 Mouse 的释放完成，另有 click-only 兜底；取消/拖动不能误入。记录开始时的页面，屏幕已改变时不误点新页。
- 转换到菜单/玩法的状态、清理旧输入、显示新 UI 必须先完成。音频是可选副作用，不 `await resume()` 后才切换。构造器、音频节点初始化、同步异常、Promise 拒绝/挂起/无返回值都不能阻止游戏。
- 部分音频图失败时释放该模块拥有的节点和调度器。独占上下文可以关闭；与背景音乐等模块共用的上下文只断开故障支路，避免无关声音一起失效。后续定时器、SFX 和后台恢复也应容错，保留一次可诊断日志，不让失败每帧重复报错。
- 按来源、位置和手势关联吞掉这次入场的兼容尾 click（宿主也可能发 `detail=0`），防止点穿新菜单；下一次真实 down 立即开始新操作。不要用全局冷却吞掉连续点击，也不要仅靠 `event.detail` 推断输入来源。
- 从最终 ZIP 在 Chromium 和 WebKit 分别验证原生触摸、手机尺寸真实鼠标、独立事件族与缩放 iframe；断言“演示→菜单→新手势→进入一局”。对音频节点、resume、后续 SFX/调度故障注入后仍应完成同一路径。

本地 WebKit 是定位证据，不等于 iOS 小红书容器已通过；平台模拟器、Android/iOS 扫码与存档恢复仍单列实测结果。

## 开局音效与共享上下文（SKYBREAKER / Notebook Breach，2026-10-17）

SKYBREAKER 旧包在 WebKit 原生触摸里复现了 click-only 入口无响应；Notebook Breach 的入口已含触摸释放兜底，正常触摸通过，但给 `createOscillator` 注入异常时，`createMatch()` 的开局提示音仍会打断启动。不要看到同一症状就重复改入口：跟踪到场景创建、HUD显示及一帧实际玩法。

对节点创建、连接、参数更新等音频图边界做隔离；`ready` 只能在音频图完整后置为真。失败后只禁用故障音效实例，清理其节点，不能关闭音乐模块共享的 AudioContext。验证普通音效仍工作，节点故障时仍显示HUD、移动、暂停恢复及重开；后续SFX故障也不得终止主循环。音频故障注入是确定的代码路径证据，不能替代用户设备上的根因确认。

## 2026-10-17 返修复盘：入口通过不代表功能完整

已验证的路径要分开记录：冷气飞车/破空行动涉及 WebKit 触摸没有兼容 click；纸上破局涉及音效异常、Pointer→Mouse 续接、1500ms 冷却误吞新按下、摇杆原点；雾海回声入口正常，却存在相机漏释放、单鼠标被误认成双指、取消一指后镜头失灵、怀表取消手势误提交。相同审核模板不能推出相同原因。

### 每次转换与返修都执行的验收

1. **最终包的正常首次使用**：新档、无 `qa`/`record` 等跳步参数，从演示进入引导、菜单、首个真实玩法，再走暂停/返回/重开/存档重开。至少一次覆盖首次对白、剧情、教程和其跳过/完成出口。隔离状态夹具可补充，不能替代这一条。
2. **可见且可触达**：短屏（例如320×568）、常见手机尺寸、软件横屏、自然横屏及有偏移的缩放预览。点击前检查物理边界和 `elementFromPoint`，再原生点按并断言业务状态。Playwright locator 的自动滚动、`force:true`、DOM `.click()` 不能证明首屏按钮可见；需要滚动的面板，实际滚轮/触摸滚动后再验证。进入/关闭等关键出口应留在可见区域。
3. **连续控制与取消**：真实鼠标、原生触屏、独立事件族和混合链；至少20轮连续操作；漏up、`buttons=0`、丢捕获、失焦、转屏都能恢复。单个鼠标只能有一个联系；新down恢复旧状态，不能被当作第二指缩放。两指转一指（up和cancel都测）后，剩余指可以继续拖动且不得误点。
4. **取消不等于提交**：共用held处理器必须把正常release与cancel区分。怀表拨盘、滑动确认、拖放等控件，blur/hidden/转屏/lostcapture只清理，不购买、切场景或确认选择；正常释放仍需提交一次。
5. **功能结果**：逐个列出主要可交互控件，验证实际结果与退出路径。3D调查类检查相机、缩放、物体拾取、时段切换、对白跳过/自然完成、资料页、推理记录、设置、结局及旧档；不为了套模板给无摇杆玩法强加摇杆。锁定、资源不足、碰撞等玩法限制应有反馈，与事件故障区分。
6. **证据与边界**：保留旧ZIP SHA、旧包失败/新包通过的同条件回归、事件日志及测试夹具说明；打包后再测并核对待上传副本SHA。模拟事件是定向证据，不等于原生触摸；本地WebKit不等于小红书iOS实测；静态审计不等于功能或平台审核通过。

### 测试自身也要校验

- 使用无跳步参数、真实入口后的业务状态，再下控制断言。原生触摸移动在不支持CDP的环境中若改用鼠标，要明确标注，不能报成触屏拖动通过。
- 多指夹具逐事件记录 `changedTouches`、`touches`、`pointerId`，核对释放的确实是目标触点。不要凭测试驱动参数名猜语义。
- 不靠 `.last-child` 猜当前武器，不向转屏事件发送缺少业务必需 `detail` 的假事件。先分清夹具配置错误与产品错误；保留失败及修正原因。
- 如果首次引导/对白被QA参数跳过，必须新增正常路径回归；如果按钮由自动滚动后点到，必须补短屏可触达测试。旧测试变绿不表示补齐了覆盖范围。


## 普通菜单也要防漏触发与重复提交（Hall Pass II，2026-10-17）

入口和摇杆通过后，还要走暂停/继续、重开确认、设置、奖励预览/取消及启动前存档恢复。此例普通按钮只有click；在WebKit原生触摸加touchend阻止兼容click的夹具下，“继续”无响应。该条件复现不等于确认审核员的设备根因。

- 需要兜底时，以同一手势状态处理Pointer/Touch/Mouse释放和click-only，只在正常释放、未拖动且物理命中原按钮时提交。cancel、失焦、滚动、转屏只清理；不要在down和click分别执行业务，也不要用合成click多走一次。
- 入场守卫与菜单委托必须共享尾手势信息或明确执行顺序，防止入口放行后的兼容mouseup先触发新菜单。不能只拦尾click。下一轮真实按下立即可用，不加全局冷却。
- 回归完整混合链Pointer→Touch→兼容Mouse→click、重复release、切页后的尾事件及下一次新手势，并在真实浏览器连续20次检查业务计数/开关状态。重入页面不能累积监听。
- 菜单/表单内不要由游戏输入层抢走Space、方向键；确认框Escape取消后若又冒泡到暂停处理器，会一键取消再恢复，应明确事件边界。
- 纯Touch夹具需实际阻断浏览器原生Pointer通路，不能只删除window.PointerEvent；在正常URL推进测试帧时，确认不会重复启动生产RAF。


## 预览事件顺序与旋转滚动（Hall Pass II，2026-10-17）

当前公开模拟器receiver会先派发Touch，再派发Pointer。把“原生浏览器通常Pointer先到”写成唯一去重顺序，会让Touch兜底先创建一个ID，后来的Pointer又取得第二个ID：同一拖动同时成为摇杆和镜头，暂停等动作也可能触发两次。由公开receiver在隔离iframe中复现；它与单独鼠标、单独原生触屏通过并不矛盾。

- 两个到达顺序都归入同一逻辑手势。若桥已用Touch创建所有者，配对的后到Pointer应沿用该所有者；重复down不能再次选择控制角色。真实的第二根手指仍须独立，不用粗暴屏蔽Touch或所有Pointer来修复。
- 单独摇杆测试同时断言位置变化和yaw/pitch不变；单独视角测试断言方向变化且移动输入为零。双指组合再检查独立释放。只看角色移动，发现不了镜头串动。
- 虚拟旋转面板的滚动也需要一次坐标逆变换。宿主可能在派发Touch后按物理dx/dy调用scrollBy；若应用自行处理逻辑轴，应只在该滚动区取消对应默认行为，避免宿主再次滚动。保留普通竖屏、鼠标滚轮、表单和按钮的行为，不全局替换scrollBy。
- 滚动验收加入带轻微横向/纵向偏移的连续拖动，验证目标轴单调、面板不重建/抢焦点、不会误选按钮，滚完仍能继续/返回；同时测滚轮一次增量只应用一次。
- 记录所用公开receiver版本/摘要、父容器缩放和实际浏览器输入；本地还原不等于已登录创服平台或真机验收。历史只覆盖Pointer→Touch的测试不算覆盖Touch→Pointer。

## 统一实现与标准复核（2026-10-17，已完成本地回归）

以[W3C Pointer Events](https://www.w3.org/TR/pointerevents3/)、[原生按钮键盘行为](https://www.w3.org/WAI/ARIA/apg/patterns/button/)和[touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)为基线：普通浏览器优先语义按钮/click、连续控制优先Pointer、菜单优先原生滚动。Pointer与Touch同时存在时的先后次序不能当作平台承诺；小红书不完整事件流是单独的宿主兼容条件。

实现分成四个职责：来源归并 → 触点/角色归属 → 提交或取消 → 坐标转换。此例将演示入口、普通菜单、存档引导和暂停统一到同一个释放状态机，移除入口原来复制的一组监听；持续移动/视角/按住动作继续用各自所有者，不与菜单提交混用。屏幕切换后保留尾手势，但释放仍传给清理逻辑；新按下立即可用。键盘keyup先释放持有状态，再考虑UI或defaultPrevented。

真实触摸/触笔滚动交给浏览器。此例旋转滚动区的pan-y在Chromium触摸拖动中阻止滚动，改为该区域touch-action:auto后由浏览器产生pointercancel并正常滚动，Touch事件未被preventDefault。鼠标拖动和宿主合成触摸才走逻辑坐标适配并阻止宿主第二次scrollBy。事件isTrusted仅用于区分原生与脚本滚动通路，不作为权限/发奖依据，也不全局拒绝合成click。

本例20261017.8最终离线包通过212项本地检查：18项提交状态、65项完整菜单、27项输入、80项伙伴/分享取消/存档、12项公开receiver对照、10项旋转鼠标和原生触摸。实际receiver为runtime.d7bfde59ae7bf0ef29df700d7e99d60a04f1bd202bf9ab904f1aabd68fe5a376.js（公开于miniapp-simulator），提取接收器SHA256为24c93a56132dd766ff8ac4a3deaaf8429acac0ea9f6a1c5da79e4cd22160fdba。该结果证明这个适配实例，不是所有游戏/浏览器的通用免测模板；真实平台和设备仍另验。

## 2026-10-25 补充：页面按钮全量可点击性、棋盘点选尾事件、短屏弹窗与平台能力预览兜底

针对审核退回 **「小工具功能缺陷，可能是页面按钮无法点击，重点排查页面功能完整性」**（萌宠闹翻天 `Snout Riot` 20261025.2 复盘），除启动链与摇杆外，普通 DOM 按钮、棋盘点选、选关地图、短屏/横屏模态弹窗及平台能力按钮（排行榜、云备份、关注、分享）必须逐项排查以下 7 类真因：

1. **普通按钮的 7 种输入模式与移除人工冷却窗**：
   - 旧版委托点击常见写法：只对 `pointerup (pointerType === 'touch')` 合成点击、把鼠标完全留给原生 `click`，并加 `280ms` 全局节流冷却。
   - **缺陷**：
     - 在只派发 `mousedown → mouseup`（无 `click`）或 `pointerdown → pointerup (pointerType: 'mouse')`（无 `click`）的预览器/容器中，所有按钮完全点不动；
     - 在 `pointerdown (touch) → touchend` 或 `touchstart → pointerup` 交叉序列下，若 press 与 release 只认同一事件族，释放被丢弃；
     - `280ms` 全局冷却会直接吞掉玩家连续切换关卡、切换榜单周期（总/月/周/日）或连点技能的第二次点击；
     - `button:active { transform: translateY(1px) }` 或按钮内子元素（`<span>`、`<b>`）会在 `down` 与 `up` 之间改变命中目标。
   - **修复规范**：
     - 采用**捕获阶段（capture-phase）统一释放状态机**，同时覆盖 7 种输入流：`mouse`、`touch`、`mouse-only`（无 `click`）、`touch-only`（无 `PointerEvent` 且无 `click`）、`pointer-only`（`pointerType:'mouse'` 且无 `click`）、`pointer-touch`（`pointerdown` → `touchend`）、`touch-pointer`（`touchstart` → `pointerup`）；
     - 正常释放时记录短期尾事件屏障（吸收随后 450ms 内指向同一按钮的兼容 `mouseup`/`touchend`/`click` 防止双触发），但**不设阻断下一次真实 `down` 的全局冷却窗**；
     - 全局添加 `button > * { pointer-events: none; }`，移除会导致边缘失手或位移脱靶的 `button:active` 位移变形。

2. **棋盘「两步点选交换」被兼容鼠标尾事件立即取消**：
   - 三消/棋盘类游戏常同时支持「拖拽相邻格交换」与「先点 A 格选中、再点 B 格交换」。
   - **缺陷**：当棋盘同时监听 `pointerdown/up`、`touchstart/end` 和 `mousedown/up` 时，一次触屏轻触在 `pointerup`/`touchend` 中完成 `handlePick(A)` 选中，紧接着浏览器派发的兼容 `mousedown → mouseup` 又调用一次 `handlePick(A)`，把刚选中的棋子当场取消选中！表现为“触屏只能拖拽，点选棋子毫无反应”。
   - **修复规范**：在棋盘的 `pointerdown/up` 与 `touchstart/end` 处理后设置 `450ms` 的 `boardTail` 兼容鼠标屏蔽窗，忽略紧随其后的合成 `mousedown`/`mousemove`/`mouseup`。

3. **演示页（Attract Screen）「轻触开玩」必须全屏可点**：
   - 当开场自动演示层显示「轻触开玩 / 点击屏幕开始」时，不能只把事件挂在底部按钮上。必须允许点击 `#app` 任意非次级按钮区域（排除关注、排行榜、社交停靠栏、旋转切换按钮）直接进入游戏。

4. **消除选关地图与排行榜中的 `disabled` 死按钮陷阱**：
   - **选关地图**：新档默认只解锁第 1 关时，如果地图上第 2–20 关全部渲染为 `disabled`，审核员打开地图看到满屏灰锁点不动，极易判为「页面按钮无法点击」；第 1 章的 `<` 上一章按钮若设为 `disabled` 同样像死按钮。应支持章节首尾循环切换（`<` / `>` 永不禁用），并允许点击任意关卡节点直接进入试玩/挑战。
   - **排行榜「提交成绩」、首页「关注创作者」、暂停页「云端备份」、结算页「发笔记/存相册」**：在未注入 9.51+ 原生白名单的审核预览环境或 0 分新档下，**严禁将这些按钮设为 `disabled` 或点击无响应**（详见 [小红书平台能力与预览兜底指南](../../paean-convert-to-rednote/reference/xhs-platform-apis.md)）。

5. **短屏（`320×568`）与横屏（`844×390`、虚拟横屏）模态弹窗按钮 100% 首屏可见**：
   - **缺陷**：排行榜弹窗、分享发笔记预览弹窗、暂停菜单在 `320×568` 短屏或 `844×390` 横屏下内容过高，导致底部的 `#rankSubmitBtn`、`#confirmPostNote`、`#savePosterAlbum` 被挤出 `.panel` 可视区（`rect.bottom > viewport.height`），不滚动就点不到。
   - **修复规范**：
     - 分享预览弹窗采用「左侧缩略海报 + 右侧文案输入框」紧凑并排布局（`.share-preview-wrap`）；
     - 排行榜列表 `#ranking` 设定紧凑 `max-height` 独立内滚，确保顶部分榜/周期 Tab 与底部的「提交成绩 / 刷新 / 返回」按钮 100% 留在首屏视口内；
     - 暂停菜单 `.menu-links` 改为 2 列（横屏 3 列）CSS Grid 紧凑网格（同时避免 `flex-wrap: wrap` + `gap` 触发 Chrome 61 基线告警）。

6. **JS 读取安全区 CSS 变量 `calc(...)` 返回 `NaN` 的陷阱**：
   - 当 `--top` / `--bottom` 定义为 `calc(var(--xhs-safe-top, 0px) + 50px)` 时，在 JS 中执行 `parseFloat(getComputedStyle(app).getPropertyValue('--top'))` 会得到 `NaN`（因为 `parseFloat("calc(...)")` 为 `NaN`）！
   - **修复规范**：读取由浏览器计算好像素值的属性，如 `parseFloat(getComputedStyle(app).paddingTop)` 与 `parseFloat(getComputedStyle(app).paddingBottom)`。

7. **虚拟横屏（`virtual-landscape.js`）的作用域与媒体查询陷阱**：
   - 若 `orientationStage` 只包裹 `#app` 而把 `#overlay`（模态弹窗）和 `#toast` 留在外面，切换到虚拟横屏时弹窗依然是竖屏且失去旋转后的 `--xhs-safe-*` 变量；应配置 `orientationStage: "wrap"`（将 `#app`、`#overlay`、`#toast` 一并包裹进 `[data-xhs-orientation-root]`），并将 `[data-xhs-orientation-root]` 加入 CSS 变量根选择器。
   - `virtual-landscape.js` 通过匹配 `orientation: landscape` 规则在软件横屏下注入样式，**不会**激活 `@media (min-aspect-ratio: 11/10)`；因此横屏布局规则必须统一使用 `@media (orientation: landscape)`。

## 2026-10-29 补充：真实人手 80–250ms 按压双触发、触屏切层点穿、面板入场缩放动画脱靶与 3D 延迟启动（课堂时刻 `Kirin Hill High` v1.0.4 过审复盘）

在《课堂时刻》（`Kirin Hill High`，`appId: 6ae31cb48bac1100156e489d`）提审中，`1.0.1`–`1.0.3` 连续因 **「小工具功能缺陷，可能是页面按钮无法点击，重点排查页面功能完整性」** 被驳回，而早期合成瞬时派发测试全部显示“0 报错通过”。通过改用 Playwright 原生 `page.touchscreen.tap(x, y)`、`page.mouse.down() -> wait(120ms) -> page.mouse.up()` 模拟真实人手按压时长、以及注入官方模拟器桥 `official-input-bridge.js` 做交叉复现，定位并修复了以下 6 个导致真机与 Web 模拟器失灵的根因（修复后 `1.0.4` 一次过审）：

1. **真实人手按压时长（`80–250ms`）与慢回调导致的单次点击双触发（Double-Fire）**：
   - **缺陷 1（短超时重置手势）**：若按钮去重逻辑在 `begin()` 中写了 `if (!activeGesture || now - lastDownTime > 65) { activeGesture = true; firedInGesture = false; }`，合成测试在 `0ms` 内同步派发 `down -> up` 不会暴露问题；但**真实人手或审核脚本按住按钮 `100–200ms` 后松开**时，`touchend`/`pointerup` 先触发一次回调（#1），紧接着浏览器或模拟器桥补发的兼容 `mousedown -> mouseup -> click` 因 `now - lastDownTime > 65` 被当成“全新手势”再次激活，若跨族幽灵点击判定写了 `lastTouchGhost.el !== el`（只拦截点到其它元素，不拦截同一元素），同一次点击会触发第二次回调（#2）！对于切换类按钮（暂停/继续、打开/关闭弹窗、音效开关），连触发两次等于状态瞬间弹回原样，表现为“按钮点了没反应”。
   - **缺陷 2（回调耗时超过抑制窗）**：若在执行 `handler(e)` **之前**记录 `suppressClickUntil = performance.now() + 80`，当 `handler(e)` 同步执行重逻辑（如生成 720×960 分享海报 Canvas 或重建 3D 场景耗时 `90–150ms`）时，`handler(e)` 返回时 `suppressClickUntil` 已过期，排队的原生 `click` 立即穿透并二次执行 `handler(e)`！
   - **修复规范（单手势完整生命周期 `pressed` / `completed`）**：
     - 同一物理按压周期内到达的 `pointerdown`、`touchstart`、`mousedown` 无论按住多久（`0ms` 至 `2000ms+`）全部归并到同一个 `pressed` 对象，绝不因 `> 65ms` 重置；
     - 第一个有效释放事件（`pointerup` / `touchend` / `mouseup`）消费 `pressed`，在 `handler(e)` 执行**前后双时间戳**记录 `completed`（`time: after`, `startedAt: before`），精确吸收同一次手势尾随的 `mouseup` 和 `click`（`completed.clickConsumed = true` 或触摸后 `600ms` 内的合成 `mouseup`/`click`）；
     - 下一轮真实 `pointerdown` / `touchstart` / `mousedown` 到来时立即开启新 `pressed`，保持 **0ms 人工冷却**，连点不丢帧。

2. **触屏打开/关闭浮层时的兼容尾事件点穿（Touch Tap Bleed-Through）**：
   - **缺陷**：在移动触摸链 `pointerdown -> touchstart -> pointerup -> touchend -> click` 中，当点击顶部栏按钮（如 `#btn-top-share`）在 `pointerup` 阶段立即打开 `#share-modal` 并隐藏顶部栏（`display: none`）时，同一指尖的 `touchend` 和兼容 `click` 尚未派发。随后到达的兼容 `click` 落在同一坐标 `(x, y)` 上，此时该坐标最顶层元素已变成刚展开的 `.modal-wrap` 遮罩层，直接触发遮罩层的 `click` 关闭逻辑——**弹窗刚打开 5ms 就被自己的尾随 `click` 关掉**！同理，在吸引页关闭弹窗时，`pointerup` 隐藏弹窗后，尾随 `click` 穿透到下方的 `canvas#view`，导致关闭弹窗瞬间误开局。
   - **修复规范（三层防点穿）**：
     - 在按钮 `touchend`（`{ passive: false }`）上调用 `e.preventDefault()`，既阻止移动浏览器生成兼容性鼠标/`click` 事件，又让小红书官方模拟器桥 `official-input-bridge.js` 将 `suppressSyntheticClick` 置为 `true`；
     - 安装窗口级捕获阶段守卫（`window.addEventListener('mousedown'|'mouseup'|'click', ..., true)`），在任何 UI 按钮通过 `touch` 触发后的 `450ms` 内，若合成 `mouse`/`click` 事件落在原坐标附近（`< 42px`）或目标元素已改变（`e.target !== lastButtonTap.el`），直接在捕获阶段 `preventDefault() + stopImmediatePropagation()` 吸收；
     - 模态框遮罩关闭必须使用 `{ onlySelf: true }`（要求 `down` 与 `up` 的 `e.target` 均直接为 `.modal-wrap` 本身），且吸引页画布开局必须校验 `down` 起点直接落在 `canvas` 上且 `!wasRecentButtonTap(450)`。

3. **面板入场缩放动画（`transform: scale(0.6) -> scale(1)`）导致快速点击脱靶**：
   - **缺陷**：若弹窗面板 `.panel` 设置了 `animation: pop .22s`（`from { transform: scale(.6); opacity: 0; }`），在打开弹窗后的前 `220ms` 内，面板四角的按钮（如右上角关闭键 `#btn-share-close`、底部开始键 `#btn-roles-start`）的实际视觉与命中包围盒（`getBoundingClientRect` / `elementFromPoint`）会向屏幕中心偏移 `30–60px`。审核脚本或高频点击玩家在打开面板后立即点击按钮正常坐标时，会直接点空到背景遮罩上！同理，`.act.down { transform: translateY(4px) scale(.97) }` 会在按下瞬间把按钮边缘移出指尖。
   - **修复规范**：移除所有交互面板与按钮的缩放/位移入场动画（`animation: pop`）及按下位移变形（改用 `filter: brightness(.92)` 表达按压态），确保弹窗打开 `t = 0ms` 起所有按钮几何位置 100% 稳定。

4. **长按动作键（`#btn-hold`）松手后的尾随 `click` 二次触发**：
   - **缺陷**：长按交互键同时监听了 `pointerdown`/`touchstart`/`mousedown`（启动按住动作）与兜底 `click`（短按脉冲）。当玩家按住 `> 80ms`（或按住 `>= 550ms` 完成动作后松手归零 `holdPulseT = 0`）时，松手瞬间浏览器派发的原生 `click` 再次触发 `click` 监听器，导致刚松手停止的动作又额外触发一次 `0.85s` 脉冲！
   - **修复规范**：在 `startHold` / `endHold` 中维护 `suppressHoldClickUntil = performance.now() + 600`，凡已走过 `down -> up` 按住生命周期的手势，其尾随 `click` 一律忽略。

5. **官方模拟器桥（`official-input-bridge.js`）`touchstart -> pointerdown` 逆序双槽冲突**：
   - **缺陷**：小红书 Web 模拟器桥先派发 `touchstart`，再派发 `pointerdown (pointerType: 'touch')`。若画布/摇杆去重只写了“已存在 `pointer` 则忽略 `touch`”，则先到的 `touchstart` 会占用摇杆槽 `this.stick`（`t_0`），`0.1ms` 后到达的同指 `pointerdown` 会落入 `else if (!this.look)` 抢占视角槽 `this.look`（`p_1`），导致单指拖动摇杆时视角乱转、松手残留僵尸触点。
   - **修复规范**：在 `Input.down` / `move` / `up` 中实现 `touch` ↔ `pointer` **双向配对归并**（`180ms` 内距离 `< 42px` 的异族同指事件共享同一个逻辑槽位，并在任一事件族 `up` 时同步清理配对槽位）。

6. **小屏（`320×568`）单行布局与 3D 场景延迟到 `window.load` 后启动**：
   - **缺陷**：`grid-template-columns: repeat(auto-fit, minmax(72px, 1fr))` 在 `320×568` 小屏上会折成 2 行撑爆面板高度；同时若在模块加载期同步构建大型 3D 场景并立刻启动 `requestAnimationFrame` 渲染循环，会在 SwiftShader 软件 WebGL 下吃满主线程，导致 `page.goto` 的 `load` 事件延迟 `9.8s` 才完成（触发 `check-pointer-parity.mjs` 90s 超时并阻塞首屏输入响应）。
   - **修复规范**：固定网格列数（`repeat(4, minmax(0, 1fr))`）配合紧凑内滚；同步注册 `window.__game` 与全部 `ui.on*` 按钮回调（确保 `DOMContentLoaded` 0ms 可点），仅将重度 3D 场景网格构建与 `requestAnimationFrame` 循环推迟到 `window.addEventListener('load', () => setTimeout(..., 0))` 执行，并在检测到软件渲染器（`SwiftShader` / `llvmpipe` / `ANGLE`）时将 `devicePixelRatio` 限制为 `1`、帧间隔控制在 `33–42ms`，使 `window.load` 在 `< 100ms` 内完成。

## 2026-10-30 补充：真机容器桥挂起防假死、首屏 0ms 同步绑定、窗口捕获守卫边界与紧凑视口安全区（巡房夜鉴 `Room Check` v1.0.6 过审复盘）

在《巡房夜鉴》（`Room Check`，`appId: 6ae31c5c585cfd0015cbbad0`）提审中，`1.0.5` 虽通过了本地无 `window.xhs` 的 Playwright 测试，但在小红书真机审核容器内仍报 **「小工具功能缺陷，可能是页面按钮无法点击，重点排查页面功能完整性」**。`1.0.6` 针对真机容器与本地浏览器的环境差异完成了以下 6 项关键修复并顺利过审：

1. **真机容器 `window.xhs.miniTool` 异步回调挂起导致的 `6.5s–19.5s` 按钮假死（`0ms` 乐观更新 + `<= 450ms` 短超时）**：
   - **根因**：本地浏览器中 `window.xhs` 为 `undefined`，`hasXhsApi()` 在 `0ms` 直接返回本地兜底；但在小红书真机审核容器中 `window.xhs.miniTool` 各方法均存在，而在审核沙箱或未授权白名单下调用 `followAuthor`、`getRankList`、`getMyRank`、`submitScore`、`writeTempFile`、`postNote`、`queryCloudStorage`、`addCloudStorage` 可能**永不触发 `success`/`fail` 回调**。若 `callXhs()` 超时设为 `6500ms` 且串行 `await` 2–3 个调用后才更新 UI，真机点击关注会假死 `6.5s`、打开排行榜会空白卡死 `13s`、提交成绩会卡死 `19.5s`、分享/云备份会卡死 `13s`。
   - **修复规范**：
     - 所有平台能力按钮必须在 **`t = 0ms` 同步更新本地状态与 DOM**（如 `openRankModal` 打开瞬间同步调用 `buildLeaderboardData()` 渲染完整榜单，点击 `#btn-rank-submit` 立即提升分数并刷新列表，点击 `#btn-top-follow` 立即变更为已关注状态）；
     - 将 `callXhs(name, opts, timeoutMs = 450)` 超时上限严格限制在 **`260–450ms`**，消除串行桥接调用；
     - 在 `verify-all.mjs` 中新增 **Hanging `window.xhs.miniTool` Mock 测试**（所有方法均为 `() => {}` 永不回调），断言所有按钮在 `0ms` 更新 DOM 并在 `< 650ms` 内完成 Toast 反馈。

2. **首屏 `window.load` 前 `ui.*` 回调为空导致的早点击丢弃与 `enterAttract()` 重置弹窗**：
   - **根因**：若在模块顶层绑定 DOM 按钮 `bindTapButton(el, () => ui[key] && ui[key]())`，却将初始化 `ui[key]` 的 `boot()` 整体推迟到 `window.load` 后执行，则在 `DOMContentLoaded` 到 `boot()` 完成前，首屏可见按钮的 `ui[key]` 为 `undefined`，早点击被静默丢弃；且 `boot()` 末尾调用 `enterAttract() -> hud.hideAll()` 会把用户早期打开的弹窗强行关掉。
   - **修复规范**：**同步执行 `boot()`**，使 `window.__game`、`game.state = 'attract'` 与全部 `ui.on*` 处理器在 `t = 0ms` 立即就绪；**仅将耗时的 3D 吸引页网格构建 `initAttractRoom()` 与 `requestAnimationFrame(frame)` 推迟到 `window.load` 后**，且在 `window.load` 回调中绝不调用 `hud.hideAll()` 覆盖用户已打开的弹窗或已开始的局内状态。

3. **移除首屏入口按钮的无限 CSS 动画（`animation: pulse ... infinite`）**：
   - **根因**：`#attract .cue-btn` 上的 `animation: pulse 2.4s ease-in-out infinite` 会导致自动化审核探针调用 `page.click()` 时因等待元素动画稳定而超时失败。
   - **修复规范**：禁止在主入口及核心交互按钮上使用 `infinite` CSS 动画。

4. **窗口级捕获守卫 `installGlobalTouchTailGuard` 的同元素/跨元素职责边界**：
   - **根因**：若 `window` 捕获阶段的 `absorbBleedingMouse` 无条件拦截 `lastButtonTap.x/y` 附近的所有 `mousedown`/`mouseup`/`click`（包括落在同一按钮 `lastButtonTap.el` 上的事件），不仅会使按钮自身的 `completed.clickAbsorbed` 无法置位，还会在无标记消耗的情况下吞掉紧随其后的 `mouse-only` 或编程 `.click()`。
   - **修复规范**：
     - 当事件落在**同一个按钮**（`e.target === lastButtonTap.el || lastButtonTap.el.contains(e.target)`）时，捕获守卫直接放行，由按钮自身的单手势状态机通过单次布尔位（`mouseDownAbsorbed`、`mouseUpAbsorbed`、`clickAbsorbed`）精确吸收 1 次兼容尾事件；
     - 捕获守卫**仅在事件落在不同元素**（`e.target !== lastButtonTap.el`，如按钮隐藏后露出的 `.panel-wrap` 遮罩或底层 `canvas`）且位于原坐标 `< 42px` 内时，按单次布尔位吸收 `mousedown`/`mouseup`/`click`；
     - 对 `!e.isTrusted && !e.clientX && !e.clientY && !e.detail` 的零坐标编程调用 `.click()` 直接视为新点击放行。

5. **紧凑视口媒体查询必须保留 `.panel-wrap` 的安全区 `padding`**：
   - **根因**：在 `@media (max-height: 680px)` 或 `@media (max-height: 440px)` 中将 `.panel-wrap` 的 `padding: var(--top) 16px var(--bottom)` 覆盖为 `padding: 6px 8px` / `4px 10px`，会导致高弹窗在竖屏顶部（`48px`）和虚拟横屏左侧（`86px`）侵入宿主返回键与胶囊热区。
   - **修复规范**：所有媒体查询下 `.panel-wrap` 必须保持 `padding: var(--top) var(--right) 6px var(--left)` 与 `grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr)`，配合 `.panel { max-height: 100%; }`。

6. **3D 第一人称房间探索游戏的「零死屏过场」与智能交互辅助**：
   - 移除隐藏 HUD 的漫长走廊/入睡/通话等待过场（`4.5s–8.2s`），点击 `#btn-call-desk`（报告异样并换房）与 `#btn-phone-sleep`（直接熄灯入睡）均在 `0ms` 内立即完成房间切换或结算展示；
   - 拨号面板空号点击 `#btn-dial` 自动转接 `0` 号前台总机；
   - 局内点击 `#btn-use`（调查）若准星未精确对准 `0.25m` 热点，自动朝向并激活房间内最近的交互陈设（`findBestRoomHotspot`），保证按钮在任何视角下点击都有即时可见反馈。

## 2026-11-01 补充：软件横屏（Virtual Landscape）顶部与左侧安全区避让错位根因与规范（旷野猪突 `Boar Against the Wild` v1.0.1 复盘）

在《旷野猪突：林间奇遇》（`Boar Against the Wild`，`appId: 6ae71fc63894b300150f69cb`）真机预览中，点击旋转按钮进入软件横屏（`body.xhs-virtual-landscape`）后，出现**「顶部 UI（含右侧按钮区）仍然往下避让了 `86px`，而左侧 UI 却没有往右避让左手边的小红书系统按钮」**的问题。根因与修复规范如下：

1. **CSS 自定义属性在 `:root` 层提前求值导致软件横屏后 `--top` 与 `--left` 继承竖屏值的陷阱**：
   - **根因**：点击 `#xhs-orientation-toggle` 切换到软件顺时针横屏（`body.xhs-virtual-landscape`）时，`virtual-landscape.js` 的 `syncInsets('clockwise')` 会把物理竖屏顶部的系统状态栏与返回键避让区（`--xhs-physical-chrome-top: 86px`）映射为舞台根节点 `#app`（`[data-xhs-orientation-root]`）上的行内变量：
     - `--paean-chrome-inset-top: var(--xhs-physical-chrome-right, 0px)`（即 `0px`）
     - `--paean-chrome-inset-left: var(--xhs-physical-chrome-top, 0px)`（即 `86px`）
     然而，若作品 `style.css` 仅在 `:root`（`<html>`）上声明 `--top: var(--paean-chrome-inset-top, ...)` 与 `--left: var(--paean-chrome-inset-left, ...)`，根据 CSS Custom Properties 规范，`var(...)` 会在声明它的 `:root` 节点上先求值（得到竖屏的 `--top: 86px, --left: 0px`），随后 `#app` 直接继承该求值结果，**完全忽略了 `#app` 自身行内挂载的 `--paean-chrome-inset-top: 0px` 与 `--paean-chrome-inset-left: 86px`**！
   - **修复规范**：
     - **源码声明**：所有引用 `--paean-chrome-inset-*`、`--paean-safe-*` 或 `env(safe-area-inset-*)` 的自定义属性别名（如 `--top`、`--left`、`--right`、`--bottom`、`--safe-t`、`--safe-l`），必须同时声明在 `:root, #app, [data-xhs-orientation-root]` 选择器上：
       ```css
       :root, #app, [data-xhs-orientation-root] {
         --top: var(--paean-chrome-inset-top, env(safe-area-inset-top, 0px));
         --left: var(--paean-chrome-inset-left, env(safe-area-inset-left, 0px));
       }
       ```
     - **构建管线自动兜底（`cssStageInsetAliases`）**：构建管线 `minitool.mjs` / `minitool-pipeline.mjs` 已内置 `cssStageInsetAliases()`，自动提取 `:root` / `html` 上引用 `--paean-chrome-inset-*` / `--paean-safe-*` / `--safe-area-inset-*` 的自定义属性并在产物末尾生成 `[data-xhs-orientation-root] { ... }` 重声明规则。
2. **右上角社交停靠栏（`#xhs-top-dock`）在吸引页与横屏下的贴顶并排布局**：
   - 吸引页（`#hud[hidden] ~ #xhs-top-dock`）下 `#side` 隐藏，`#xhs-top-dock` 应贴顶 `top: calc(10px + var(--top))`；
   - 横屏（`@media (max-height: 430px)` / `@media (orientation: landscape)`）下，将 `#xhs-top-dock` 并排放在 `#side` 左侧（`top: calc(12px + var(--top)); right: calc(106px + env(safe-area-inset-right, 0px))`），避免在横屏右侧往下偏移 `58px`。
3. **Playwright 横屏几何必测断言**：
   - 点击 `#xhs-orientation-toggle` 进入 `body.xhs-virtual-landscape` 后，必须同时断言：`getComputedStyle(app).getPropertyValue('--top').trim() === '0px'`、左侧状态栏 `offsetLeft >= 86`（往右避让左手边的小红书系统按钮）、顶部左/中/右各组件 `offsetTop <= 16`（不往下避让）。
