# 改进需求第二批（R2）— 各阶段 Agent 实现提示词

> **用法**：每个阶段单独开一个任务，将对应代码块内的提示词**整段复制**发给 Agent 即可，无需任何调整——每段提示词均已自包含：需求出处、关键实现锚点、实现要点、硬性约束、验收标准与完整收尾流程。
> **权威需求定义**：`IMPROVEMENT_REQUIREMENTS_2.md`（提示词内简称"需求文档"）。
> **建议实施顺序**：R2-1 → R2-2 → R2-3 → R2-4 → R2-5 → R2-6 → R2-7 → R2-9 → R2-10 → R2-8 → R2-11 → R2-12。

---

## R2-1：视角切换关面板 + 日球层顶飞往修复

````markdown
# 任务：实现 R2-1 视角切换自动关闭信息面板 + 外围结构飞往解析修复

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-1 + §0.2 表第 1 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 关键实现锚点（已调研核实，直接采信，勿全量探索；行号漂移时以符号名为准）
- `src/store/index.ts` `setViewLevel`（约 :344-369）：现只清 `followBodyId/flyToBodyId`，需补清 `selectedBodyId/selectedSolarFeature`；注意仅"显式锚点切换（按钮/1-4 快捷键）"清空，连续滚轮缩放跨层级**不**清空。
- `src/utils/cameraFocus.ts` `resolveFocusTarget`（约 :228-306）：无 `heliopause`/`oort-cloud` 分支 → 点"飞往"后无运镜却显示跟随中（假跟随死锁）。补 `heliopause` 分支：目标点=太阳系原点，观察距离 ≈ 2.2 × `HELIOPAUSE_VISUAL_RADIUS_UNITS`（=380，见 `src/utils/heliopause.ts:27`）。
- 兜底：`requestFlyTo`（store :420）在解析返回 null 时不得写入 `followBodyId`（静默忽略或 HUD 提示"该目标不支持飞往"）。
- 跟随日球层顶期间防淡出：参照 `src/data/specialBodies.ts` `isGalaxyAnchoredFocusId`（:454-460）的聚焦权重提升模式；`Heliopause.tsx` 可见窗口为连续层级 1.8–3.0。
- 面板"飞往/跟随"按钮位于 `src/components/UI/HudInfo.tsx` :429-451。

## 验收标准
1. L3 下点击日球层顶 → 面板弹出 → 按 1/2/4 切换视角 → 面板自动关闭、无跟随残留。
2. 点"飞往"→ 2.5 秒运镜后完整看到半透明球壳与标注，HUD 显示跟随模式，Esc 可退出。
3. 连续滚轮从 L2 缩放到 L3 期间选中面板不被强制关闭。
4. 新增纯逻辑（解析分支、null 兜底）单元测试；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：逐条复验上述验收标准。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-1 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 用 Grep 定位符号，勿整读大文件；先写纯函数与单测再接组件。
````

## R2-2：人造卫星巨大化修复 + 近观细节视角域门控

````markdown
# 任务：实现 R2-2 人造卫星角尺寸钳制 + 行星近观细节视角域门控

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-2 + §0.2 表第 6 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 根因（已调研确认，直接采信）
飞往地球的运镜路径可能穿过人造卫星轨道（半径 0.77–1.9 单位）；`satelliteNearMagnification`（`src/utils/satellites.ts:169-196`）在相机距离 ≤2.2 单位时恒 3× 放大且**无角尺寸上限** → 透视投影下卫星瞬间铺满屏幕（"有时发生"取决于卫星当帧相位与进场方向）。

## 实现要点
1. **角尺寸钳制**（新增纯函数入 `satellites.ts`）：卫星投影角尺寸超过屏幕高度约 10% 时按比例缩小显示尺寸，连续平滑（非阶跃）；相机距离→0 时透明度平滑淡出而非继续放大。接入 `src/components/CelestialBody/SatelliteModel.tsx` :127-133 的每帧 scale 计算。
2. **过渡期冻结**：飞往运镜进行中（`flyToBodyId` 非空）或视角锚点过渡 2 秒窗口内，近观放大固定 1×；到达跟随后 ≤1 秒平滑恢复，无尺寸跳变。
3. **视角域门控**：人造卫星 glTF 细节层仅在 L1 语境且跟随/锚定目标属于地球系统（地球/月球/该卫星本身）时激活；判定复用 `utils/bodyCycle.cycleControlVisible` 模式，新增"目标行星系统一致"纯函数并单测；行星 4K/法线近观门控现状见 `src/utils/planetDetail.ts:27-37`（`detailGateUpdate`），补同款显式判定。

## 验收标准
1. 从 L2/L3/L4 反复切换到地球视角 ≥20 次（不同模拟时间相位），卫星无一次铺满屏幕，最大屏占比 ≤ 屏幕高度约 10%。
2. 跟随地球时近观放大体验不回退；跟随火星/木星时地球卫星无近观放大。
3. 极限值单测（距离→0、模型跨度 0）；60 FPS 不跌破。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：逐条复验上述验收标准（含 20 次切换循环脚本）。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-2 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只动 `satellites.ts` / `SatelliteModel.tsx` / `planetDetail.ts` 及其测试，勿探索无关模块。
````

## R2-3：L3 下行星运动简化

````markdown
# 任务：实现 R2-3 消除 L3 视角下太阳系行星高速乱转窗口

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-3 + §0.2 表第 2 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 根因（已调研确认，直接采信）
行星冻结硬阈值 `continuousLevel > 3.2`（`Planet.tsx:47` `FREEZE_LEVEL_THRESHOLD`、`Comet.tsx:242/:361`、`SolarSystem.tsx:23-24` 三处魔法数字重复），而 L3 锚点 ≈3.0、该处时间压缩已按对数插值达 2×10⁶ 年/秒 → 连续层级 2.5–3.2 区间行星每帧数千圈视觉乱跳。行星无速率钳制（仅卫星有，`Moon.tsx:160-192`；`rateClampFactor` 在 `utils/time.ts:141-154`，0.5 圈/秒阈值）。

## 实现要点
1. 阈值常量收敛到单一纯逻辑模块（`utils/time.ts` 或新建 `utils/freezeGate.ts`）：硬阈值改为**渐变淡出区间**（建议 2.6→3.0 淡出完毕，与 `Belt.tsx:121` 的 2.6–3.2 节奏协调）；行星/彗星/矮行星与其轨道线同步淡出；Grep 定位 `FREEZE_LEVEL_THRESHOLD` 全部引用统一替换为新模块导出。
2. 淡出区间内行星仍部分可见时，对公转视觉角速度应用 `rateClampFactor`（累计相位无跳变）；钳制激活时复用现有提示机制，文案区分"行星运动已减速显示"。
3. 太阳本体 L3 保持可见（太阳系标记热区依赖）；返回 L2/L1 按共享 `simDays` 重新求值位置，无时间跳变。

## 验收标准
1. L3 锚点视角观察 ≥30 秒：无行星高速乱转/闪烁跳动。
2. 连续层级 2.4→3.2 缓慢缩放全程行星平滑淡出，无突变。
3. L3 停留任意时长后按 2 返回太阳系视角：行星相位与模拟时间一致，无跳变。
4. 淡出曲线/速率钳制纯函数单测 + 相位连续性回归测试（现有 timeP2 套件扩展）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：逐条复验上述验收标准。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-3 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- Grep 定位 `FREEZE_LEVEL_THRESHOLD` 一次性收敛，勿逐文件探索；先写纯函数与单测再接组件。
````

## R2-4：动态事件视角域隔离

````markdown
# 任务：实现 R2-4 动态事件视角域隔离（通知/演示按钮/自动触发按层级门控）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-4 + §0.2 表第 4 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 现状（已调研确认，直接采信）
- 事件通知（`src/components/UI/HudInfo.tsx:135-297`）与演示按钮（`src/components/UI/ControlPanel.tsx:234-304`）均不感知 viewLevel。
- 耀斑/CME 自动触发在 L3/L4 停摆仅是 `SunActivity.tsx:447` `timeJumped`（Δ>50 天）守卫的**副作用**，非显式设计。
- 超新星特效 L1/L2 不可见（`Supernova.tsx:54-55` 门控 2.5 起）但通知照发。

## 实现要点
1. 新建纯逻辑 `src/utils/eventScopes.ts`：事件→视角域窗口映射（耀斑/CME/CME 抵达 ≤2.4；超新星 ≥2.5；合并预览 ≥3.6），提供三层判定——自动触发域 / 通知可见域 / 按钮可用域，全部单测。
2. 通知过滤：域外隐藏（事件状态照常推进，回域内且事件仍活跃时通知恢复）；域外折叠为一行小字提醒（默认方案 b："XX 事件进行中（切回对应视角查看）"）；"飞往观看"点击后自动切换到事件所属视角域。
3. 演示按钮：域外置灰禁用 + tooltip"请切换到 XX 视角触发"（默认方案，登记）。
4. 自动触发显式限定域（移除对 `timeJumped` 副作用的依赖，但保留 `timeJumped` 本身的时间跳变防护语义）；超新星自动触发补显式判定与注释。

## 验收标准
1. L3/L4 下无耀斑/CME 通知弹出；耀斑/CME 演示按钮置灰并有提示。
2. L1/L2 下无超新星通知弹出；快进后切到 L3，活跃超新星事件通知恢复。
3. 事件状态机（触发/衰减/遗迹归档）不受视角切换影响，域外期间事件正常演化。
4. `eventScopes` 三层窗口纯函数单测全覆盖；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：四视角 × 四类事件矩阵逐格复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，此项属行为变更务必登记）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-4 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- UI 改动集中在 HudInfo/ControlPanel 两文件的通知/按钮块，用 Grep 定位 `noticeVisible` 引用即可，勿整读文件。
````

## R2-5：通用天体切换序列框架

````markdown
# 任务：实现 R2-5 通用天体切换序列框架（L2/L3/L4 各视角"上一个/下一个"）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-5 + §0.2 表第 5 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R2-1 已交付（heliopause 可飞往、切视角自动关面板）。

## 关键实现锚点（直接采信，勿全量探索）
- `src/utils/bodyCycle.ts`：`BODY_CYCLE_SEQUENCE`（20 个太阳系天体，:19-40）、`cycleBodyId`（:59-64）、`cycleControlVisible`（:83-86）。
- `src/components/UI/BodyCycleSwitcher.tsx`（现仅 L1 语境显示）、`src/hooks/useKeyboardShortcuts.ts:71-81`（`[`/`]` 键）、store `cycleAnchorBody`（:430-439）。
- L3 序列成员 id 来源 `src/data/specialBodies.ts`；L4 来源 `src/data/galaxies.ts` + 河外特殊对象。

## 实现要点
1. **纯逻辑扩展**（bodyCycle.ts 或新建 cycleScopes.ts）：三个视角域序列——L1/L2 现状 20 天体不动；L3 按"太阳系（标记/日球层顶）→ 银心人马座 A* → 恒星类 → 星云类 → 星团类"组织（成员以 specialBodies 实际 id 为准，顺序在代码注释登记）；L4 为 银河系→LMC→SMC→人马座矮→M31→M33→M87→3C 273（以实际 id 为准）。接口：`scopeForViewLevel(continuousLevel, followBodyId)`、`cycleBodyIdInScope(scope, currentId, dir)`；不在序列内回落域默认天体（L3=sgr-a-star、L4=M31）；每域独立记忆上次锚定天体（store 扩展，会话内）。
2. **UI 与快捷键**：BodyCycleSwitcher 泛化按域展示「← 上一个 | 当前天体名 序列位置 | 下一个 →」；`[`/`]` 按域路由；HelpHint 更新；信息面板中天体属于当前域序列时补"上一个/下一个"小按钮（与底部控件行为一致）。
3. **飞往联动**：L3 域全部成员纳入聚焦权重提升白名单（`specialBodies.ts` `isGalaxyAnchoredFocusId` 扩展，含 heliopause）；逐成员核对 `resolveFocusTarget` 观察距离（星云/星团看整体形态、恒星看表面细节）。

## 验收标准
1. L3 下按 `]` 遍历全序列一整圈：每个目标运镜平滑、到达后完整可见（无淡出残影）、HUD 序列位置正确。
2. L4 下同样遍历一整圈通过。
3. L1/L2 现有 20 天体序列行为不回退（现有单测全绿）。
4. 域判定/循环/回落/记忆纯逻辑单测全覆盖；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：L3/L4 全序列遍历脚本逐目标截图。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-5 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 先写纯逻辑+单测，再改 UI；序列成员 id 用 Grep 从 data 文件一次性提取，勿逐个探索组件。
````

## R2-6：太阳系绕银心运动可感知增强

````markdown
# 任务：实现 R2-6 太阳系绕银心轨道运动可感知细节增强

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-6 + §0.2 表第 2 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R2-3 已交付（L3 行星乱转已消除）。

## 背景（直接采信）
P6 已交付：历史尾迹+虚线预测弧+流动刻度光点（`Galaxy.tsx:220-297`）、垂直振荡视觉增益 ×6（`utils/galacticMotionCues.ts:31`）、G 键银心固定模式（`utils/galacticFrame.ts` 双参考系混合）。用户仍反馈"看不出在轨道上动"。本阶段目标：**默认跟随模式下 10 秒内肉眼可辨太阳系沿轨道运动**。

## 实现要点
1. 轨道当前位置脉动高亮标记（与 "You are here" 联动）；已走过/未来弧段视觉对比调亮。
2. 参照物滑动增强：旋臂对比特征或 2–3 个邻近特殊天体标记相对太阳系的滑动在 L3 锚点距离下可辨（具体手段实现时评估，验收以效果为准）。
3. 垂直振荡波浪轨迹默认视角可辨（增益可提升至 ≤×10，更新文件头登记）。
4. G 键模式可发现性：控制面板/帮助显式入口 + L3 首次切入一次性 toast 提示"按 G 切换银心固定视角观察太阳系公转"。
5. HUD 银河年进度与轨道标记位置一致性验收。
6. 所有视觉增益/艺术化调整登记代码文件头（AGENTS.md 数据准确性要求）。

## 验收标准
1. L3 锚点默认视角、默认速度下，10 秒内肉眼可辨太阳系沿轨道运动（标记移动 + 参照物滑动）。
2. G 键银心固定模式下太阳系沿波浪轨迹绕银心运动清晰（回归验收）。
3. 新增纯逻辑（标记相位/增益曲线）单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：间隔 10 秒截取两帧对比位置差可辨并登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-6 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 改动集中 `Galaxy.tsx` / `galacticMotionCues.ts` / ControlPanel / HelpHint，勿探索太阳系渲染模块。
````

## R2-7：L3 飞往目标近观细节升级

````markdown
# 任务：实现 R2-7 L3 飞往/跟随目标近观细节升级（日球层顶结构 + 特殊天体近观 LOD）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-7 + §0.2 表第 3 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R2-1（heliopause 可飞往）与 R2-5（L3 域序列）已交付。

## 背景（直接采信）
P6 已升级恒星表面 shader（3D 噪声对流/临边昏暗）与部分星云丝状纹理。**实现前逐对象核对现状，只做增量，勿重复建设。**

## 实现要点
1. **日球层顶近观三层结构**（组件 `Heliopause.tsx`、纯逻辑 `utils/heliopause.ts`）：终端激波（~94 AU 示意内壳）→ 日鞘渐变区 → 日球层顶外边界（半透明多层壳+着色渐变，压缩比例沿用现有登记）；旅行者 1 号（2012 穿越）/ 2 号（2018）位置标记点 + 点选科普卡片（catalog 扩展，来源 NASA/JPL Voyager Interstellar Mission）；迎风/背风不对称水滴形可选做（不做则面板登记"真实为彗尾状不对称"）。
2. **近观 LOD 门控**：为 L3 域序列每个成员定义近观激活距离，复用 `utils/planetDetail.detailGateUpdate` 滞回门控模式；仅当前跟随目标激活，离开即释放，无内存泄漏。
3. **逐对象增量**：星云类（猎户座/环状/蟹状/马头）近观不呈单张圆形光晕（体积感/丝状纹理）；星团类（M13/昴星团）近观粒子数/大小分级提升+圆形软边（无方块粒子）；天狼星 A/B 近观互绕运动与大小颜色对比清晰；脉冲星近观射束扫描+脉冲节奏清晰。粒子增量计入全局 ≤20,000 峰值预算。

## 验收标准
1. 通过 R2-5 序列遍历 L3 全部成员：每个目标近观形态可辨识，无"圆形光晕糊一团"观感（逐一截图核对登记）。
2. 日球层顶近观三层结构可辨 + 旅行者标记可点选。
3. 连续切换 10 个目标后 JS 堆稳定（无泄漏）；60 FPS 不跌破。
4. 门控/结构纯函数单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：L3 序列逐成员近观截图 + FPS + JS 堆登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-7 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 逐对象先 Read 对应组件现状再决定增量，勿整目录重读；复用现有噪声/贴图基元（nebulaTextures、hash3/valueNoise3），勿新造。
````

## R2-8：L4 星系近观 3D 粒子层

````markdown
# 任务：实现 R2-8 L4 飞往星系近观细节升级（贴图平面 → 3D 粒子近观层）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-8 + §0.2 表第 3 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R2-5（L4 域序列）与 R2-9（银河系粒子风格基准）已交付。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/Universe.tsx` `GalaxyObject`（:70-196）：现为 planeGeometry + `createGalaxySpriteCanvas` 程序化贴图、固定朝向（id 哈希）、非 billboard——薄片问题根源。
- `src/utils/cameraFocus.ts` :141-174：星系飞往解析分支。
- `src/utils/galaxy.ts`：粒子生成器可参数化复用，勿重写。

## 实现要点
1. **近观 3D 粒子层**：跟随星系时激活——旋涡星系（M31/M33）= 核球+盘+旋臂粒子；不规则（LMC/SMC）= 团块状粒子云；椭圆/矮椭圆（M87/M32/M110）= Sérsic 亮度分布椭球云。单星系 ≤8,000 粒；同时最多 1 个星系持有近观层（LRU 同 P4 模式）；确定性种子=星系 id（两次飞往形态一致）。
2. **贴图平面过渡**：近观层激活时贴图交叉淡出、释放时淡入，无突变；远观非跟随保持现状，性能零回退。
3. **薄片修复**：非近观侧向观察时 billboard 面向相机，或维持固定朝向但按掠射角补偿透明度（二选一并登记；注意 M31 倾角 77° 为真实观测特征，billboard 需登记艺术化差异）。
4. M87 近观保留喷流联动；跟随星系时信息面板补结构说明（核球/盘/晕，标注数据来源）。

## 验收标准
1. 飞往 M31：贴图平滑过渡到 3D 粒子结构，旋臂/核球立体可辨，绕行观察无薄片观感。
2. 遍历 L4 序列全部成员：每个星系近观形态与其类型（旋涡/棒旋/椭圆/不规则）一致。
3. 粒子预算与 LRU 释放单测；60 FPS 不跌破（实测登记）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：L4 序列逐星系近观截图 + FPS 登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-8 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 粒子生成参数化复用 `utils/galaxy.ts` 现有函数；先做 M31 打样验收通过后再批量套用到其余星系。
````

## R2-9：L4 银河系真实感重构

````markdown
# 任务：实现 R2-9 L4 银河系真实感重构（3D 银晕/球状星团/棒结构/尘埃带/风格统一）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-9 + §0.2 表第 8 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/Galaxy.tsx`：4 万粒子盘（:53），shader 粒子最小 1.2px（:175），可见权重平台延伸到 4.5（:389-407，L4 下即此粒子盘）；核球/银晕为两张 billboard 辉光 sprite（:563-585）——扁平观感根源。
- `src/utils/galaxy.ts` :354-390：核球粒子压扁球 0.6、盘粒子高斯厚度——粒子分布生成器，新增分布函数入此模块镜像。

## 实现要点
1. **3D 恒星银晕**：2,000–4,000 稀疏粒子球壳（径向密度 ∝ r^-3.5 近似）替代/叠加银晕 sprite，任意角度观察均有立体包裹感。
2. **球状星团系统**：银晕内 20–40 个确定性小点簇（中心聚集+高银纬分布，参考真实球状星团系统）；M13 与 L3 特殊天体条目联动，同一对象不重复渲染。
3. **核球/棒结构**：银河系为棒旋 SBbc——俯视可辨棒状核心粒子分布；核球辉光椭球感增强（sprite 按视角轴比着色或小规模粒子增补）。
4. **尘埃带**：侧视时盘中平面暗尘埃带剪影（现有 shader 若已含则验收确认侧视效果，不足则补盘中平面吸光暗带）。
5. **风格统一**：与 M31（贴图/R2-8 粒子层）同屏（合并预览场景）亮度、色调、颗粒感协调，以同屏截图验收。
6. 粒子增量登记 L4 场景总粒子预算；较差自转/密度波现有 shader 管线勿破坏。

## 验收标准
1. L4 下绕银河系一周观察：正视旋臂清晰、侧视盘厚度+尘埃带+银晕立体包裹、俯视棒结构可辨，无"二维贴纸"观感。
2. 球状星团点簇可辨。
3. 新增分布纯函数（银晕密度/星团位置/棒结构）单测；60 FPS 不跌破；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：正视/侧视/俯视多角度截图 + FPS 登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-9 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 分布函数先写纯逻辑+单测，再接 BufferGeometry；复用现有盘粒子 shader 管线，勿另起渲染路径。
````

## R2-10：L4 轨迹与运动一致性

````markdown
# 任务：实现 R2-10 L4 轨迹与运动一致性（卫星星系轨道线/direction 修复/人马座矮星系运动/M31 进度感）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-10 + §0.2 表第 9 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 现状（已调研确认，直接采信）
- LMC/SMC 位置 = `utils/universe.ts:109-132` `satelliteGalaxyPositionLy`（圆轨道+倾角，参数 `data/galaxies.ts:193-196`），但**无轨道线**；且公式**忽略 `galaxy.direction`**（与静态首帧位置 `Universe.tsx:155-164` 及天区语义矛盾）。
- 人马座矮星系完全静止（`Universe.tsx:148` 注释"其余星系静态"），而文案称"正被潮汐撕裂"。
- 麦哲伦星流拖尾（`Universe.tsx:319-342`）易被误读为轨道线。
- M31 接近虚线（:413-421）与实际位置同源（一致），仅缺"正在接近"的进度感（距离经对数压缩非线性）。

## 实现要点
1. **LMC/SMC 轨道线**：与 `satelliteGalaxyPositionLy` 同源公式生成椭圆/圆轨道线（含倾角姿态），随"轨道线开关"控制；**禁止两套参数**。
2. **direction 修复**：首帧位置 = direction × distance，轨道从该点起步，消除首帧跳变与面板文案矛盾；`cameraFocus.ts:161-171` 跟随解析同源回归验证。
3. **人马座矮星系**：极轨道缓慢运动（周期示意登记）+ 潮汐流粒子拖尾（≤1,500 粒，呼应"正被撕裂"文案）；数据不足则最低实现"可辨识位移+拖尾"并登记近似。
4. **星流澄清**：麦哲伦星流（弥散粒子带）与新增轨道线（细线）视觉区分；信息面板注明"星流为历史路径上剥离的气体"。
5. **M31 进度感**：接近虚线上增加等时间距刻度或流动光点（复用 `Galaxy.tsx` 流动刻度模式）。
6. **通用核对**：L4 全部运动对象逐一核对"轨迹线↔运动同源"并登记结论（M32/M110 随 M31、宇宙网静止属预期，面板说明）。

## 验收标准
1. 开启轨道线：LMC/SMC 快进 10× 观察 60 秒，位置始终在轨道线上无偏离。
2. 人马座矮星系有可辨识运动与潮汐拖尾，文案与视觉一致。
3. 跟随 LMC/SMC 时相机解析与渲染无错位（回归）。
4. 轨道公式/direction 修复/刻度相位纯函数单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：快进下 LMC/SMC 在轨道线上的两帧对比截图登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-10 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只动 `universe.ts` / `Universe.tsx` / `galaxies.ts` / `cameraFocus.ts` 相关分支及测试，勿探索无关模块。
````

## R2-11：银河系—仙女座合并后续演化

````markdown
# 任务：实现 R2-11 银河系—仙女座碰撞合并后续演化（穿越/回摆/扭曲/星暴/终态椭圆星系）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-11 + §0.2 表第 7 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：建议 R2-9 已交付（银河系粒子形态基础）。

## 现状（已调研确认，直接采信）
- 合并预览状态机：`src/store/index.ts` :309-336（tick 内 12 秒快进分支）/ :579-604（startMergePreview/restoreFromMergePreview）。
- "停滞"根因：`utils/universe.ts:57-64` `mwM31SeparationLy` clamp ≥0——合并时刻后 M31 与银河系原地重叠、辉光满值（`mergeGlowOpacity01` :156-168），仅标签换"已合并"。
- 渲染消费：`Universe.tsx:415-447`。

## 实现要点
1. **新建纯逻辑 `utils/galaxyMerger.ts`**（以合并时刻 T0 后的模拟时间驱动，确定性、可逆——时间回退即复原，重复预览结果一致）：
   - a) 首次穿越：分离距离过零后 M31 沿运动方向减速远离（替换 clamp≥0 语义）；
   - b) 回摆振荡：1–2 次减幅往返（阻尼近似动力摩擦，时间压缩登记）；
   - c) 形态插值：穿越期潮汐扭曲（银河系粒子盘顶点着色器扰动 + M31 侧贴图/粒子扭曲）；
   - d) 星暴亮度曲线：穿越时刻短暂蓝白增亮（气体压缩触发恒星形成，艺术化登记）；
   - e) 终态：核心并合后 5–10 秒（真实 ~20 亿年，压缩登记）过渡为椭球粒子云 Milkomeda（旋臂消失、色调偏老年恒星红黄）。
2. **HUD/信息联动**：各阶段 HUD 标签更新（首次穿越/回摆/并合完成 Milkomeda）；信息面板科普卡片（太阳系命运：大概率被抛入外围，恒星间碰撞概率极低；来源 van der Marel et al. 2012 / NASA GSFC 模拟）。
3. "恢复预览前时间"回退后场景全复原；粒子扰动走顶点着色器，CPU 零逐粒子分配。

## 验收标准
1. 点击"预览碰撞合并"：快进到 T0 后不停滞，完整呈现 穿越→回摆→扭曲→星暴→终态椭圆星系 序列。
2. "恢复预览前时间"回退全复原；重复预览确定性一致。
3. 分离距离曲线/振荡包络/形态插值/星暴曲线单测全覆盖；60 FPS 不跌破；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）：演化各阶段分别截图 + FPS 登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类，含实测数据）。
4. `IMPROVEMENT_REQUIREMENTS_2.md` §R2-11 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 曲线函数全部纯逻辑先行+单测，渲染只消费函数输出；勿引入物理模拟库。
````

## R2-12：集成回归验收 + 文档回写

````markdown
# 任务：执行 R2-12 集成回归验收 + 文档回写（R2 迭代收尾）

权威定义见 `IMPROVEMENT_REQUIREMENTS_2.md` 的 **§R2-12 + §0.1（9 个用户反馈点原文）+ 附录 A**。
**前置依赖**：R2-1 ~ R2-11 已全部交付。

## 任务清单
1. 全量 `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿；覆盖率 gate ≥90% 确认。
2. 无头 Chrome 端到端复验 9 个用户反馈点（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下各阶段既有模板），每点登记验证操作路径 + 截图/FPS：
   - ① L3 点日球层顶 → 切视角面板自动关 + 显示域切换控件；
   - ② L3 无行星乱转 + 太阳系沿轨道运动 10 秒内可辨；
   - ③ L3/L4 飞往目标近观细节（序列逐成员抽查）；
   - ④ 四视角 × 四类事件（耀斑/CME/超新星/合并）通知与按钮矩阵；
   - ⑤ 各视角域 `[`/`]` 遍历整圈；
   - ⑥ 地球视角切换 20 次卫星无铺屏；
   - ⑦ 合并预览完整演化序列（穿越→回摆→扭曲→星暴→终态）；
   - ⑧ L4 银河系正视/侧视/俯视立体感；
   - ⑨ LMC/SMC 快进下沿轨道线运动。
3. `CHANGELOG.md` `[Unreleased]` 按 新增/修复/改进 分类补全全部 R2 条目（含实测数据），查漏各阶段遗漏项。
4. `IMPROVEMENT_REQUIREMENTS_2.md` 全部 🔲 回写 ✅/🔶（实现差异逐条登记），文档版本升 1.x；REQUIREMENTS.md 受影响小节同步更新。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 复验脚本复用各阶段已有 CDP 模板按 9 点顺序批量执行；文档回写用精准替换状态标记，勿重写全文。
````
