# 改进需求文档（第三批，R3 迭代）

> **文档版本**: 1.1（R3-3 已交付：单测/type-check/lint/build 全绿 + dev 3100 冒烟 200，文档回写完成；浏览器目验项登记 🔶 待用户验证）
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

> 优先级依据：P0 = 交互正确性缺陷（域外事件残留提醒在高时间压缩比下频繁闪现，干扰用户）。

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
