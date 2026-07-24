# 改进需求第二批（R2）— 各阶段 Agent 实现提示词

> 用法：每个阶段单独开一个任务，把对应提示词整段发给 Agent。权威需求定义在 `IMPROVEMENT_REQUIREMENTS_2.md`（下称"需求文档"），提示词只给锚点与边界，Agent 开工前**只需读需求文档的指定小节 + 附录 A**，无需通读全文，以降低 token 消耗。
> 建议顺序：R2-1 → R2-2 → R2-3 → R2-4 → R2-5 → R2-6 → R2-7 → R2-9 → R2-10 → R2-8 → R2-11 → R2-12。
> 每个任务收尾流程统一（写入各提示词）：`npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿 → 无头 Chrome 目验（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`，CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板）→ 更新 `CHANGELOG.md [Unreleased]` → 需求文档对应小节 🔲 回写 ✅/🔶 → 遵循 AGENTS.md Git 流程（开工前询问是否新建分支，完成后询问是否创建 PR）。

---

## R2-1 提示词：视角切换关面板 + 日球层顶飞往修复

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-1（视角切换自动关闭信息面板 + 外围结构飞往解析修复），硬性约束见该文档附录 A。开工前只读 §R2-1、§0.2 表第 1 行与附录 A。

关键锚点（直接采信，勿全量探索）：
- src/store/index.ts setViewLevel（约 :344-369）：现清 followBodyId/flyToBodyId，需补清 selectedBodyId/selectedSolarFeature；注意仅"显式锚点切换"清空，连续缩放跨层级不清。
- src/utils/cameraFocus.ts resolveFocusTarget（约 :228-306）：无 heliopause/oort-cloud 分支 → 点飞往后假跟随死锁。补 heliopause 分支（目标=太阳系原点，观察距离 ≈ 2.2×HELIOPAUSE_VISUAL_RADIUS_UNITS=380，见 src/utils/heliopause.ts:27）；并做 null 兜底：解析失败时 requestFlyTo 不得写入 followBodyId。
- 跟随日球层顶期间防淡出：参照 src/data/specialBodies.ts isGalaxyAnchoredFocusId（:454-460）聚焦权重提升模式，Heliopause.tsx 可见窗口 1.8-3.0。
- 面板按钮在 src/components/UI/HudInfo.tsx :429-451。

验收：L3 点日球层顶→切视角→面板自动关、无跟随残留；飞往日球层顶可见完整球壳并跟随，Esc 退出；连续滚轮缩放不闪关面板；新逻辑单测 + 覆盖率 gate ≥90% 保持。
省 token：用 Grep 定位符号，勿整读大文件；先写纯函数与单测再接组件。
```

## R2-2 提示词：人造卫星巨大化修复 + 近观细节视角域门控

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-2（人造卫星角尺寸钳制 + 行星近观细节视角域门控），硬性约束见附录 A。开工前只读 §R2-2、§0.2 表第 6 行与附录 A。

根因（已调研确认）：飞往地球运镜路径可能穿过人造卫星轨道（半径 0.77–1.9 单位），satelliteNearMagnification（src/utils/satellites.ts:169-196）距离 ≤2.2 时恒 3× 放大且无角尺寸上限 → 透视下铺满屏幕。

实现要点：
1. 新增纯函数（satellites.ts）：角尺寸钳制——卫星投影角尺寸超屏幕高度 ~10% 时按比例缩小，连续平滑；距离→0 时透明度淡出而非放大。接入 src/components/CelestialBody/SatelliteModel.tsx :127-133 每帧 scale。
2. 运镜/视角过渡期间（flyToBodyId 非空或锚点过渡 2 秒窗口）近观放大固定 1×，到达跟随后 ≤1 秒平滑恢复。
3. 视角域门控：人造卫星 glTF 细节层仅在 L1 语境且跟随目标属于地球系统（地球/月球/该卫星）时激活；判定复用 utils/bodyCycle.cycleControlVisible 模式，新增"目标行星系统一致"纯函数并单测。近观门控现状见 src/utils/planetDetail.ts:27-37（detailGateUpdate）。

验收：反复切地球视角 ≥20 次（不同模拟时间）卫星无一次铺屏；跟随地球近观体验不回退；跟随火星时地球卫星无放大；极限值单测（距离→0、跨度 0）；60 FPS 保持。
省 token：只动 satellites.ts / SatelliteModel.tsx / planetDetail.ts 及其测试，勿探索无关模块。
```

## R2-3 提示词：L3 下行星运动简化

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-3（消除 L3 视角行星高速乱转窗口），硬性约束见附录 A。开工前只读 §R2-3、§0.2 表第 2 行与附录 A。

根因（已调研确认）：行星冻结硬阈值 continuousLevel>3.2（Planet.tsx:47 FREEZE_LEVEL_THRESHOLD、Comet.tsx:242/:361、SolarSystem.tsx:23-24 三处重复），而 L3 锚点 ≈3.0、时间压缩已达 2×10⁶ 年/秒 → 2.5–3.2 区间行星每帧数千圈乱跳。行星无速率钳制（卫星有，Moon.tsx:160-192；rateClampFactor 在 utils/time.ts:141-154）。

实现要点：
1. 阈值常量收敛到单一纯逻辑模块（utils/time.ts 或新建 utils/freezeGate.ts）：硬阈值改为渐变淡出区间（建议 2.6→3.0 淡出完毕，与 Belt.tsx:121 的 2.6–3.2 节奏协调），行星/彗星/矮行星/轨道线同步淡出。
2. 淡出区间内对行星公转视觉角速度应用 rateClampFactor（累计相位无跳变），钳制提示文案区分"行星运动已减速显示"。
3. 太阳本体 L3 保持可见（太阳系标记热区依赖）；返回 L2 按共享 simDays 重新求值，无时间跳变。

验收：L3 锚点观察 30 秒无乱转；2.4→3.2 缓慢缩放全程平滑淡出；返回 L2 相位正确；淡出/钳制纯函数单测 + 相位连续性回归；覆盖率 gate 保持。
省 token：Grep 定位 FREEZE_LEVEL_THRESHOLD 全部引用一次性替换为新模块导出，勿逐文件探索。
```

## R2-4 提示词：动态事件视角域隔离

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-4（事件通知/演示按钮/自动触发按视角域门控），硬性约束见附录 A。开工前只读 §R2-4、§0.2 表第 4 行与附录 A。

现状（已调研确认）：事件通知（HudInfo.tsx:135-297）与演示按钮（ControlPanel.tsx:234-304）均不感知 viewLevel；耀斑/CME 自动触发在 L3/L4 停摆仅是 SunActivity.tsx:447 timeJumped（Δ>50 天）守卫的副作用；超新星特效 L1/L2 不可见（Supernova.tsx:54-55 门控 2.5 起）但通知照发。

实现要点：
1. 新建纯逻辑 src/utils/eventScopes.ts：事件→视角域窗口映射（耀斑/CME/CME抵达 ≤2.4；超新星 ≥2.5；合并预览 ≥3.6），提供三层判定：自动触发域 / 通知可见域 / 按钮可用域，全部单测。
2. 通知过滤：域外隐藏（事件状态照常推进，回域内恢复显示）；域外折叠为一行小字提醒（默认方案 b，见需求）。"飞往观看"点击自动切到事件所属视角域。
3. 演示按钮域外置灰 + tooltip"请切换到 XX 视角触发"。
4. 自动触发显式限定域（移除对 timeJumped 副作用的依赖，保留 timeJumped 本身的时间跳变防护语义）。

验收：L3/L4 无耀斑/CME 通知、按钮置灰；L1/L2 无超新星通知；域外期间事件状态机正常演化；eventScopes 单测全覆盖；CHANGELOG 登记行为变更。
省 token：UI 改动集中 HudInfo/ControlPanel 两文件的通知/按钮块，用 Grep 定位 noticeVisible 引用即可。
```

## R2-5 提示词：通用天体切换序列框架（各视角上一个/下一个）

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-5（L2/L3/L4 视角域切换序列 + 控件泛化），硬性约束见附录 A。开工前只读 §R2-5、§0.2 表第 5 行与附录 A。依赖 R2-1 已交付（heliopause 可飞往、面板切视角自动关）。

现状锚点：utils/bodyCycle.ts（BODY_CYCLE_SEQUENCE 20 个太阳系天体、cycleBodyId :59-64、cycleControlVisible :83-86）、BodyCycleSwitcher.tsx（仅 L1 语境显示）、useKeyboardShortcuts.ts:71-81（[/] 键）、store cycleAnchorBody（:430-439）。L3 成员 id 在 src/data/specialBodies.ts，L4 在 src/data/galaxies.ts + 河外对象。

实现要点：
1. 纯逻辑扩展（bodyCycle.ts 或新建 cycleScopes.ts）：三个域序列（L1/L2 现状 20 天体不动；L3 按"太阳系→银心→恒星类→星云类→星团类"组织，成员以 specialBodies 实际 id 为准；L4 银河系→LMC→SMC→人马座矮→M31→M33→M87→3C 273）；接口 scopeForViewLevel(continuousLevel, followBodyId) / cycleBodyIdInScope(scope, id, dir)；域默认天体 L3=sgr-a-star、L4=M31；每域独立记忆上次锚定（store 扩展）。
2. BodyCycleSwitcher 泛化按域展示；[/] 键按域路由；HelpHint 更新；信息面板天体属于当前域序列时补"上一个/下一个"小按钮。
3. 飞往联动：L3 域全部成员纳入聚焦权重提升白名单（specialBodies.ts isGalaxyAnchoredFocusId 扩展，含 heliopause）；逐成员核对 resolveFocusTarget 观察距离（星云/星团看整体、恒星看细节）。

验收：L3 按 ] 遍历整圈每个目标完整可见无残影、HUD 位置正确；L4 同样通过；L1/L2 现有序列单测全绿不回退；域判定/循环/回落/记忆单测全覆盖。
省 token：先写纯逻辑+单测，再改 UI；成员 id 用 Grep 从 data 文件一次性提取。
```

## R2-6 提示词：太阳系绕银心运动可感知增强

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-6（L3 默认视角下太阳系沿银心轨道运动可感知），硬性约束见附录 A。开工前只读 §R2-6、§0.2 表第 2 行与附录 A。依赖 R2-3 已交付（行星乱转已消除）。

背景：P6 已有历史尾迹+虚线预测弧+流动刻度光点（Galaxy.tsx:220-297）、垂直振荡视觉增益 ×6（utils/galacticMotionCues.ts:31）、G 键银心固定模式（utils/galacticFrame.ts 双参考系混合）。用户仍反馈"看不出在轨道上动"——本阶段目标是默认跟随模式下 10 秒内肉眼可辨运动。

实现要点：
1. 轨道当前位置脉动高亮标记（与 You are here 联动），已走过/未来弧段对比调亮。
2. 参照物滑动增强：旋臂对比特征或 2–3 个邻近特殊天体标记相对太阳系滑动可辨（手段自行评估，验收以效果为准）。
3. 垂直振荡波浪轨迹默认视角可辨（增益可提升至 ≤×10，更新文件头登记）。
4. G 键模式可发现性：控制面板/帮助显式入口 + L3 首次切入 toast 提示。
5. HUD 银河年进度与轨道标记位置一致性验收。

验收：L3 锚点默认速度 10 秒内肉眼可辨太阳系沿轨道运动；无头 Chrome 间隔 10 秒两帧截图位置差可辨并登记；G 模式回归；新增纯逻辑（标记相位/增益）单测；艺术化增益登记文件头。
省 token：改动集中 Galaxy.tsx / galacticMotionCues.ts / ControlPanel / HelpHint，勿探索太阳系渲染模块。
```

## R2-7 提示词：L3 飞往目标近观细节升级

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-7（日球层顶近观结构 + L3 特殊天体近观 LOD），硬性约束见附录 A。开工前只读 §R2-7、§0.2 表第 3 行与附录 A。依赖 R2-1（heliopause 可飞往）与 R2-5（L3 序列）已交付。

背景：P6 已升级恒星表面 shader（3D 噪声对流/临边昏暗）与部分星云丝状纹理——实现前逐对象核对现状，只做增量，勿重复建设。

实现要点：
1. 日球层顶近观三层结构：终端激波（~94 AU 内壳）→ 日鞘渐变 → 日球层顶外界；旅行者 1/2 号位置标记 + 点选科普卡（catalog 扩展，来源 NASA/JPL）；迎风/背风不对称可选（不做则面板登记"真实为彗尾状"）。组件 Heliopause.tsx、utils/heliopause.ts。
2. 近观 LOD 门控：L3 序列每成员定义近观激活距离，复用 utils/planetDetail.detailGateUpdate 滞回模式；仅当前跟随目标激活，释放无泄漏。
3. 逐对象增量：星云近观不呈单张圆形光晕（体积感/丝状）；星团近观粒子分级提升+圆形软边；天狼星双星近观互绕与大小颜色对比；脉冲星近观射束扫描清晰。粒子增量计入 ≤20,000 全局预算。

验收：R2-5 序列遍历 L3 全部成员，无头 Chrome 逐一截图核对"无圆形光晕糊团"并登记；日球层顶三层+旅行者标记可点选；切换 10 个目标后 JS 堆稳定；60 FPS 保持；门控/结构纯函数单测。
省 token：逐对象先 Read 对应组件现状再决定增量，勿整目录重读；共用噪声/贴图基元（nebulaTextures、hash3/valueNoise3）勿新造。
```

## R2-8 提示词：L4 星系近观 3D 粒子层

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-8（飞往星系时贴图平面升级为 3D 粒子近观层），硬性约束见附录 A。开工前只读 §R2-8、§0.2 表第 3 行与附录 A。建议在 R2-5（L4 序列）与 R2-9（银河系粒子风格基准）之后实施。

现状锚点：src/components/Scene/Universe.tsx GalaxyObject（:70-196）——planeGeometry + createGalaxySpriteCanvas 程序化贴图、固定朝向（id 哈希）、非 billboard；resolveFocusTarget 星系分支在 utils/cameraFocus.ts:141-174；粒子生成器可参数化复用 utils/galaxy.ts。

实现要点：
1. 近观 3D 粒子层：跟随星系时激活（旋涡=核球+盘+旋臂；不规则=团块云；椭圆 M32/M110/M87=Sérsic 椭球云），单星系 ≤8,000 粒，同时最多 1 个持有（LRU 同 P4 模式）；确定性种子=星系 id。
2. 贴图平面交叉淡入淡出过渡，无突变；远观非跟随保持现状零回退。
3. 薄片修复：非近观侧向观察时 billboard 或掠射角透明度补偿（二选一登记；M31 倾角 77° 为真实特征，billboard 需登记艺术化）。
4. M87 近观保留喷流联动；信息面板跟随时补结构说明。

验收：飞往 M31 平滑过渡到 3D 结构、绕行无薄片感；遍历 L4 序列每星系形态与类型一致；粒子预算/LRU 单测；60 FPS 实测登记。
省 token：粒子生成参数化复用 utils/galaxy.ts 现有函数，勿重写生成器；先做 M31 打样再批量套用。
```

## R2-9 提示词：L4 银河系真实感重构

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-9（L4 银河系 3D 银晕/球状星团/棒结构/尘埃带/风格统一），硬性约束见附录 A。开工前只读 §R2-9、§0.2 表第 8 行与附录 A。

现状锚点：Galaxy.tsx——4 万粒子盘（:53，shader 最小 1.2px :175，权重平台到 4.5 :389-407）、核球/银晕为 billboard 辉光 sprite（:563-585）；粒子分布生成在 utils/galaxy.ts:354-390（核球压扁球 0.6、盘高斯厚度）。

实现要点：
1. 3D 恒星银晕：2,000–4,000 稀疏粒子球壳（密度 ∝ r^-3.5 近似）替代/叠加 sprite，任意角度有立体包裹感。
2. 球状星团：银晕内 20–40 个确定性小点簇（中心聚集+高银纬分布）；M13 与 L3 特殊天体条目联动不重复渲染。
3. 核球/棒结构：银河系为棒旋 SBbc——俯视可辨棒状核心粒子分布；核球辉光椭球感增强。
4. 尘埃带：侧视盘中平面暗带剪影（现有 shader 若已有则验收确认，不足则补）。
5. 风格统一：与 M31（贴图/R2-8 粒子）同屏（合并预览）亮度色调协调。
新增分布纯函数（银晕密度/星团位置/棒结构）入 utils/galaxy.ts 镜像 + 单测；粒子增量登记预算。

验收：L4 绕银河系一周——正视旋臂清晰、侧视盘厚+尘埃带+银晕立体、俯视棒结构可辨、无二维贴纸感；无头 Chrome 多角度截图登记；60 FPS 保持。
省 token：分布函数先写纯逻辑+单测再接 BufferGeometry；复用现有盘粒子 shader 管线（较差自转/密度波勿破坏）。
```

## R2-10 提示词：L4 轨迹与运动一致性

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-10（卫星星系轨道线/direction 修复/人马座矮星系运动/M31 进度感），硬性约束见附录 A。开工前只读 §R2-10、§0.2 表第 9 行与附录 A。

现状锚点（已调研确认）：LMC/SMC 位置 = utils/universe.ts:109-132 satelliteGalaxyPositionLy（圆轨道+倾角，参数 data/galaxies.ts:193-196）但无轨道线，且公式忽略 galaxy.direction（与静态首帧位置 Universe.tsx:155-164 矛盾）；人马座矮星系完全静止（Universe.tsx:148）而文案称"正被潮汐撕裂"；麦哲伦星流拖尾 :319-342 易被误读为轨道；M31 接近虚线 :413-421 与实际位置同源（一致，仅缺进度感）。

实现要点：
1. LMC/SMC 轨道线：与 satelliteGalaxyPositionLy 同源公式生成（禁止两套参数），随轨道线开关控制。
2. direction 修复：首帧位置 = direction × distance，轨道从该点起步，消除首帧跳变；跟随时 cameraFocus 解析同源（:161-171 回归验证）。
3. 人马座矮星系：极轨道缓慢运动（周期示意登记）+ 潮汐流粒子拖尾（≤1,500 粒）；数据不足则最低"可辨识位移+拖尾"并登记近似。
4. 星流与轨道线视觉区分 + 面板注明"星流为历史剥离气体"；M31 接近虚线加等时刻度/流动光点（复用 Galaxy.tsx 流动刻度模式）。
5. L4 全部运动对象逐一核对"轨迹线↔运动同源"并登记结论（M32/M110 随 M31、宇宙网静止属预期，面板说明）。

验收：开轨道线后 LMC/SMC 快进 10× 观察 60 秒始终在线上；人马座矮有运动与拖尾；跟随 LMC/SMC 无相机错位；轨道公式/direction/刻度相位单测。
省 token：只动 universe.ts / Universe.tsx / galaxies.ts / cameraFocus.ts 相关分支及测试。
```

## R2-11 提示词：银河系—仙女座合并后续演化

```
实现 IMPROVEMENT_REQUIREMENTS_2.md §R2-11（合并时刻后的穿越/回摆/扭曲/星暴/终态椭圆星系演化），硬性约束见附录 A。开工前只读 §R2-11、§0.2 表第 7 行与附录 A。建议在 R2-9 之后实施（银河系粒子形态基础）。

现状锚点：合并预览状态机 store/index.ts:309-336/:579-604；utils/universe.ts——mwM31SeparationLy（:57-64，clamp≥0 是"停滞"根因）、MERGE_TARGET_SIM_DAYS（4500 Myr）、mergeGlowOpacity01（:156-168）；渲染 Universe.tsx:415-447。

实现要点：
1. 新建纯逻辑 utils/galaxyMerger.ts（T0=合并时刻后的模拟时间驱动，确定性、可逆——时间回退即复原）：
   a) 首次穿越：分离距离过零后 M31 沿运动方向减速远离（替换 clamp≥0）；
   b) 回摆振荡：1–2 次减幅往返（阻尼近似动力摩擦，压缩时间登记）；
   c) 形态插值：穿越期潮汐扭曲（银河系粒子盘顶点着色器扰动 + M31 侧扭曲）；
   d) 星暴亮度曲线：穿越时刻短暂蓝白增亮（艺术化登记）；
   e) 终态：核心并合后过渡为椭球粒子云 Milkomeda（旋臂消失、色调偏红黄）。
2. HUD 标签分阶段更新（首次穿越/回摆/并合完成）；信息面板科普卡（太阳系命运；来源 van der Marel et al. 2012 / NASA GSFC）。
3. "恢复预览前时间"回退全复原；重复预览确定性一致；粒子扰动走顶点着色器零 CPU 逐粒子分配。

验收：预览快进到 T0 后完整呈现穿越→回摆→扭曲→星暴→终态序列不停滞；回退复原；分离曲线/振荡包络/形态插值/星暴曲线单测全覆盖；无头 Chrome 分阶段截图登记；60 FPS 保持。
省 token：曲线函数全部纯逻辑先行+单测，渲染只消费函数输出；勿引入物理模拟库。
```

## R2-12 提示词：集成回归验收 + 文档回写

```
执行 IMPROVEMENT_REQUIREMENTS_2.md §R2-12（收尾）。前提：R2-1~R2-11 已全部交付。

任务：
1. 全量 npm test / type-check / lint / build 绿，覆盖率 gate ≥90% 确认。
2. 无头 Chrome 端到端复验 9 个用户反馈点（需求文档 §0.1），每点登记验证操作路径 + 截图/FPS：①L3 点日球层顶切视角面板自动关+域切换控件 ②L3 无行星乱转+太阳系沿轨道运动 10 秒可辨 ③L3/L4 飞往目标近观细节 ④四视角×四类事件通知/按钮矩阵 ⑤各域 [/] 遍历整圈 ⑥地球视角 20 次切换卫星无铺屏 ⑦合并预览完整演化序列 ⑧L4 银河系多角度立体感 ⑨LMC/SMC 沿轨道线运动。
3. CHANGELOG.md [Unreleased] 按 新增/修复/改进 分类补全全部 R2 条目（含实测数据）。
4. IMPROVEMENT_REQUIREMENTS_2.md 全部 🔲 回写 ✅/🔶（差异逐条登记），文档版本升 1.x；REQUIREMENTS.md 受影响小节同步。
5. 遵循 AGENTS.md Git 流程提交，询问是否创建 PR。

省 token：复验脚本复用各阶段已有 CDP 模板，按 9 点顺序批量执行；文档回写用 Edit 精准替换状态标记，勿重写全文。
```
