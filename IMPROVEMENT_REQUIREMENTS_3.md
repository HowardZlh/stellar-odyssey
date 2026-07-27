# 改进需求文档（第三批，R3 迭代）

> **文档版本**: 1.8（R3-3～R3-7 已交付；R3-7 银河系整体垂直展开（盘 → 扁旋转椭球体）已实现并回写）
> **参考文档**: REQUIREMENTS.md v2.8、IMPROVEMENT_REQUIREMENTS_2.md v1.1（R2-4 事件视角域软隔离）、AGENTS.md
> **状态标记**: ✅ 已完成 / 🔶 部分完成 / 🔲 未实现
> **调研说明**: §0.2 现状分析中的文件与行号已经代码调研核实（2026-07），实现时若行号漂移以符号名为准。
> **编号说明**: R3-1（视角域切换重构）与 R3-2（天体简介面板跟随巡游天体）由用户反馈直接交付，未立需求文档（登记于 CHANGELOG [Unreleased] 与提交记录）；本文档从 R3-3 起编号。

## 优先级与阶段总览

| 阶段 | 优先级 | 主题 | 对应用户反馈 | 依赖 | 状态 |
|---|---|---|---|---|---|
| R3-1 | P0 | 视角域切换重构（四巡游域/层级锁定/日球层顶点击） | 前批反馈 3 项 | — | ✅（无文档，见 CHANGELOG） |
| R3-2 | P0 | 天体简介面板跟随当前巡游天体 | 前批反馈 | R3-1 | ✅（无文档，见 CHANGELOG） |
| R3-3 | P0 | 动态事件视角域硬隔离（域外事件直接丢弃，零残留展示） | 本批反馈 | R2-4 | ✅ |
| R3-4 | P0 | 标签屏幕尺寸统一治理（近距反向缩放钳制 + 治理缺口补齐） | 本批反馈 | — | ✅ |
| R3-5 | P1 | 超新星事件视角域收窄至 L3（L4 不再触发/通知，域外丢弃） | 本批反馈 | R3-3 | ✅ |
| R3-6 | P1 | 银河系视角天体垂直展开（银纬修正默认 + 展开开关/滑块 + 高度指示线） | 本批反馈 | R3-4（标签钳制） | ✅ |
| R3-7 | P1 | 银河系整体垂直展开（银盘粒子 morph 为扁旋转椭球体 + 超新星随盘 + 银晕增亮/尘埃带渐隐） | 本批反馈（R3-6 复盘） | R3-6 | ✅ |

> 优先级依据：P0 = 交互正确性缺陷（域外事件残留提醒频繁闪现 / 标签近距放大遮挡画面，干扰用户）。

---

## 0. 背景与现状调研

### 0.1 用户反馈原文归纳

现在的事件没有按视角分类，需要按照不同的视角进行分类，对应的事件只在对应的视角下出现；如果不是该视角下的事件则**直接丢弃当前事件**。因为不同视角的时间尺度不一样，全部展示时，行星/太阳系视角下这种时间尺度小的事件（耀斑/CME 等）会频繁闪现出来。

**用户确认项**（2026-07 需求澄清，全部采纳）：
1. 已生成的超新星永久遗迹（FIFO 上限 4 个）**保留**，不随视角切换清除——遗迹是场景装饰，非"进行中事件"；
2. 合并预览进行中缩出 L4 域时，**丢弃预览并自动恢复预览前时间**（等价于用户点击"恢复预览前时间"）；
3. 防抖宽限采用**"离域持续 >1 秒才丢弃"**方案，避免连续滚轮缩放瞬间穿越域边界误丢弃；
4. 需求按项目惯例写入本文档（IMPROVEMENT_REQUIREMENTS_3.md）。

### 0.2 现状调研结论（关键锚点速查）

R2-4 已交付事件视角域**软隔离**（`src/utils/eventScopes.ts`）：事件 → 连续层级窗口映射（耀斑/CME/CME 抵达 ≤2.4、超新星 ≥2.5、合并预览 ≥3.6）+ 三层门控（自动触发域/通知可见域/演示按钮可用域）。但域外活跃事件为**软处理**，与本次"直接丢弃"诉求存在三点差距：

| # | 现状机制 | 关键位置 | 核心差距 |
|---|---|---|---|
| 1 | 域外活跃事件**状态机照常推进**（衰减/归档/CME 在途抵达排定不受视角影响），仅抑制新触发 | `src/utils/eventScopes.ts` :76-85（`eventAutoTriggerAllowed` 注释明确"域外事件状态机照常推进"）、`src/components/CelestialBody/SunActivity.tsx` :552（触发门控）、`src/components/Scene/Supernova.tsx` :335 | 域外事件不被丢弃，切回域内可能看到"半截事件"；在途 CME 抵达链（`cmeArrivalSimDays` → 极光）跨视角持续运转 |
| 2 | 域外活跃事件通知**折叠为一行小字提醒**（每个活跃事件各一行） | `src/components/UI/HudInfo.tsx` :409-428（折叠提醒渲染）、`src/utils/eventScopes.ts` :127-140（`eventOutOfScopeSummaryZh`） | 高时间压缩比下太阳事件快速开始/结束，折叠小字**频繁闪现**——用户反馈的直接来源；硬隔离要求域外零事件 UI |
| 3 | 事件状态字段散布 store：`activeSolarFlare`/`activeCme` + notice 标志（:122-133）、`cmeArrivalSimDays`/`auroraStartedAtSimDays`/`cmeArrivalNoticeVisible`（:134-142）、`activeSupernova`/`supernovaRemnants`（:114-121）、`mergePreviewActive`/`mergePreviewReturnSimDays`（:164-169） | `src/store/index.ts`（`tick` :359-386 每帧驱动，含合并预览快进插值；`restoreFromMergePreview` :734-760） | 无"按视角域批量丢弃"动作；`tick` 已具备 `realDeltaSeconds` 与 `continuousLevel`，是离域计时的天然宿主 |

相关既有语义（本次保持不变）：
- 泊松自动触发门控（`eventAutoTriggerAllowed`，域外不产生新事件）——保持；
- 演示按钮域外置灰 + tooltip（`eventDemoEnabled`/`eventDemoDisabledHintZh`，`ControlPanel.tsx` :62-68/:285-355）——保持；
- 通知可见域判定（`eventNoticeVisibleInScope`，`HudInfo.tsx` :71-76）——保持（1 秒宽限期内事件尚未被丢弃，域外仍需隐藏完整卡片，该判定继续生效作双保险）；
- 超新星"飞往观看"（`CameraController.tsx` :27-31、`cameraFocus.ts` `supernovaFocusTarget`）——保持（通知仅域内可见，飞抵落点天然在域内）；
- 锚点切换运镜 2 秒（`data/cameraViews.ts` :56）、飞往运镜 2.5 秒（`FLY_TO_SECONDS`）——离域计时豁免窗口取值依据。

---

# R3-3 动态事件视角域硬隔离（域外事件直接丢弃）

## 3.1 需求

**A. 丢弃判定纯逻辑（数据层，`src/utils/eventScopes.ts` 扩展）**
- ✅ 新增丢弃宽限常量 `EVENT_DISCARD_GRACE_SEC = 1`（**真实秒**，与模拟时间压缩比无关）：连续层级离开事件视角域窗口并**持续超过 1 秒**才执行丢弃；宽限期内折返域内则计时清零、事件保留（用户确认项 3；单测断言 <1 秒折返保留）
- ✅ 新增离域计时纯函数 `outOfScopeElapsedUpdate(prevElapsedSec, inScope, dtSec)`：域内恒返回 0（含清除运镜豁免剩余负值——域内无待丢弃事件，豁免语义自然失效，登记于函数注释），域外累加 `dtSec` 并**上钳到宽限期**（到期后保持恒值，防无界增长引发每帧状态变更，超出需求补充）；配套丢弃判定 `eventDiscardDue(elapsedSec)`（≥ 宽限即丢弃；🔶 差异登记：签名较需求原文去掉 `kind` 参数——丢弃阈值不分事件类别，kind 无需参与判定）；非有限输入抛 `RangeError`（沿用 `eventInScope` 风格，含负帧时长）
- ✅ **运镜豁免**：锚点切换过渡（`viewTransitionId` 递增后 2 秒，`VIEW_TRANSITION_DISCARD_EXEMPT_SEC`）与飞往运镜（`flyToRequestId` 递增后 2.5 秒，`FLY_TO_DISCARD_EXEMPT_SEC`）期间离域计时豁免——实现取"计时器置负值"方案（登记）：`store.tick` 检测代次变更帧将三类计时器写入负豁免窗口（`Math.min` 取更长豁免，代次经 `eventScopeSeenTransitionId`/`eventScopeSeenFlyToId` 消费），累加自负值起步运镜期间到不了宽限阈值；合并预览启动自动切 L4 的运镜途中（连续层级 <3.6）不被误杀（storeR33 单测断言）；"域内归零取消剩余豁免"不致运镜中途误丢弃——锚点间过渡路径连续层级单调、域边界至多穿越一次（登记于 eventScopes.ts）
- ✅ 丢弃计时使用真实时间、**不受暂停影响**（暂停状态下切出域超 1 秒同样丢弃——丢弃语义随视角而非模拟时间，设计决策登记于 eventScopes.ts 文件头与 store.tick 注释；单测断言暂停下丢弃且模拟时间不推进）

**B. store 丢弃动作与接入（`src/store/index.ts`）**
- ✅ 新增批量丢弃动作（二选一取"`tick` 内联执行"，登记：模块级纯辅助函数 `eventScopeDiscardUpdates(state, dtSec)` 返回本帧状态增量，由 `tick` 合入——离域计时与丢弃同帧原子完成，无独立 action 暴露面），按事件类别清空全部关联状态：
  | 事件类别 | 丢弃时清空的状态 |
  |---|---|
  | 耀斑 | `activeSolarFlare` → null、`solarFlareNoticeVisible` → false |
  | CME（含在途抵达链） | `activeCme` → null、`cmeNoticeVisible` → false、`cmeArrivalSimDays` → null、`auroraStartedAtSimDays` → null、`cmeArrivalNoticeVisible` → false |
  | 超新星 | `activeSupernova` → null（进行中的爆发动画直接终止，**不归档为遗迹**）、`supernovaNoticeVisible` → false；`supernovaRemnants` **保留**（用户确认项 1） |
  | 合并预览 | 等价调用 `restoreFromMergePreview`（终止预览并自动恢复预览前时间，用户确认项 2）；预览已自然结束（`mergePreviewActive` 为 false）后仅存的 `mergePreviewReturnSimDays`（"恢复预览前时间"按钮状态）不属"进行中事件"，**保留**不清除 |
- ✅ 丢弃驱动接入 `tick`（每帧已有 `realDeltaSeconds` 与 `continuousLevel`）：逐事件类别维护离域计时（太阳活动三类共用同一窗口故共用一枚计时器 `solarEventsOutOfScopeSec`，超新星/合并各一枚，登记），到期执行丢弃；无活跃事件时零开销（丢弃分支只做空判定；计时器域内恒 0、域外上钳到宽限期，稳态帧增量为空对象）；合并预览被丢弃帧跳过预览快进与常规时间推进（simDays 以回跳值为准）；`tick` 负增量校验上提为两分支共用（原仅预览分支显式抛 `RangeError`，非预览分支依赖 `advanceSimTimeContinuous` 抛出，语义不变，storeR33 补断言）
- ✅ 回到域内**不恢复**被丢弃的事件（无"事件历史回放"），等待下一次泊松自然触发或手动演示（单测断言回域后事件仍为 null）
- ✅ 事件计数器（`solarFlareCounter`/`cmeCounter`/`supernovaCounter`）不回退，id 单调性保持（丢弃不触碰计数器；单测断言丢弃后下一次触发 id 递增）

**C. UI 层：域外零事件残留（`src/components/UI/HudInfo.tsx`）**
- ✅ **删除"域外折叠一行小字提醒"**：移除 HudInfo 域外折叠渲染块及 `eventOutOfScopeSummaryZh` 文案函数（R2-4 §4.1-B 方案 b 废止，行为变更登记于 CHANGELOG 与 IMPROVEMENT_REQUIREMENTS_2.md §4.1-B）——域外不展示任何事件 UI，消除高压缩比下的频繁闪现（原渲染块位置留注释登记废止依据）
- ✅ 完整通知卡片的域内判定（`eventNoticeVisibleInScope`）保留：1 秒宽限期内事件仍活跃但已离域，卡片立即隐藏（丢弃与隐藏解耦——隐藏即时、丢弃迟滞 1 秒）
- ✅ 演示按钮"置灰 + tooltip"维持现状（`eventDemoEnabled`/`eventDemoDisabledHintZh` 零改动，ControlPanel.tsx 未触碰）

**D. 触发层：维持现状**
- ✅ 泊松自动触发域门控（`eventAutoTriggerAllowed`）语义不变（SunActivity.tsx/Supernova.tsx 零改动）；丢弃后的"空事件位"可被后续域内触发正常填充（触发前置条件 `activeXxx === null` 天然满足，storeR33 单测断言丢弃后再触发成功）

**E. 测试与回归**
- ✅ 新增纯逻辑单测（`eventScopes.test.ts` R3-3 套件 7 例）：离域计时（域内清零含豁免负值清除/域外累加与上钳/宽限边界/锚点与飞往双豁免窗口逐帧累加/折返重计时/非法输入含负帧时长）、丢弃判定边界（0/0.99/1/负豁免值）
- ✅ 新增 store 单测（`storeR33.test.ts` 14 例）：四类事件丢弃语义（含 CME 抵达链整链清空、超新星不归档遗迹且既有遗迹保留、合并预览恢复预览前时间、预览自然结束后"恢复"按钮状态不受离域清除、回域不恢复、计数器不回退、<1 秒折返保留、暂停下丢弃、域外长停留计时稳态、运镜豁免代次消费、tick 负增量 RangeError）
- ✅ 更新既有软隔离断言（`eventScopes.test.ts` 折叠提醒文案 2 例断言随方案废止移除并留登记注释；HudInfo 无独立折叠提醒测试套件，无需另改）；R2-4 §4.1-B"方案 b"与 §4.1-D"照常推进"语义在 IMPROVEMENT_REQUIREMENTS_2.md 登记"已被 R3-3 取代/收窄"
- ✅ 覆盖率 gate ≥90% 保持（全量 1822 用例/107 套件通过，语句 98.15%/分支 97.82%/函数 98.97%/行 99.48%，eventScopes.ts 100%）；`type-check`/`lint`/`build` 全绿；dev 服务器 3100 端口冒烟 200
- ✅ CHANGELOG [Unreleased] 修复区登记行为变更；REQUIREMENTS.md §3.1.5 同步硬隔离语义（文档版本升 2.9）

## 3.2 验收标准

- 🔶 L2 触发耀斑 + CME → 滚轮缩出至 L3/L4 停留 >1 秒：无任何事件 UI（无卡片、无折叠小字），事件被丢弃；切回 L2 无残留、无恢复；域内可再次自然触发/手动演示（状态层由 storeR33 单测断言等效场景；浏览器目验待用户验证）
- 🔶 L3 触发超新星 → 切 L1/L2 停留 >1 秒：爆发动画终止、不产生新遗迹；此前已归档的遗迹在返回 L3/L4 后仍完整可见（storeR33 单测断言；浏览器目验待用户验证）
- 🔶 L2 触发朝地球 CME（在途抵达已排定）→ 切 L3 停留 >1 秒 → 切回 L2：抵达计划与极光已整链清除，不再出现"抵达通知/极光增强"（storeR33 单测断言；浏览器目验待用户验证）
- 🔶 L4 合并预览进行中 → 滚轮缩出 L4 域（连续层级 <3.6）停留 >1 秒：预览终止且模拟时间自动恢复到预览前时刻（storeR33 单测断言 simDays 精确回跳；HUD 时间标尺复原待浏览器目验）
- 🔶 快速穿越域边界 <1 秒折返（滚轮往返）：事件保留、通知卡片恢复显示，无误丢弃（storeR33/eventScopes 单测断言宽限语义；浏览器目验待用户验证）
- 🔶 锚点切换（按 1-4）与飞往运镜期间跨越域边界不误丢弃；合并预览启动（自动切 L4 运镜）不被误杀（storeR33 单测断言豁免路径；浏览器目验待用户验证）
- 🔶 L3/L4 高压缩比下观察 ≥30 秒：无任何太阳事件相关 UI 闪现（折叠提醒渲染块已物理删除，域外无事件 UI 渲染路径；FPS 与观感待用户 npm run dev 验证）
- ✅ 单元测试全部通过（1822 用例/107 套件），覆盖率 gate ≥90% 保持（98.15%/97.82%/98.97%/99.48%）；dev 3100 冒烟 200（无头 Chrome 全场景目验未执行，登记：本迭代改动收敛于 store/纯逻辑/UI 删除路径，状态层验收由单测覆盖）

---

# R3-4 标签屏幕尺寸统一治理（近距反向缩放钳制）

## 4.0 背景与现状调研

**用户反馈原文归纳**：画面上天体相关说明文字会随画面放大而放大；当切换到较小的天体并放大时，画面会被说明文字遮挡。

**用户确认项**（2026-07 需求澄清，全部采纳推荐方案）：
1. 近距行为取"钳制住不再变大 + 焦点目标自身标签隐藏（既有机制补齐）"，非焦点标签只钳制不隐藏；
2. Galaxy"你在这里"/银河年刻度标注维持现有开关归属（受位置标记开关而非 L 键标签开关），只接入钳制；
3. 天狼星 A/B、日球层顶终端激波/日鞘等近观专用标注只接入钳制、不隐藏。

**根因**（已代码调研核实）：全部世界空间标签均为 drei `<Html distanceFactor=N>`（约 20 处，无 troika/sprite 文字），其语义为"世界空间固定大小的牌子"——屏幕缩放 ≈ `distanceFactor / (2·tan(vFOV/2)·相机距离)`，相机距离远小于 distanceFactor 时标签放大数十倍铺屏。既有治理零散：行星/卫星有 P7 近距隐藏（`Planet.tsx` 相机距 < 半径×4、`Moon.tsx` < max(1.2, 半径×6)）、L3 特殊天体/旅行者标记/L4 星系有 R2-7/R2-8 焦点隐藏；**彗星标签（df=60）完全无治理、河外天体 4 标签（df=12000）无焦点隐藏、日球层顶主标注（df=900）/奥尔特云标注（df=2600）跟随期间强制可见且无近距治理、Universe 远场标签（df=12000–14000）与 Galaxy 标记（df=2600）无近距治理**；跟随卫星时兄弟卫星标签（df=16）与母行星标签（df=60）同样随放大遮挡。无统一标签组件，`utils/` 无 label 相关纯函数。

## 4.1 需求

**A. 统一近距钳制纯逻辑（`src/utils/labelScale.ts` 新建）**
- ✅ 新增反向缩放纯函数 `labelCounterScale(distanceUnits, minDistanceUnits) = min(1, distance/minDistance)`：相机距标签锚点小于"最小生效距离"时对标签内层做反向 CSS 缩放，抵消 drei Html distanceFactor 的近距放大——屏幕尺寸恒定为最小生效距离处的大小（连续函数无跳变，等效"近距转固定像素"；与外层 `distanceFactor/(2·tan·dist)` 相乘后近距为常数，FOV 无关）；非法输入（非有限/非正 minDistance/负 distance）抛 `RangeError`
- ✅ 最小生效距离默认比例 `labelMinDistance(distanceFactor, ratio)`：默认 `LABEL_MIN_DISTANCE_RATIO = 0.5`（钳制上限 ≈ 该标签设计尺寸的 2 倍以内，具体倍数随各层级 FOV 略有差异，登记于 labelScale.ts 文件头），逐标签可传自定义 ratio 微调（🔶 差异登记：全量接入实测默认比例观感即可，未出现需要逐标签微调的场景，绝对距离覆写入口未单独提供——ratio 参数已满足微调语义）；另补量化辅助 `quantizeScale`（3 位小数，样式写入缓存比对用，超出需求补充）

**B. 共用钳制标签组件（`src/components/Scene/ClampedHtmlLabel.tsx` 新建）**
- ✅ 包装 drei `<Html>`：锚点 group 每帧取 matrixWorld 世界坐标（模块级临时向量复用，渲染循环零分配），计算相机距离 → `labelCounterScale` → 直改内层 div 的 `style.transform`（沿用项目 labelElRef 直改 DOM 模式，不经 React 重渲染；缩放值经 `quantizeScale` 量化缓存，未变化不写样式防每帧字符串分配；系数恒 1 时清空 transform）
- ✅ 透传既有 Html props（position/center/zIndexRange/style；🔶 差异登记：现有约 20 处标签实际仅使用 position/center/distanceFactor/style 四项，className/occlude 等未被任何标签使用故未纳入透传面，未来需要时补）与子元素既有 ref/opacity 直改逻辑（Planet/Comet labelElRef 淡出、Universe mergeLabelRef 文案直改均在内层 div 之内，互不干扰）

**C. 全量接入（约 20 处标签，行为不变仅补钳制）**
- ✅ 行星/矮行星（Planet df=60）、卫星（Moon df=16）、彗星（Comet df=60）
- ✅ L3 特殊天体 BodyLabel（df=2600）、天狼星 A/B 近观身份标注（df=26，只钳制不隐藏，确认项 3）
- ✅ 日球层顶：主标注（df=900，跟随期间保持可见——R2-1 语义保留，确认项）、终端激波/日鞘近观分层标注（df=520）、旅行者 1/2 号标注（df=480）
- ✅ 奥尔特云外边界标注（df=2600，跟随期间保持可见）
- ✅ Galaxy：银河年刻度进度标注 + "你在这里"（df=2600，开关归属维持现状，确认项 2）
- ✅ Universe：L4 星系名（df=9000）、MW–M31 碰撞倒计时 + 本动矢量（df=12000）、可观测宇宙边界/拉尼亚凯亚/巨引源（df=14000）
- ✅ 河外天体 4 标签（df=12000）；接入后全仓无裸 `<Html>` 标签残留（grep 断言，drei Html 仅经 ClampedHtmlLabel 使用）

**D. 治理缺口补齐（对齐既有机制）**
- ✅ 彗星标签补近距隐藏（P7 同款距离规则，阈值取 Moon 风格 max(1.2, 彗核半径×6)——彗核仅 0.18 单位，行星的半径×4 规则对彗星过小，登记）+ 跟随/飞往自身时隐藏（与行星/L3 机制对称）
- ✅ 河外天体（类星体 3C 273/触须星系/引力透镜弧/GRB 演示）补 R2-8 同款"跟随/飞往自身时隐藏标签"
- ✅ 其余既有治理（P7 近距隐藏/R2-7/R2-8 焦点隐藏/层级门控/淡出）零回退（各标签挂载条件未改动，仅 Html → ClampedHtmlLabel 替换 + 彗星/河外补隐藏条件）

**E. 测试与回归**
- ✅ labelScale 纯函数单测（`labelScale.test.ts` 9 例，覆盖率 100%）：钳制边界（=minDistance 处恰为 1 连续无阶跃）/远距恒 1/近距线性收敛/默认比例换算/量化/非法输入 RangeError
- 🔶 彗星/河外天体隐藏判定单测：差异登记——隐藏判定为组件内一行布尔（store 选择器 `followBodyId/flyToBodyId === id` 与距离比较），无独立纯函数可抽取（强行抽函数反增间接层），由既有组件挂载条件承载；纯逻辑可测部分（钳制/换算/量化）已 100% 覆盖
- ✅ 覆盖率 gate ≥90% 保持（全量 1831 用例/108 套件通过，语句 98.15%/分支 97.84%/函数 98.97%/行 99.49%，labelScale.ts 100%）；type-check/lint/build 全绿；dev 3100 冒烟 200 零错误
- ✅ CHANGELOG [Unreleased] 修复区登记；REQUIREMENTS.md §3.5.2 同步（文档版本升 3.0）

## 4.2 验收标准

- 🔶 跟随彗星/卫星/人造卫星并持续放大：任意相机距离下所有可见标签不超过其设计尺寸约 2 倍，无标签铺屏遮挡；焦点目标自身标签按既有/补齐机制隐藏（钳制数学性质由 labelScale 单测断言；浏览器目验待用户验证）
- 🔶 跟随卫星时母行星标签与兄弟卫星标签不随放大变大（钳制生效；浏览器目验待用户验证）
- 🔶 飞往日球层顶/奥尔特云：主标注保持可见（R2-1 语义，挂载条件未改动）但尺寸恒定不遮挡结构（浏览器目验待用户验证）
- 🔶 飞往河外天体（类星体等）：自身标签隐藏，取消跟随后恢复（挂载条件 `!focused` 与 R2-8 星系同款；浏览器目验待用户验证）
- ✅ 远距观感零回退：常规视角（各锚点）下标签尺寸与现状一致（距离 ≥ minDistance 时 counter-scale 恒 1 且清空 transform，单测断言远距恒 1）
- 🔶 60 FPS 不跌破（每帧仅距离计算 + 量化缓存的样式写入，约 20 处标签且按层级门控大多不同时挂载；FPS 实测待用户验证）；✅ 单测全通过（1831 用例/108 套件）、覆盖率 gate ≥90% 保持


---

# R3-5 超新星事件视角域收窄至 L3（宇宙视角不再出现超新星事件）

## 5.0 背景

**用户反馈**：宇宙视角（L4）下仍会出现"💥 超新星爆发！"事件通知。原设计（R2-4）超新星窗口为 [2.5, 4]（L3/L4 均属域内），L4 高时间压缩比（2000 万年/秒）下泊松触发约每 3 真实秒一次，通知频繁弹出；超新星为单恒星尺度事件，宇宙视角的星系间尺度下不宜再弹此类通知。**用户确认采用方向 1**：收窄到仅 L3，L4 下按 R3-3 硬隔离丢弃。

## 5.1 需求

- ✅ `eventScopes.ts` 新增 `SUPERNOVA_EVENT_MAX_LEVEL = 3.5`，超新星窗口收窄为 **[2.5, 3.5]**（与合并预览下缘 3.6 互补无重叠，单测断言）；L4 下自动触发抑制、通知隐藏、演示按钮置灰、活跃事件按 R3-3 硬隔离 1 秒宽限后丢弃（全部经既有三层门控/丢弃链路自动生效，零新增接线）
- ✅ 特效淡出窗口同步收窄（避免"特效可见但事件被丢弃"的不一致）：`Supernova.tsx` `snFadeWeight` 由 trapezoid(2.5, 2.9, 4.5, 5) 收窄为 **trapezoid(2.5, 2.9, 3.5, 4.0)**——满值平台终点 3.5 = 域上缘，淡出延伸至 L4 锚点 4.0 处归零（与太阳事件"域上缘 2.4 = 平台终点、淡出延伸到 3.0"模式一致；淡出段 3.5–4.0 内特效部分可见但事件离域 1 秒后丢弃）
- ✅ **行为变更登记**：永久遗迹与活跃事件共用 `snFadeWeight` 窗口——超新星内容（活跃动画 + 遗迹星云/致密天体）整体收敛为银河系视角专属，**L4 下遗迹不再显示**（`supernovaRemnants` 状态保留，回 L3 完整可见；R3-3 确认项 1"遗迹保留"语义不变，登记于 Supernova.tsx 注释）；跟随/飞往超新星期间聚焦权重提升（effectiveSnWeight）不受影响
- ✅ 单测更新：eventScopes 窗口断言（[2.5, 3.5]、3.51/4 为假、与合并域互补）、锚点矩阵超新星 [false, false, true, false]；storeR33 新增"L4 域外丢弃活跃超新星"1 例；全量 1833 用例/108 套件通过，覆盖率 gate ≥90% 保持（98.15%/97.84%/98.97%/99.49%），type-check/lint/build 全绿
- ✅ 文档回写：CHANGELOG [Unreleased] 登记行为变更；REQUIREMENTS.md §3.1.5 同步（版本升 3.1）；IMPROVEMENT_REQUIREMENTS_2.md §R2-4 窗口表登记"已被 R3-5 收窄"

## 5.2 验收标准

- 🔶 L4 锚点观察 ≥60 秒（高压缩比）：无超新星通知弹出、无爆发特效、演示按钮置灰 tooltip"请切换到银河系视角触发"（门控矩阵由单测断言；浏览器目验待用户验证）
- 🔶 L3 触发超新星 → 滚轮缩出至 L4 停留 >1 秒：特效随 3.5→4.0 淡出、事件被丢弃；回 L3 不恢复、遗迹保留（storeR33 单测断言状态层；浏览器目验待用户验证）
- ✅ L3 下超新星行为零回退（触发/通知/飞往观看/遗迹归档均在 [2.5, 3.5] 平台段内，窗口下缘未动）


---

# R3-6 银河系视角天体垂直展开（银纬修正 + 展开开关）

## 6.0 背景与现状调研

**用户反馈**：银河系视角（L3）下的天体几乎都在一个平面上，希望增加类似"展开"的功能，在符合科学事实的前提下将天体展开得更立体、利于观察。

**根因**（已代码调研核实）：13 个 L3 特殊天体（`src/data/specialBodies.ts`）的 `offsetLy` 为示意值，垂直/水平分量比中位数仅 ≈0.12（|y| 100–950 ly vs 水平 3,200–5,300 ly，唯 M13 例外 y=6,200），且换算链路（`SpecialBodies.tsx` `useGalacticPlacement`）对 `offsetLy.y` 不施加任何增益——既有 ×10 垂直增益（`utils/galacticMotionCues.ts` `VERTICAL_VISUAL_GAIN`）仅作用于太阳自身 ±300 ly 振荡项，跟随模式下该项还被组偏移抵消。天体 y 折算后 5–47 场景单位，淹没在银盘粒子云厚度（盘厚 1,000 ly = 50 单位）内。数据文件无任何银纬（b）来源登记。

**用户确认项**（2026-07 需求澄清，全部采纳）：
1. 按"银纬修正（默认生效）+ 展开开关（增益 + 高度指示线）"实现；
2. 展开增益**滑块可调**（非固定倍率）；
3. 快捷键 `V` + 控制面板显示选项区开关；
4. 数据修正**永久改变默认观感**可接受（天体默认即按真实银纬取高度，M13 明显高悬）。

## 6.1 需求

**A. 数据修正：offsetLy.y 按真实银纬重定（默认生效，科学基础）**
- ✅ 12 个 `sun-relative` 天体（sgr-a-star 为银心原点不参与）`offsetLy.y` 重定为 `round(√(x²+z²) × tan(b))`——保持"从太阳看的真实银纬方向、距离示意"口径（x/z 水平示意值不动）；逐天体登记 b 值与来源（SIMBAD 银经银纬，实现时核对）：

  | 天体 id | 银纬 b（约） | 天体 id | 银纬 b（约） |
  |---|---|---|---|
  | betelgeuse | −9.0° | m13-cluster | +40.9° |
  | rigel | −25.1° | cygnus-x1 | +3.1° |
  | sirius | −8.9° | wr-124 | +3.3° |
  | crab-pulsar | −5.8° | delta-cephei | +0.5° |
  | orion-nebula | −19.4° | pleiades | −23.5° |
  | ring-nebula | +14.0° | horsehead | −16.8° |

- ✅ 换算收敛为纯函数 `utils/galacticLatitude.ts` `offsetYFromLatitude(horizontalLy, latitudeDeg)`，非法输入（非有限/|b|≥90°/水平距离为负）抛 `RangeError`，单测覆盖（galacticLatitude.test.ts，含 12 天体数据表交叉断言：offsetLy.y 逐一等于 offsetYFromLatitude(√(x²+z²), b)）
- ✅ `specialBodies.ts` 文件头登记口径更新（近似处理登记区新增 R3-6 条目）；每个天体 offsetLy 上方注释附 b 值、SIMBAD 来源与换算式（如 `b ≈ +40.9°（SIMBAD M13）：y = round(5608 × tan(+40.9°)) = +4858`）
- ✅ 修正后行为回归：`utils/galaxy.m13GalactocentricT0Ly` 同源更新为 y=4858（球状星团排除区）、galaxyR29 单测断言更新；相机解析按 offsetLy 动态取值零改动（M13 6,200 → 4,858，"银晕中"事实不变，|y| > 4,000 单测断言）

**B. 展开模式状态与纯逻辑**
- ✅ store 新增：`galaxyVerticalExpand: boolean`（默认 false）+ `galaxyExpandGain: number`（滑块值，范围 **[1, 6]**、默认 **3**，setter 经 `clampExpandGain` 钳制、非有限抛 RangeError）+ `setGalaxyVerticalExpand`/`toggleGalaxyVerticalExpand`/`setGalaxyExpandGain`；快捷键 `V` 切换开关（`useKeyboardShortcuts`）——🔶 差异登记：V 键未按 G 键模式做 L3 层级门控（任意视角均切换状态），因展开仅作用于特殊天体可见窗口 2.5–3.9、其余视角零视觉影响（登记于快捷键注释），域外按 V 无害
- ✅ 展开增益纯逻辑（`utils/galacticLatitude.ts`）：开关线性进度 `advanceFrameTransition`（1 秒）经 `easeInOutCubic` 缓动后在 1 与滑块平滑值间插值（`effectiveExpandGain`，开/关约 1 秒完成、与滑块值大小无关）；滑块拖动经 `advanceExpandGainValue` 恒速平滑跟随（全量程 [1,6] 约 1 秒，消除 0.5 步进位置跳变）；应用点为 `useGalacticPlacement` 的 y 通道 `y = (sun.y × gain + offset.y × expandGain) × SCENE_UNITS_PER_LY`（太阳振荡 ×10 增益机制不变、互不相乘）；帧过渡由 Galaxy.tsx 每帧推进并写入注册表，SpecialBodies 消费——🔶 差异登记：useFrame 执行顺序下消费端至多滞后 1 帧，平滑过渡中不可辨
- ✅ **范围界定（登记）**：仅 13 个特殊天体参与展开（sgr-a-star 银心原点无 offset 实际不动）；银盘粒子/旋臂/超新星事件与遗迹/太阳系标记不展开（**R3-7 起口径更新**：银盘粒子与超新星随同一增益 morph 为扁旋转椭球体，太阳系标记仍不参与）；展开为观察辅助视觉夸大，登记于 `utils/galacticLatitude.ts` 文件头 + store/注册表注释 + HelpHint 登记文案

**C. UI：控制面板 + 高度指示线**
- ✅ ControlPanel 显示选项区新增"垂直展开（V）"复选框；开启时显示增益滑块（×1–×6，步进 0.5，默认 ×3，实时生效 + 视觉夸大说明文案）
- ✅ 展开开启时每个 sun-relative 特殊天体显示**高度指示线**：天体 → 银盘面（组内 y=0）投影点虚线 + 高度标注（"+4,858 ly"/"−1,616 ly"，正负区分盘上/盘下；标注值为未乘展开增益的真实推算值 `heightLabelText`，登记）——`ClampedHtmlLabel`（R3-4）标注钳制复用；关闭展开即卸载隐藏；随 `showLabels` 开关联动。🔶 差异登记：a) Galaxy `heightLine`（P6）实为 LineBasicMaterial 实线，本项按需求"虚线"改用 LineDashedMaterial（预分配 position/lineDistance 属性手动更新，避免 computeLineDistances 每帧分配），"天体→盘面投影"模式同款；b) 跟随/飞往目标自身的 ±ly 标注隐藏（R2-7 近距标签语义对齐）；c) 指示线随层级门控淡出、不参与聚焦提升权重（跟随天体跌入 L2 区间时线随银河系组语境淡出）
- ✅ HelpHint 快捷键说明补 `V`（含科学性登记：方向按真实银纬、展开为观察辅助视觉夸大、标注为未放大推算高度）

**D. 渲染/解析一致性**
- ✅ 相机跟随/飞往与空间音效按展开后位置解析：`renderedGalacticFrame` 注册表扩展 `expandGain` 字段（默认 1，setter 校验 ≥1），`Galaxy.tsx` 每帧缓动后写入（SpecialBodies 只读消费不重复写入——单写者模式，差异登记），`cameraFocus.specialBodyFocusTarget` 消费（offset.y × expandGain）——渲染与解析同源（单测独立镜像渲染路径 computeGalacticFramePose + tiltAroundX，断言同一增益下两路径逐分量一致，含银心固定 w=1 + 太阳增益 ×10 + 展开 ×4.5 组合）；sgr-a-star（银心原点）与超新星事件解析不受影响（单测断言 expandGain 1→6 位置不变；**R3-7 起口径更新**：超新星在 supernovaFocusTarget 层随盘 morph，`galacticPointToSceneUnits` 本身仍不变）
- ✅ 展开过渡期间跟随目标不跳变（每帧重解析，与既有跟随机制一致；渲染与解析读同一注册表值）

**E. 测试与回归**
- ✅ 纯函数单测（`galacticLatitude.test.ts` 29 例 + `storeR36.test.ts` 4 例）：银纬→y 换算（12 天体数据表交叉/b=0/边界/非法输入）、增益平滑过渡（恒速收敛/不越过/双向/全量程 1 秒）、滑块钳制（含 store setter）、生效增益（进度 0 恒 1/进度 1 等于滑块值/单调）、指示线端点（镜像公式/盘上下符号/非法输入）、标注文案（千分位/正负号）；渲染/解析同源断言（见 §D）
- ✅ 既有受影响断言更新（galaxyR29 M13 y=4858、galacticFrameP6 注册表 expandGain 字段）；全量 1862 用例/110 套件通过，覆盖率 gate ≥90% 保持（语句 98.18%/分支 97.88%/函数 98.99%/行 99.49%，galacticLatitude.ts 100%）；type-check/lint/build 全绿
- ✅ CHANGELOG [Unreleased] 新增区登记（数据修正行为变更 + 展开开关 + 指示线 + 同源解析）；REQUIREMENTS.md §3.1.5 同步（版本升 3.2）

## 6.2 验收标准

- ✅ L3 默认（未展开）：天体高度即银纬推算值——猎户座星云/昴星团/参宿七低于盘面、M13 高悬银晕（无头 Chrome 目验截图 r36-01；盘上下符号单测断言）；数据注释逐天体附 b 值与 SIMBAD 来源
- ✅ 按 V 或面板开关开启展开：约 1 秒平滑过渡，天体垂直位置按滑块倍率（默认 ×3）展开，高度指示线（虚线 + ±ly 标注）出现（无头 Chrome 目验：r36-02 展开态、r36-09 M13 指示线特写、12 个 ±ly 标注 DOM 逐一核对 +4,858/−1,902/−1,616 ly 等）
- ✅ 滑块 1–6 拖动实时平滑生效，无跳变（恒速平滑跟随单测断言；无头 Chrome 目验 ×6/×1 两档截图 r36-03/04，M13 高度随增益渐次分离）
- ✅ 展开状态下飞往/跟随任一特殊天体：运镜落点正确、跟随无错位（渲染/解析同源单测；无头 Chrome 目验展开 ×3 下巡游至 M13 与猎户座星云，目标居中、信息面板正确，截图 r36-05/06）
- ✅ 关闭展开恢复银纬真实高度（无头 Chrome 目验 r36-07）；L1/L2/L4 无视觉影响（特殊天体可见窗口 2.5–3.9 天然限定 + 生效增益仅乘 offset.y）；银盘粒子/超新星/太阳振荡不受展开影响（超新星/银心解析不变单测断言；**R3-7 起口径更新**：银盘粒子与超新星随盘 morph，太阳振荡机制不变）
- ✅ 60 FPS 不跌破（无头 Chrome Metal 1280×800 实测：L3 默认/展开/跟随 M13/关闭恢复均 60 FPS）；单测全通过（1862 用例/110 套件）、覆盖率 gate ≥90% 保持


---

# R3-7 银河系整体垂直展开（银盘 → 扁旋转椭球体）

## 7.0 背景与现状调研

**用户反馈**（R3-6 交付复盘）：R3-6 只展开了 13 个特殊天体，未达预期——期望在符合科学事实的基础上，银河系上对应的其他粒子也类似展开，**整个银河系从一个圆（盘）变成一个球体或椭球体**；并确认目标形态为"**基于正面圆形的椭球体**"：最大面（正面/俯视）看是圆形、最厚侧面看是椭圆形——即**扁旋转椭球体（oblate spheroid）**。

**科学口径**（已与用户对齐）：银河系薄盘真实厚约 1,000 ly vs 直径 105,400 ly（比例 ~1%），"扁平"本身是科学事实，真球体不符合事实；采用可视化标准手法"**垂直夸大 morph**"——每颗粒子按**自身真实高度等比例**抬升（盘上/盘下与相对厚薄关系全部保留，仅垂直比例夸大），与地形图垂直夸大同一性质，登记为观察辅助。morph 只重映射 y、x/z 不动 → 正面投影轮廓与现状完全一致（圆形，旋臂/棒俯视仍可辨），侧面为轴比 0.5 的椭圆——天然满足"正面圆、侧面椭圆"。

**关键调研结论**（已核实，直接采信）：R2-11 Milkomeda 终态椭球已有**成熟已验证的 morph 管线**（`Galaxy.tsx` 盘粒子顶点着色器 :242-243）：`hTargetLy = (aHeightLy / 500.0) * max(aRadiusLy, 6000.0) * 0.5; pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uEll)`——目标轴比 0.5、核球区最小厚度下限 6,000 ly（中心比严格椭球略"鼓"，贴近真实核球三维鼓包，登记）。R3-7 复用该公式，新增独立 uniform 驱动（与合并 uEll 顺序 mix 同一目标，等效权重 1−(1−uEll)(1−uExpand)，无视觉冲突）。效果预览图已生成并经用户确认（无头 Chrome 真机渲染，morph 权重 0.85：正面圆、侧视椭球观感成立）。

**用户确认项**（2026-07 需求澄清，全部采纳推荐方案）：
1. 形态 = **扁旋转椭球体，轴比 0.5**（正面圆形、最厚侧面椭圆；复用 R2-11 morph 公式）；
2. **单滑块联动**：沿用 R3-6 的 V 开关 + 增益滑块 [1,6]，盘 morph 权重由同一生效增益线性映射（×1 → 0、×6 → 1.0 完整椭球；默认 ×3 → 0.4 中等椭球；效果图为 0.85 ≈ ×5.25）；
3. **超新星事件/遗迹随盘抬升**（位于旋臂内属盘语境；行为变更——推翻 R3-6"超新星不展开"范围登记）；
4. **银晕展开态增亮约 +30%**（强化球形轮廓）；银晕粒子/球状星团本已球状分布，**不参与 morph**；
5. **尘埃带侧视暗带展开态渐隐**（morph 后"盘中平面"语义消失）。

## 7.1 需求

**A. 银盘粒子椭球 morph（40,000 粒，GPU uniform 驱动）**
- ✅ `Galaxy.tsx` 盘粒子 shader 新增 uniform `uExpand`（morph 权重 0–1）：在 R2-11 uEll mix 之后追加 `pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uExpand);`（同一 morph 目标，顺序 mix 组合语义登记于 shader 注释 + `combinedMorphWeight` 镜像单测）；每帧由 Galaxy.tsx useFrame 写入（morph01 计算位于既有可见性门控之后，组不可见时天然跳过）
- ✅ morph 权重纯函数（并入 `utils/galacticLatitude.ts`）：`diskMorphWeight(expandGain) = clamp((expandGain − 1) / (GALAXY_EXPAND_GAIN_MAX − 1), 0, 1)`——从 R3-6 注册表生效增益（`renderedGalacticFrame().expandGain`，已含 1 秒开关过渡 + 滑块平滑）派生，**零新增注册表字段、渲染/解析天然同源**；非法输入抛 RangeError（单测含效果图确认值 ×5.25→0.85）
- ✅ CPU 镜像纯函数：`morphGalacticYLy(yLy, horizontalRadiusLy, morph01)` 与 shader 公式逐字镜像（`mix(y, (y/500)·max(r, 6000)·0.5, morph01)`，常量 500/6000/0.5 导出为 `DISK_MORPH_*` 并单测断言同源），供超新星/单测消费；morph01=0 恒等、y=0 恒等、符号保留、|y| 单调放大断言

**B. 超新星事件/遗迹随盘抬升（行为变更）**
- ✅ 渲染：`Supernova.tsx` 两处定位（活跃事件/遗迹）y 通道改经 `morphGalacticYLy`（水平半径 √(x²+z²) 为银心系距离；共用 `morphedSnYUnits` 辅助，useFrame 每帧标量更新 group.position.y 零分配，遗迹隐藏时跳过）
- ✅ 解析：`cameraFocus.supernovaFocusTarget` 传入 `galacticPointToSceneUnits` 前对 y 施加同一 morph（**`galacticPointToSceneUnits` 本身未改**——sgr-a-star 银心原点 y=0 morph 恒等，特殊天体走自身路径不受影响，单测断言维持）；展开态飞往/跟随超新星落点正确（渲染/解析同源单测 ×3/×6/银心固定 w=1/×1 恒等零回退；无头 Chrome 目验展开 ×6 下飞往超新星遗迹居中，截图 r37v-13）
- ✅ 范围登记更新：R3-6 在 `utils/galacticLatitude.ts` 文件头与 `galacticFrame.ts` 注册表注释登记的"超新星不参与展开"表述改为"超新星随盘 morph（R3-7）"；§R3-6 交付登记三处口径同步加注

**C. 银晕增亮 + 尘埃带渐隐（展开态联动）**
- ✅ 银晕：`haloMaterial.uniforms.uOpacity` 乘 `1 + 0.3 × morph01`（纯函数 `haloExpandBoost`；可见分支覆写，隐藏路径保持基础写值）
- ✅ 尘埃带：`dustLane` 计算乘 `1 − morph01`（纯函数 `dustLaneExpandFade`；单一应用点同时驱动 shader vDust 与暗带 mesh/核球辉光压低链路，无头 Chrome ×6 侧视暗带消失核对，截图 r37v-03）
- ✅ 不参与 morph 登记：银晕粒子/球状星团（本已球状）、太阳系标记/尾迹/预测线/银河年刻度（太阳振荡 ×10 机制不变）、特殊天体（维持 R3-6 银纬增益机制，同一滑块驱动）——登记于 utils/galacticLatitude.ts 文件头

**D. 层级语义与登记**
- ✅ 展开随 V 开关全程生效：银河系组在 L4 仍可见 → **V 开启时 L4 同样呈椭球**（符合"整个银河系变椭球"诉求，登记为预期行为；R3-6"其余视角零视觉影响"口径同步更新）；L1/L2 银河系组不可见零影响
- ✅ 与 R2-11 合并演化互操作登记：L4 合并预览期间 uEll 与 uExpand 同目标顺序 mix，终态 Milkomeda 观感不受 V 开关破坏（`combinedMorphWeight` 单测镜像断言：uEll=1 时组合权重恒 1）
- ✅ 权衡登记（HelpHint/文件头/ControlPanel 说明文案）：morph 后侧视旋臂图案被垂直弥散（俯视仍清晰）；展开为观察辅助视觉夸大

**E. 测试与回归**
- ✅ 纯函数单测（`galacticLatitudeR37.test.ts` 23 例）：`diskMorphWeight` 映射与钳制（×1→0/×3→0.4/×6→1/×5.25→0.85/单调/非法输入）、`morphGalacticYLy` 镜像公式（恒等/符号/单调/核球最小厚度下限/与 shader 常量一致）、`haloExpandBoost`/`dustLaneExpandFade`、超新星渲染/解析同源（独立镜像渲染路径）、uEll+uExpand 组合权重顺序 mix 镜像
- ✅ R3-6 既有行为零回退（特殊天体/指示线/滑块钳制单测零改动，仅一处测试标题口径加注）；全量 1885 用例/111 套件通过、覆盖率 gate ≥90% 保持；type-check/lint/build 全绿
- ✅ CHANGELOG [Unreleased] 登记（超新星随盘属行为变更）；REQUIREMENTS.md §3.1.5/§4.4 同步（版本升 3.3）；R3-6 相关登记口径更新（文件头/注册表注释/§R3-6 交付登记/单测标题）

## 7.2 验收标准

- ✅ V 开启（默认 ×3）：银盘约 1 秒平滑 morph 至中等椭球（权重 0.4）；滑块 ×6 时完整轴比 0.5 椭球——**正面（俯视）轮廓仍为圆形、旋臂可辨；最厚侧面为椭圆**；×1 时盘不 morph（权重 0）（无头 Chrome 侧视四态对比截图 r37v-01～04、近正俯视对比 r37v-10/11）
- ✅ 滑块 1–6 拖动盘厚度实时平滑跟随（与 R3-6 特殊天体同一增益源 `renderedGalacticFrame().expandGain` 派生，无第二套过渡状态；目验 ×6↔×1 平滑）
- ✅ 超新星遗迹/活跃事件随盘抬升；展开态飞往/跟随超新星运镜落点正确（渲染/解析同源单测 + 无头 Chrome 展开 ×6 飞往超新星遗迹居中跟随，截图 r37v-13）
- ✅ 展开态银晕增亮（约 +30%）强化球形轮廓；尘埃带侧视暗带随 morph 渐隐（r37v-03 ×6 侧视暗带消失、银晕增亮）
- ✅ 关闭展开：约 1 秒恢复薄盘 + 尘埃带/银晕恢复（r37v-05）；R3-6 特殊天体/指示线行为零回退（既有单测零改动）；银晕粒子/球状星团/太阳系标记不受 morph 影响
- ✅ L4 下 V 开启同样呈椭球（登记语义，银河系组 L4 仍可见）；合并预览终态 Milkomeda 不受破坏（combinedMorphWeight uEll=1 恒 1 单测断言）
- ✅ 60 FPS 不跌破（uniform-only、零新增粒子、渲染循环零分配；无头 Chrome Metal 1280×800 实测：侧视默认/展开 ×3/×6/俯视 ×6/展开跟随超新星/关闭恢复均 60 FPS）；单测全通过（1885 用例/111 套件）、覆盖率 gate ≥90% 保持
