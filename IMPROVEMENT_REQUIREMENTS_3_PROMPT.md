# 改进需求第三批（R3）— Agent 实现提示词

> **用法**：将对应代码块内的提示词**整段复制**发给 Agent 即可，无需任何调整——提示词已自包含：需求出处、关键实现锚点、实现要点、验收标准与完整收尾流程。
> **权威需求定义**：`IMPROVEMENT_REQUIREMENTS_3.md`（提示词内简称"需求文档"）。
> R3-1～R3-7 已交付（见 CHANGELOG 与需求文档总览表）；当前待实现：**R3-8**（其余提示词仅作历史存档）。

---

## R3-6：银河系视角天体垂直展开

````markdown
# 任务：实现 R3-6 银河系视角天体垂直展开（银纬修正默认 + 展开开关/滑块 + 高度指示线）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_3.md` 的 **§R3-6（含 §6.0 用户确认项 4 条与银纬数据表）**。开工前只读该节，无需通读全文。

## 根因与方案（已调研确认，直接采信，勿重新探索）
L3 的 13 个特殊天体 `offsetLy`（`src/data/specialBodies.ts` :40-306）y 为示意值（垂直/水平比中位数 ≈0.12），换算链路对 offset.y 无任何增益 → 天体挤在银盘厚度（50 场景单位）内显得共面。方案两层：
1. **数据修正（默认生效）**：12 个 sun-relative 天体 `offsetLy.y = round(√(x²+z²) × tan(b))`，b 为真实银纬（需求文档 §6.1-A 已列 12 个天体的 b 值表，来源 SIMBAD，实现时核对登记）；口径="方向按真实银纬、水平距离示意"。
2. **展开开关（观察辅助）**：store 布尔 + 增益滑块（范围 [1,6]、默认 ×3、步进 0.5），开启后 offset.y 乘当前增益（~1 秒平滑过渡），并显示每天体"高度指示线"（天体→盘面投影虚线 + ±ly 真实值标注）。

## 关键实现锚点（行号漂移时以符号名为准）
- 渲染换算：`src/components/Scene/SpecialBodies.tsx` `useGalacticPlacement`（约 :228-287）——y 通道现为 `(sun.y × gain + offset.y) × SCENE_UNITS_PER_LY`，展开增益乘在 `offset.y` 上；`SCENE_UNITS_PER_LY = 0.05`（`src/utils/scale.ts:158`）。
- 太阳振荡增益 `VERTICAL_VISUAL_GAIN = 10`（`src/utils/galacticMotionCues.ts:43`）**仅作用于太阳 y，与展开增益互不相乘、机制不变**。
- 渲染/解析同源：`src/utils/galacticFrame.ts` `renderedGalacticFrame` 注册表（:101-124, :209）+ `Galaxy.tsx:703 setRenderedGalacticFrame` 每帧写入 → 扩展"展开增益"字段；消费方 `src/utils/cameraFocus.ts` `galacticPointToSceneUnits`（:143-155）与 `specialBodyFocusTarget`（:256-292）同步应用（跟随/飞往落点与渲染一致，单测断言）。sgr-a-star（银心原点，无 offset）与超新星事件（`positionLy` 银心系）不参与展开。
- 高度指示线参照：`Galaxy.tsx` `heightLine`（P6"You are here → 盘面投影"虚线模式，约 :929-930）；标注用 `src/components/Scene/ClampedHtmlLabel.tsx`（R3-4 近距钳制标签组件，直接复用勿新造）。
- store 开关/滑块模式参照 `showLabels`/`setShowLabels`；快捷键接入 `src/hooks/useKeyboardShortcuts.ts`（`V` 键，注意勿与既有键冲突，现用键见 HelpHint）；面板 `src/components/UI/ControlPanel.tsx` 显示选项区。
- 平滑过渡复用 `advanceFrameTransition`（SpecialBodies/Supernova 聚焦提升同款帧过渡模式）。

## 实现要点
1. 新建纯函数（建议 `utils/galacticLatitude.ts` 或并入既有模块）：`offsetYFromLatitude(horizontalLy, latitudeDeg)`（|b|≥90°/非有限抛 RangeError）；用它推导 12 个天体新 y 值写入 specialBodies.ts（数据注释逐天体附 b 值与 SIMBAD 来源，文件头口径更新）。
2. store：`galaxyVerticalExpand`（默认 false）+ `galaxyExpandGain`（[1,6] 钳制，默认 3）+ actions + `V` 快捷键。
3. 展开增益经 ~1 秒帧过渡后乘入 `useGalacticPlacement` 的 offset.y；注册表扩展字段供 cameraFocus 同源消费。
4. 指示线：展开开启且 `showLabels` 时显示——虚线（天体→y=0 投影）+ 标注（真实推算高度 ±ly，不乘增益，登记）；关闭即隐藏。
5. 范围登记：仅 13 个特殊天体展开；银盘粒子/旋臂/超新星/太阳系标记不展开；展开为观察辅助视觉夸大，登记模块文件头。

## 硬性约束
- 展开只影响 L3 银河系组特殊天体（可见窗口 2.5–3.9 天然限定）；L1/L2/L4 零视觉影响。
- 渲染循环零分配（复用临时向量/直改 DOM 模式）；60 FPS 不跌破。
- 既有单测受 offsetLy 新值影响的断言同步更新（M13 6,200 → ≈4,860，"银晕中"事实不变）。

## 验收标准（需求文档 §6.2，逐条回写）
1. L3 默认：天体高度即银纬推算值（猎户座/昴星团/参宿七低于盘面、M13 高悬），观感立体。
2. V/面板开启：~1 秒平滑过渡 + 指示线出现；滑块 1–6 实时平滑；关闭恢复。
3. 展开状态下飞往/跟随任一特殊天体落点正确（渲染/解析同源单测）。
4. 纯函数（银纬换算/增益过渡/滑块钳制/指示线端点）单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿（dev 服务器用 3100 端口，勿占 3000）。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`）：默认/展开两态对比截图、滑块调节、展开下飞往 M13 与猎户座星云、FPS 登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（数据修正属行为变更务必登记）。
4. `IMPROVEMENT_REQUIREMENTS_3.md` §R3-6 各条 🔲 回写 ✅/🔶（实现差异逐条登记）；REQUIREMENTS.md 受影响小节同步。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 锚点已给全，直接 Read 目标符号附近小范围，勿全量探索/勿整读大文件；先写纯函数与单测再接组件；银纬表直接采信需求文档 §6.1-A。
````


---

## R3-7：银河系整体垂直展开（银盘 → 扁旋转椭球体）

````markdown
# 任务：实现 R3-7 银河系整体垂直展开（银盘粒子 morph 为扁旋转椭球体 + 超新星随盘 + 银晕增亮/尘埃带渐隐）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_3.md` 的 **§R3-7（含 §7.0 用户确认项 5 条）**。开工前只读该节，无需通读全文。

## 背景与方案（已调研并经用户效果图确认，直接采信，勿重新探索）
R3-6 只展开了 13 个特殊天体；用户期望**整个银河系从圆盘变成扁旋转椭球体**（正面/俯视看圆形、最厚侧面看椭圆，轴比 0.5）。方案：复用 R2-11 Milkomeda 已验证的盘→椭球 morph 公式（每颗粒子按自身真实高度等比例抬升，x/z 不动 → 正面轮廓天然不变），由 R3-6 既有 V 开关 + 滑块的**同一生效增益**派生 morph 权重，GPU uniform 驱动零新增粒子。

## 关键实现锚点（行号漂移时以符号名为准）
- **morph 公式（复用，勿重写）**：`src/components/Scene/Galaxy.tsx` 盘粒子顶点着色器 :242-243——`hTargetLy = (aHeightLy / 500.0) * max(aRadiusLy, 6000.0) * 0.5; pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uEll);`。在该行**之后**追加同目标的第二次 mix：`pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uExpand);`（新增 uniform `uExpand`，uniforms 定义区 :190-203；与合并 uEll 顺序 mix 组合权重 = 1−(1−uEll)(1−uExpand)，同目标无视觉冲突，登记 + 单测镜像断言）。
- **增益源（同源，零新增注册表字段）**：`renderedGalacticFrame().expandGain`（`src/utils/galacticFrame.ts` :209）已含 R3-6 的 1 秒开关过渡 + 滑块平滑（Galaxy.tsx :713-731 每帧推进写入）。morph 权重 = 纯函数 `diskMorphWeight(expandGain) = clamp((expandGain−1)/(GALAXY_EXPAND_GAIN_MAX−1), 0, 1)`（并入 `src/utils/galacticLatitude.ts`；×1→0、×3→0.4、×6→1.0；效果图确认值 0.85）。
- **超新星随盘（行为变更）**：CPU 镜像纯函数 `morphGalacticYLy(yLy, horizontalRadiusLy, morph01)`（与 shader 公式逐字镜像，morph01=0 恒等）。应用两处渲染定位 `src/components/Scene/Supernova.tsx` :151-153（活跃事件）与 :271-273（遗迹）的 y 通道（水平半径 = √(x²+z²) 银心系距离）+ 解析 `src/utils/cameraFocus.ts` `supernovaFocusTarget`（:297-302）传入 `galacticPointToSceneUnits` 前施加同一 morph。**`galacticPointToSceneUnits` 本身不改**（sgr-a-star y=0 morph 恒等；特殊天体走自身路径维持 R3-6 机制不动）。
- **银晕增亮**：`haloMaterial.uniforms.uOpacity`（Galaxy.tsx :666，现 `0.55 * weight`）乘 `haloExpandBoost(morph01) = 1 + 0.3 × morph01`。
- **尘埃带渐隐**：`const dustLane = dustLaneStrength(faceOn) * (1 - ellMix)`（Galaxy.tsx :753）再乘 `dustLaneExpandFade(morph01) = 1 − morph01`（单一应用点，shader vDust/暗带 mesh/核球辉光压低链路全部随动）。
- **不参与 morph**（登记）：银晕粒子/球状星团（本已球状分布）、太阳系标记/尾迹/预测线/银河年刻度（太阳振荡 ×10 机制不变）、特殊天体与高度指示线（R3-6 机制零改动）。
- **登记口径更新**：`utils/galacticLatitude.ts` 文件头与 `galacticFrame.ts` 注册表注释中"超新星不参与展开"改为"超新星随盘 morph（R3-7）"；HelpHint 补权衡登记（morph 后侧视旋臂垂直弥散、俯视仍清晰）。

## 实现要点
1. 纯函数先行（`utils/galacticLatitude.ts`）：`diskMorphWeight` / `morphGalacticYLy` / `haloExpandBoost` / `dustLaneExpandFade`，非法输入抛 RangeError，单测覆盖后再接组件。
2. Galaxy.tsx useFrame：`const morph01 = diskMorphWeight(expandGain)`（R3-6 已算好 expandGain，:725-731 附近）→ 写 `uExpand` uniform + 银晕/尘埃带因子（组不可见时既有门控已跳过）。
3. Supernova.tsx 两处定位 + cameraFocus 解析同步（渲染/解析同源单测断言展开态飞往超新星落点一致）。
4. 层级语义：银河系组 L4 仍可见 → V 开启时 L4 同样呈椭球（预期行为，登记）；L1/L2 组不可见零影响；合并预览终态 Milkomeda 不受 V 开关破坏。

## 硬性约束
- 渲染循环零分配、uniform-only、零新增粒子；60 FPS 不跌破。
- R3-6 既有行为零回退（特殊天体银纬增益/指示线/滑块钳制单测不动）。
- morph 权重与 R3-6 生效增益严格同源（同一 expandGain 派生，禁止第二套过渡状态）。

## 验收标准（需求文档 §7.2，逐条回写）
1. V 开启（默认 ×3）：银盘 ~1 秒平滑 morph 至中等椭球（0.4）；×6 完整轴比 0.5 椭球——正面轮廓仍圆、旋臂俯视可辨，侧面椭圆；×1 不 morph；关闭恢复薄盘。
2. 滑块拖动盘厚实时平滑（与特殊天体同一增益源）。
3. 超新星遗迹/事件随盘抬升，展开态飞往超新星落点正确（同源单测）。
4. 银晕 +30% 增亮、尘埃带渐隐随 morph 联动；银晕粒子/星团/太阳系标记不受影响。
5. 纯函数（morph 权重映射/公式镜像/增亮/渐隐因子/组合权重）单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿（dev 服务器用 3100 端口，勿占 3000）。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 驱动可参考上批 r36/r37 脚本模式：滚轮拉远 14 档看整体轮廓、垂直拖拽 ~260px 取侧视角）：默认薄盘/展开 ×3/×6 侧视对比、俯视正面圆形轮廓核对、展开下触发并飞往超新星、关闭恢复、FPS 登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（超新星随盘属行为变更务必登记）。
4. `IMPROVEMENT_REQUIREMENTS_3.md` §R3-7 各条 🔲 回写 ✅/🔶（实现差异逐条登记）；REQUIREMENTS.md §3.1.5/§4.4 同步；R3-6 相关"超新星不展开"登记口径同步更新。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 锚点已给全（含精确行号与现有代码原文），直接 Read 目标符号附近小范围，勿全量探索/勿整读 Galaxy.tsx（1,000+ 行）/Supernova.tsx；先写纯函数与单测再接组件；morph 公式/映射值直接采信本提示词与需求文档 §7.0-§7.1。
````

---

## R3-8：控制面板功能选项按视角作用域整理（域外隐藏）

````markdown
# 任务：实现 R3-8 控制面板功能选项按视角作用域整理（视角专属选项域外隐藏 + V 键 L3 门控）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_3.md` 的 **§R3-8（含 §8.0 现状核实表与用户确认项 5 条）**。开工前只读该节，无需通读全文。


## 背景与方案（已调研并经用户确认，直接采信，勿重新探索）
控制面板选项过多：只有全局选项才应跨视角常显，视角专属选项应只在对应视角下显示并可用。用户确认：**域外隐藏（非置灰，含事件演示按钮，推翻 R2-4 置灰方案）**；真实比例归全局；卫星轨道线归 L1；V 快捷键补 L3 门控；**域外已开启状态与场景效果全部保留（只整理 UI 显示，零渲染行为变更——store/场景组件一行不改）**。


## 作用域归类（唯一事实来源，直接照抄）
| 作用域 | 选项 |
|---|---|
| 全局（恒显） | 轨道线(O) / 天体标签(L) / 真实比例 / 泛光 / 性能监控（+视角切换、模拟速度、音效区块不动） |
| L1 行星 | 卫星轨道线 |
| L1+L2 | 耀斑演示 / CME 演示（既有太阳事件域 ≤2.4 覆盖两视角） |
| L2 太阳系 | 太阳内部剖面 |
| L3 银河系 | 银心固定参考系(G)整个 section / 垂直展开(V)+增益滑块 / You are here 标记 / 超新星演示 |
| L4 宇宙 | 速度矢量箭头 / 合并预览+“恢复预览前时间”按钮 |


## 关键实现锚点（行号漂移时以符号名为准）
- **判定源 = `viewLevel`**（勿用 continuousLevel）：滚轮缩放经 store `syncZoomLevel`/`syncCameraDistance`（`src/store/index.ts` :552-592）已自动同步 viewLevel，跟随/飞往期间层级锁定 → 跟随 L3 天体拉近时选项不闪变（已核实，直接采信）。
- **纯函数先行**：新建 `src/utils/panelScopes.ts`——`PANEL_OPTION_SCOPES: Record<PanelOptionId, readonly ViewLevel[]>` 注册表 + `panelOptionVisible(optionId, viewLevel)`（未知 id 抛 RangeError）。选项 id 建议：`orbits/labels/realScale/bloom/performance/satelliteOrbits/flareDemo/cmeDemo/sunCutaway/galacticFrame/verticalExpand/youAreHere/supernovaDemo/velocityVectors/mergerDemo`。ViewLevel 类型在 `src/types`（'L1'|'L2'|'L3'|'L4'）。
- **ControlPanel.tsx（`src/components/UI/ControlPanel.tsx`，唯一需改的组件）**：已订阅 `viewLevel`（:22）。改造点：
  - 银心固定 section :119-145：仅 L3 渲染整个 section，**删除**现有 `disabled={viewLevel !== 'L3'}` 置灰分支与“银河系视角下可用”文案；
  - 显示区 :199-315 各 label 按 `panelOptionVisible` 条件渲染：卫星轨道线 :218-225、You are here :226-233、速度矢量 :234-241、垂直展开+滑块 :242-271、太阳剖面 :286-298；轨道线/标签/真实比例/泛光/性能监控恒显，相对顺序不变、不加新分组标题；
  - 动态事件演示 section :317-406：超新星 :321-337 仅 L3、耀斑 :339-357 与 CME :358-376 仅 L1/L2、合并预览 :380-396 与恢复按钮 :397-405 仅 L4；**删除**各按钮的域外置灰分支文案（`eventDemoDisabledHintZh` 相关三元分支），但**保留**按钮内部既有 disabled 逻辑（活跃事件进行中/剖面模式/`eventDemoEnabled` 连续层级校验——可见性与可用性双层，eventScopes 域窗口语义不动）；无可用按钮时分区标题一并隐藏（当前四锚点各有至少一钮，规则登记备防）。
- **V 键门控**：`src/hooks/useKeyboardShortcuts.ts` V 分支 :73-77 补 `if (state.viewLevel === 'L3')`（与 G 键 :66-72 同模式）；文件头注释 :22-23 改为“仅 L3 生效，与面板选项可见性一致”。O/L/R 保持全局。
- **HelpHint（`src/components/UI/HelpHint.tsx`）**：V 说明补“（银河系视角下生效）”。


## 硬性约束
- **store 与全部场景组件（Galaxy/Sun/Moon/Universe 等）零改动**——所有开关状态与场景效果域外保留（确认项 5：V 开启切 L4 银河系仍呈椭球属 R3-7 登记语义，不动）。
- `utils/eventScopes.ts` 不改（演示按钮 disabled 校验保留原样）。
- 面板过滤只做条件渲染，不引入新状态/副作用/动画。


## 验收标准（需求文档 §8.2，逐条回写）
1. 四视角面板内容：L1 = 全局5项+卫星轨道线+耀斑/CME 演示；L2 = 全局+太阳剖面+耀斑/CME；L3 = 全局+银心固定区块+垂直展开(含滑块)+You are here+超新星演示；L4 = 全局+速度矢量+合并预览(含恢复按钮)。
2. 域外隐藏非置灰（面板明显缩短）；切换视角即时增减。
3. 状态保留：L3 开垂直展开 → 切 L4 复选框消失但椭球仍在 → 回 L3 复选框仍勾选、滑块值不变。
4. V 键仅 L3 生效；G/O/L/R 不变；跟随 L3 天体拉近（viewLevel 锁定）期间 L3 选项不消失。
5. `panelScopes` 单测：15 选项 × L1–L4 可见性矩阵逐格断言、全局项四视角恒真、未知 id RangeError；既有单测零回退、覆盖率 gate ≥90% 保持。


## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿（dev 服务器用 3100 端口，勿占 3000）。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 驱动参考 r36/r37v 脚本模式，按 1/2/3/4 键切视角）：四视角面板逐一截图核对增减项、L3 开 V 后切 L4 再回 L3 状态保留、L4 按 V 无效核对。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（置灰改隐藏 + V 键门控属行为变更）。
4. `IMPROVEMENT_REQUIREMENTS_3.md` §R3-8 各条 🔲 回写 ✅/🔶（实现差异逐条登记）；REQUIREMENTS.md §3.5.1/§3.5.3 同步；IMPROVEMENT_REQUIREMENTS_2.md §R2-4 登记“置灰方案已被 R3-8 域外隐藏取代”；R3-6“V 键无层级门控”差异登记修正。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。


## 省 token 建议
- 改动面极小（ControlPanel.tsx + useKeyboardShortcuts.ts + HelpHint.tsx + 新建 panelScopes.ts 及其单测），锚点行号已给全，直接 Read 目标区段，勿全仓探索、勿读任何场景组件；作用域表直接照抄本提示词；先写纯函数与单测再接 UI。
````

