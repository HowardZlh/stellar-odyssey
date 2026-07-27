# 改进需求第三批（R3）— Agent 实现提示词

> **用法**：将对应代码块内的提示词**整段复制**发给 Agent 即可，无需任何调整——提示词已自包含：需求出处、关键实现锚点、实现要点、验收标准与完整收尾流程。
> **权威需求定义**：`IMPROVEMENT_REQUIREMENTS_3.md`（提示词内简称"需求文档"）。
> R3-1～R3-5 已交付（见 CHANGELOG 与需求文档总览表），本文件当前仅含 R3-6。

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
