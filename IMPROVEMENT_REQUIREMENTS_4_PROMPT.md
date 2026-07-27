# 改进需求第四批（R4）— 各阶段 Agent 实现提示词

> **用法**：每个阶段单独开一个任务，将对应代码块内的提示词**整段复制**发给 Agent 即可，无需任何调整——每段提示词均已自包含：需求出处、关键实现锚点、实现要点、硬性约束、验收标准与完整收尾流程。
> **权威需求定义**：`IMPROVEMENT_REQUIREMENTS_4.md`（提示词内简称"需求文档"）。
> **建议实施顺序**：R4-1 → R4-2 → R4-5 → R4-3 → R4-4 → R4-6 → R4-9 → R4-7 → R4-8 → R4-10 → R4-11 → R4-12 → R4-13 → R4-14 → R4-15 → R4-16 → R4-17 → R4-18 → R4-19 → R4-20 → R4-21 → R4-22 → R4-23 → R4-24。
> **可并行组**：{R4-2, R4-5, R4-6, R4-9} 与体积框架线（R4-3/R4-4）互不依赖可并行。
> **人工检查点（强制）**：R4-3 / R4-7 / R4-11 / R4-12 交付后须由用户目检确认观感方向，方可启动其下游阶段（详见需求文档附录 A 第 8 条）。

---

## R4-1：开发预览工位

````markdown
# 任务：实现 R4-1 开发预览工位（/dev/preview 独立天体渲染验证页）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-1 + §0.2 表第 9 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 关键实现锚点（已调研核实，直接采信，勿全量探索；行号漂移时以符号名为准）
- 项目为 Next.js App Router（`src/app/`），新路由入 `src/app/dev/preview/page.tsx`。
- 首个预览样例组件：`src/components/Scene/SpecialBodies.tsx` `StellarSurface`（:104-220，shader 球，props 驱动）；参宿四配置见同文件 `RedGiant`（:447）。
- 天体 id 体系：`src/data/catalog.ts` `getBodyInfoById`；FPS/性能工具看 `src/utils/performance.ts` 有无现成能力。
- drei 已装（`@react-three/drei`），OrbitControls 直接用。

## 实现要点
1. 新建纯逻辑 `src/utils/devPreview.ts`：预览注册表 `previewEntryForBody(id)` + `PreviewParam { key, label, min, max, default }`（≤8 个滑杆/对象）；未注册 id 返回 null（页面显示占位提示）。
2. 预览页：独立 Canvas（黑背景 + 可选参考网格），不挂载主场景任何组件（无 Galaxy/Universe/SolarSystem/音频/store 主循环）；URL `?body=<id>`；OrbitControls + 曝光/Bloom 开关 + 时间流速 + 组件声明的滑杆；实时 FPS 与 JS 堆显示。
3. 生产安全：`NODE_ENV === 'production'` 下 404 或空页（二选一登记）；预览专用代码动态 import，主 bundle 零增大。
4. 注册首个对象 `betelgeuse`（StellarSurface + 参宿四参数），验证管线闭环。

## 验收标准
1. dev 模式（**3100 端口**）访问 `/dev/preview?body=betelgeuse` 可见恒星球体，滑杆实时生效，绕行 60 FPS。
2. 未注册 id / 缺参显示占位不报错；生产构建下路由不可用。
3. `devPreview.ts` 纯逻辑单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口，勿占用 3000）：逐条复验上述验收标准。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（按 新增/修复/改进 归类）。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-1 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只看 StellarSurface 的 props 签名即可接入，勿通读 SpecialBodies.tsx 全文。
````

## R4-2：细节层管理泛化

````markdown
# 任务：实现 R4-2 细节层管理泛化（统一近观细节层注册/门控/LRU/显存预算）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-2 + §0.2 表第 6 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 关键实现锚点（直接采信，勿全量探索）
- R2-7 门控：`src/utils/nearView.ts`（进入 = 飞往观察距离 ×1.5、退出 ×1.4 滞回，`useNearViewGate` Hook，0.5s 淡出后 dispose）。
- R2-8 LRU：`src/utils/galaxyNearView.ts` `nearViewLruUpdate`（容量 1）+ 持有者注册表；`NEAR_VIEW_TRANSITION_SECONDS`。
- 门控与 `resolveFocusTarget`（`src/utils/cameraFocus.ts`）观察距离同源，现有单测有断言先例（`nearViewR27` / `galaxyNearViewR28` 套件）。
- 位图纹理预算先例：`src/utils/textureBudget.ts`。

## 实现要点
1. 新建纯逻辑 `src/utils/detailLayer.ts`：`DetailLayerKind = 'particles'|'volume'|'lensing'|'starCatalog'`；`DetailLayerSpec {bodyId, kind, enterDistanceUnits, exitDistanceUnits, budget}`；门控阈值语义与现状逐项一致；LRU 按 kind 分池（particles/volume 各容量 1）；GPU 估算 `estimateGpuBytes(spec)` + 总预算 `DETAIL_GPU_BUDGET_BYTES = 64MB` 超限先逐出。
2. React 薄封装 `useDetailLayer(spec)` → `{active, opacity01}`（0.5s 交叉淡入淡出），卸载即 dispose。
3. 迁移 `nearView.ts` / `galaxyNearView.ts` 调用方到统一机制——**行为零回退**：阈值/LRU/时长逐项一致，现有单测全绿或等价迁移（迁移了哪些用例登记）。

## 验收标准
1. L3 15 站 + L4 8 站巡游回归：近观激活/释放正常，连续切换 10 个目标 JS 堆稳定，60 FPS。
2. 现有近观单测全绿（或等价迁移）；新增门控/LRU/预算单测；覆盖率 gate ≥90% 保持。
3. 无头 Chrome 巡游截图抽查与 R2-7/R2-8 交付观感一致（无回退）。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：L3/L4 巡游整圈复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-2 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 先 Read `nearView.ts` 与 `galaxyNearView.ts` 两文件全文（均为纯逻辑小文件），其余用 Grep 定位调用方；勿探索渲染组件内部实现。
````

## R4-3：体积渲染框架 ①

````markdown
# 任务：实现 R4-3 体积渲染框架 ①（raymarch 材质 + 3D 密度纹理工具 + 预览页测试体）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-3 + §0.3 方案 B + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-1 已交付（预览工位）。
**人工检查点**：本阶段交付后须等待用户目检确认观感方向，方可启动 R4-7。

## 关键实现锚点（直接采信，勿全量探索）
- log depth 兼容先例：`src/components/Scene/Starfield.tsx` :33（logdepthbuf include）；Canvas 启用 `logarithmicDepthBuffer`（`SolarSystemApp.tsx` :43）。
- 3D 噪声基元：项目已有 `hash3/valueNoise3`（Grep 定位，复用勿新造）；确定性种子先例 `src/utils/random.ts`（FNV-1a）。
- Bloom：`src/components/Scene/PostEffects.tsx`（选择性发光，亮度阈值）。

## 实现要点
1. 纯逻辑 `src/utils/volume.ts`：`buildDensityTexture(size, sampler)` → `THREE.Data3DTexture`（R8，size ≤128）；塑形基元（3D 噪声/fBm/球椭球壳 SDF 衰减/平滑并差）；CPU 发射-吸收积分参考实现（恒定密度解析解对比，用于单测校验 shader 同式）。
2. `src/components/Scene/volumetric/VolumeMaterial.ts`：raymarch ShaderMaterial 工厂——box 内固定步进（默认 64，uniform 16–128）、发射-吸收、双色映射（uColorA/uColorB）、相机盒内/盒外两种入射、depthWrite=false + renderOrder、log depth 兼容、uIntensity 控亮防 Bloom 溢出、预留 uTime/uQuality。
3. 预览页注册 `?body=volume-test`（球形 fBm 密度云 + 滑杆：步数/密度/双色）。
4. 本阶段不接主场景、不做半分辨率（R4-4 范围）。

## 验收标准
1. 预览页绕行密度云体积感真实（视差正确无 billboard 感）；64 步、占屏 ≤1/3 时 60 FPS。
2. 相机穿入盒内画面连续；与 Bloom 组合无发光异常、无 NaN。
3. 密度构建/塑形/CPU 积分校验单测（含确定性双次构建逐字节一致）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：预览页多角度 + 穿盒 + FPS 复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-3 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。
6. **提醒用户目检 `?body=volume-test` 确认观感方向后再开 R4-7。**

## 省 token 建议
- raymarch shader 自包含新建，勿改既有 shader；纯函数与单测先行，材质只消费纹理。
````

## R4-4：体积渲染框架 ②

````markdown
# 任务：实现 R4-4 体积渲染框架 ②（半分辨率管线 + 蓝噪声抖动 + 帧率自适应降级）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-4 + 附录 A（全局硬性约束）**。开工前只读这两处，无需通读全文。
**前置依赖**：R4-3 已交付（VolumeMaterial + volume-test 预览体）。

## 实现要点
1. 蓝噪声抖动：步进起点抖动打散条带（64×64 程序化生成纹理或预生成数组，勿引入新依赖）。
2. 半分辨率路径：体积渲染到 1/2 分辨率 RT 再合成，**或**"步数×抖动"等效近似（与 postprocessing 管线集成成本权衡，二选一登记，取等效方案须实测登记两者观感/性能差异结论）。
3. 纯逻辑 `src/utils/adaptiveQuality.ts`：3 秒滑动窗 FPS → 档位状态机（high 64步/full → mid 48步/half → low 32步/half），滞回防抖（升档需连续 5 秒达标），映射 uQuality/步数/RT 比例；档位切换 ≤0.5s 平滑插值。
4. 预览页 volume-test 增加质量档位强制切换滑杆。

## 验收标准
1. 预览页全屏体积（占比 >2/3）自适应降级生效，帧率恢复 ≥55；小占比后 5 秒内升档。
2. 抖动开/关截图对比：开启后无肉眼可见步进条带。
3. `adaptiveQuality` 状态机单测全覆盖（滞回边界/样本不足）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：降级/升档时序 + 条带对比复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-4 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 改动集中 `VolumeMaterial.ts` / 新建 `adaptiveQuality.ts` / 预览页；勿探索主场景组件。
````

## R4-5：离线数据烘焙管线

````markdown
# 任务：实现 R4-5 离线数据烘焙管线（scripts/bake-data → public/data/）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-5 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。

## 实现要点
1. 新建 `scripts/bake-data/`（Node/TS 脚本）+ `package.json` 增 `bake:data` 命令；产物入 `public/data/`（随仓库提交，**运行时零外部网络请求**）。
2. 数据源二选一并登记：公开接口拉取（Gaia TAP / VizieR，登记查询语句）或内嵌文献数值表（登记表号）——网络不可用时必须有降级路径。
3. 首批产物：`pleiades.json`（≤600 颗成员星：视差 7.0–7.7 mas + 自行共动选星判据登记；每星 {x,y,z} pc 簇质心系、B−V、视星等）、`star-params.json`（参宿四/参宿七/天狼星 A/B/造父一/WR 124 的 Teff/半径/光度/光谱型，SIMBAD 数值登记）、`m13-profile.json`（Harris 目录核半径/潮汐半径/浓度 c）。每产物含 `meta {source, retrievedAt, license, count}`。
4. 运行时加载器 `src/utils/bakedData.ts`：fetch + 校验（count/数值范围）+ 内存缓存，失败返回 null（消费方可降级）；单测用本地 fixture。
5. 脚本自校验（星数范围/坐标模长/无 NaN），失败退出非零；产物总量（gzip 前）≤5 MB。

## 验收标准
1. `npm run bake:data` 幂等（两次产物一致或仅 meta.retrievedAt 异）；自校验通过。
2. `bakedData.ts` 加载/校验/降级单测；覆盖率 gate ≥90% 保持。
3. 主应用现有行为零影响（本阶段无消费方）；全量测试/build 全绿。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 运行 `npm run bake:data` 两次验证幂等，产物大小登记。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-5 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 若外部接口访问受限，直接取"内嵌文献数值表"路径（Gaia DR3 昴星团成员表可用文献选星结果精简内嵌），勿在网络重试上消耗。
````

## R4-6：恒星表面物理化增强

````markdown
# 任务：实现 R4-6 恒星表面物理化增强（黑体色温/光谱型临边昏暗/时变对流）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-6 + §0.2 表第 1 行 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这四处，无需通读全文。
**前置依赖**：R4-1 已交付；R4-5 的 `star-params.json` 若未交付则先用硬编码参数表（登记，后续接烘焙数据）。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/SpecialBodies.tsx` `StellarSurface`（:104-220）：P6 交付的 fBm 对流 + 简单临边昏暗 shader 球——本任务为**增量物理化改造，勿重写组件**。
- 消费方：`RedGiant` :447 / `BlueGiant` :635 / WR :702 / 造父变星 :789 / `SiriusBinary` :1212。
- 白矮星调蓝先例：R2-7 已把天狼星 B 调至 ~25,000 K 色调（保持一致化）。

## 实现要点
1. 纯逻辑 `src/utils/starPhysics.ts`：`blackbodyRGB(teffK)`（Planck→CIE→sRGB 查表插值，3,000–50,000 K；关键点单测：3,500 K 橙红/5,800 K 白黄/9,900 K 蓝白/25,000 K 蓝）；`limbDarkeningU(spectralType)`（M/K/G/F/A/B/O/WD 档，Claret 2000 近似登记）；`granulationScale(radiusRsun)`（巨星颗粒大而少，近似关系登记）。
2. `StellarSurface` uniform 注入：黑体基色替换硬编码颜色、u 系数临边昏暗、噪声频率按 granulationScale、对流时变（uTime 噪声域漂移，视觉周期 20–60 s 登记）+ 自转流动。
3. 参数从 `public/data/star-params.json` 读（`bakedData.ts`），失败降级硬编码（登记）。
4. 预览页注册 6 类恒星（滑杆：Teff 覆写/噪声频率/时间流速）；太阳（Sun.tsx）不在范围（登记）。

## 验收标准
1. 预览页逐星截图 6 张：颜色与光谱型一致、对流时变可辨、巨星/矮星临边观感区分。
2. L3 巡游恒星站回归：远景无突兀变化、无过曝、60 FPS。
3. `starPhysics` 单测（色温关键点/系数档/尺度单调）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：预览页 6 星 + L3 恒星站回归复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-6 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只 Read StellarSurface 函数体与各恒星组件的调用处 props；黑体色温表可内嵌 20 个采样点插值，勿实现完整 CIE 管线。
````

## R4-7：M42 体积化 ①（密度场 + 预览）

````markdown
# 任务：实现 R4-7 猎户座星云 M42 体积化 ①（密度场构建 + 预览页验证）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-7 + §0.3 方案 B + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这四处，无需通读全文。
**前置依赖**：R4-3/R4-4 已交付且用户已目检确认 volume-test 观感方向。
**人工检查点**：本阶段交付后须等待用户目检确认 M42 形态，方可启动 R4-8。

## 实现要点
1. 纯逻辑 `src/utils/nebulaVolume.ts`（组合 `utils/volume.ts` 基元）：M42 密度场——不对称扇贝状发射腔（西北亮弓 + 东南暗湾，Hubble 公版图像形态参考，近似度登记）、Trapezium 空腔 + 电离前沿增密壳、fBm 湍流 + 丝状密度脊；双通道：发射密度（内区 OIII 青/外区 Hα 红权重随半径）+ 吸收密度（前景尘埃湾）。
2. 烘焙 128³ Data3DTexture：构建 <1s，Worker 或分帧避免主线程 >100ms 卡顿（方式登记）；FNV-1a 确定性种子。
3. 预览页注册 `?body=orion-nebula`：体积 + Trapezium 四亮星 sprite 内嵌（位置与空腔一致）+ 滑杆（密度倍率/双色权重/步数）。
4. 不接主场景（R4-8 范围）。

## 验收标准
1. 预览页 8 方向截图：扇贝开口/暗湾/内腔三向可辨、视差真实无 billboard 感。
2. 构建期主线程无 >100ms 卡顿（打点登记）；60 FPS（自适应允许 mid）。
3. 密度场单测（确定性/关键采样点：腔内低、壳层高、暗湾吸收高）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：预览页 8 方向复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-7 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。
6. **提醒用户目检 `?body=orion-nebula` 确认形态后再开 R4-8。**

## 省 token 建议
- 形态塑形以"SDF 骨架 + 噪声侵蚀"分层组合，逐层在预览页可视化调试，勿盲调整体。
````

## R4-8：M42 体积化 ②（场景接入 + 调参）

````markdown
# 任务：实现 R4-8 猎户座星云 M42 体积化 ②（场景接入 + 色彩调参）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-8 + §0.2 表第 2/6 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-7（M42 密度场，用户已目检确认）与 R4-2（detailLayer）已交付。

## 关键实现锚点（直接采信，勿全量探索）
- 猎户座星云现状：`src/components/Scene/SpecialBodies.tsx` 发射星云组件（:1757 起）+ R2-7 `NebulaPuffCloud`（:358）近观 sprite 团絮 +18。
- 位姿：`useGalacticPlacement`（:235）银河系组变换；尺度 `visualRadiusLy`（`src/data/specialBodies.ts` orion 条目）。
- 门控：R4-2 `useDetailLayer({kind:'volume'})`（volume 池容量 1）。

## 实现要点
1. 跟随/飞往 M42 达近观阈值 → 体积层激活，与 billboard + PuffCloud 0.5s 交叉淡出；退出反向恢复 + 纹理 dispose。
2. 位姿对齐：包围盒与 `visualRadiusLy`、银河系组变换一致，过渡无位置跳变。
3. 色彩默认自然色近似（Hα 红棕 + OIII 青灰），与哈勃调色板差异登记入信息面板 dataSource；亮度与 Bloom 联调（核心不过曝、外缘不糊黑）。
4. 自适应质量主场景生效；信息面板 M42 卡片补"结构"行（电离腔/四边形星团/尘埃湾）。

## 验收标准
1. L3 巡游猎户座站：billboard → 体积平滑过渡，绕行/穿越无薄片跳变（对照 R2-7 r27 截图登记升级幅度）。
2. 进出 5 次 JS 堆/显存回落登记；≥55 FPS（自适应 mid 允许）。
3. L3 全序列回归无其他站点回退；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：飞抵过渡 + 绕行 + 进出泄漏复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-8 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只动猎户座组件的挂载分支与 detailLayer 接线；调参在预览页完成后搬参数，勿在主场景反复起服务调试。
````

## R4-9：星系近观多分量 ①（纯逻辑）

````markdown
# 任务：实现 R4-9 星系近观多分量 ①（粒子生成器扩展：尘埃带/HII 区/年轻星团，纯逻辑）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-9 + §0.2 表第 5 行 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这四处，无需通读全文。

## 关键实现锚点（直接采信，勿全量探索）
- `src/utils/galaxyNearView.ts`：R2-8 生成器（核球+盘+旋臂/团块/Sérsic 椭球，单星系 ≤8,000 粒，FNV-1a 种子，`galaxyNearViewR28` 29 例单测）——本任务纯逻辑扩展，**渲染零改动**。
- 盘/旋臂参数化基础：`src/utils/galaxy.ts` `generateGalaxyDiskParticles`。

## 实现要点
1. 新分量独立函数 + 组合入口：尘埃带（旋臂内缘暗吸收粒子，输出 `component:'dust'` 标记）、HII 区（旋臂离散发射团，泊松盘采样防重叠）、年轻星团（旋臂脊线蓝白颗粒串）、老年盘底色半径梯度（内红黄外偏蓝参数化）。
2. 9 星系形态参数表扩展：{倾角/臂数/螺距角/B/D 比/尘埃强度/HII 密度}，来源 RC3/S4G/NED 登记；椭圆类 dust/HII 为零。
3. 预算：单星系总量 ≤12,000（自 8,000 上调登记）；分量配额纯函数 + 总量断言。
4. 确定性双次生成逐字节一致；新分量单测（分布范围/配额/泊松最小间距/颜色梯度单调）。

## 验收标准
1. 扩展单测全绿 + 现有 29 例回归；9 星系参数表逐一断言与形态类型一致。
2. type-check/lint/build 全绿；覆盖率 gate ≥90% 保持。
3. 主场景行为零变化（`GalaxyNearView.tsx` 不消费新分量，回归确认）。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 本阶段纯逻辑，无需无头 Chrome 目验（登记说明）。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段（内部结构变更可简记）。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-9 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只 Read `galaxyNearView.ts` 与其测试文件；勿探索渲染组件与主场景。
````

## R4-10：星系近观多分量 ②（渲染接入 + M31）

````markdown
# 任务：实现 R4-10 星系近观多分量 ②（渲染接入 + M31 专属细节）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-10 + §0.2 表第 5 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-9（新分量生成器）与 R4-2（detailLayer）已交付。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/GalaxyNearView.tsx`：R2-8 近观粒子渲染（软圆点 ShaderMaterial 加性混合、0.5s 交叉过渡、粒子层朝向 = id 哈希公式）。
- 远观贴图平面：`src/components/Scene/Universe.tsx` `GalaxyObject`（billboard 面向相机，R2-8 登记）。

## 实现要点
1. 消费新分量：dust 粒子 normal 混合暗色 + renderOrder 置于加性星光层之后（加性无法画暗，方案登记）；HII/年轻星团合入加性层不同 size/color。
2. M31 专属：倾角 77° 姿态（朝向改专属登记值，其余星系沿用哈希，差异登记）+ 10 kpc 尘埃环（dust 环状增强）+ 核球偏黄。
3. billboard ↔ 粒子层过渡回归：新姿态下淡入呈现姿态差，无位置跳变（观感登记）。
4. 预览页注册 `?body=m31` + 1 个不规则星系（滑杆：dust 强度/HII 密度/倾角覆写）；信息面板"结构"行扩展 + dataSource 追加 RC3/S4G。

## 验收标准
1. 飞往 M31：尘埃暗纹/粉色 HII/蓝白星团串/偏黄核球可辨，绕行立体（对照 r28-L4-05 登记升级幅度）。
2. L4 全序列 9 星系近观与类型一致（椭圆无 dust/HII），逐站截图；60 FPS、LRU 进出 5 次无泄漏。
3. `galaxyNearViewR28` 回归全绿（或等价迁移）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：L4 序列逐星系近观复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-10 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 渲染层只加"暗色 normal 混合第二 Points + 颜色通道"，复用既有软圆点管线；先 M31 打样再批量套用。
````

## R4-11：黑洞引力透镜 ①（raymarch 原型）

````markdown
# 任务：实现 R4-11 黑洞引力透镜 ①（raymarch 原型：光子环 + 背景弯曲，预览页）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-11 + §0.3 方案 C + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-1 已交付。
**人工检查点**：本阶段交付后须等待用户目检确认光子环观感，方可启动 R4-12。

## 关键实现锚点（直接采信，勿全量探索）
- log depth 兼容先例：`Starfield.tsx` :33；现有黑洞廉价 shader 参考（不改动）：`SpecialBodies.tsx` `BlackHole`（:1603-1756）。

## 实现要点
1. `src/components/Scene/volumetric/BlackHoleLensed.tsx` + 纯逻辑 `src/utils/blackHoleLensing.ts`：包围球 raymarching——弯曲用 Schwarzschild 二阶近似（α ≈ 4GM/(c²b) 弱场 + 近光子球增强项，公式与适用域登记，**不做全数值测地线积分**）；r ≤ 1.05 r_s 撞击终止为黑；b ≈ 2.6 r_s 光子环积累增亮；弯曲后方向采样程序化星场 cubemap（128px/面程序化生成，勿引入贴图资产）。
2. 数值稳定：步进上限/提前终止/NaN 防护；log depth 兼容；64 步、占屏 ≤1/2 时 60 FPS。
3. 预览页注册 `?body=blackhole-test`（滑杆：质量尺度/相机距离/步数）。
4. 纯逻辑单测：偏转角函数/撞击判定/CPU 参考追踪 3–5 条样例光线与 shader 同式系数一致断言。

## 验收标准
1. 预览页光子环清晰 + 背景星弧状拖曳，绕行/推近连续（4 距离档截图登记）。
2. 推入近光子球无 NaN 黑块/白闪；60 FPS（自适应允许降档）。
3. 单测通过；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：4 距离档复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-11 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。
6. **提醒用户目检 `?body=blackhole-test` 确认光子环后再开 R4-12。**

## 省 token 建议
- 全新自包含 shader，勿改既有 BlackHole 组件；CPU 参考光线与 shader 公式同源常量抽到 `blackHoleLensing.ts` 单点维护。
````

## R4-12：黑洞引力透镜 ②（吸积盘物理）

````markdown
# 任务：实现 R4-12 黑洞引力透镜 ②（吸积盘：温度黑体色/多普勒束流/引力红移）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-12 + §0.3 方案 C + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-11 已交付且用户已目检确认光子环。
**人工检查点**：本阶段交付后须等待用户目检确认盘翻折观感，方可启动 R4-13。

## 实现要点
1. raymarch 内薄盘求交：盘平面 r ∈ [≈3r_s, ~12r_s]，弯曲光线可与盘多次相交（上下缘翻折像来源）。
2. T(r) ∝ r^(−3/4)（Novikov-Thorne 近似，内缘截断登记）→ 复用 R4-6 `starPhysics.blackbodyRGB` 着色（若 R4-6 未交付则内嵌同式函数并登记待收敛）。
3. 多普勒束流：盘内开普勒速度 → 近侧 δ³ 增亮/远侧减暗；引力红移随 r 减小加深（近似式登记）。
4. 盘面径向流动噪声条纹（uTime 差速旋转）；亮度与 Bloom 联调不过曝。
5. 预览页滑杆：盘倾角/内外缘半径/束流强度。

## 验收标准
1. 预览页正视/斜视/侧视 3 角度截图：上下缘翻折像 + 近亮远暗不对称清晰（EHT/Interstellar 观感）。
2. 温度→颜色/束流因子纯函数单测（与 shader 同式断言）；60 FPS（占比 ≤1/2）；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：3 角度复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-12 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。
6. **提醒用户目检盘翻折观感后再开 R4-13。**

## 省 token 建议
- 只改 `BlackHoleLensed` shader 与 `blackHoleLensing.ts`；盘求交在弯曲步进循环内做平面跨越检测即可，勿解析求交。
````

## R4-13：黑洞引力透镜 ③（场景接入）

````markdown
# 任务：实现 R4-13 黑洞引力透镜 ③（场景接入：人马座 A* / 天鹅座 X-1）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-13 + §0.2 表第 3/6 行 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-12（用户已目检确认）与 R4-2（detailLayer）已交付。

## 关键实现锚点（直接采信，勿全量探索）
- `SpecialBodies.tsx` `BlackHole`（:1603-1756）：现有廉价 shader（黑球+吸积盘+光环）——远景保留，近观切换。
- 门控：R4-2 `useDetailLayer({kind:'lensing'})`（容量 1）；尺度：`data/specialBodies.ts` 两黑洞 `visualRadiusLy`。

## 实现要点
1. 跟随/飞往两黑洞达近观阈值 → `BlackHoleLensed` 激活，与廉价 shader 交叉淡出；退出恢复 + dispose。
2. 参数区分：Sgr A*（大质量、盘暗弱偏橙红，射电亮度艺术化登记）/ 天鹅座 X-1（恒星级、盘亮偏蓝白，伴星联动如有则保留）。
3. 尺度沿用 `visualRadiusLy` 压缩比例（登记）；背景弯曲采样二选一登记：场景 cubemap 快照 vs 程序化星场近似（成本高可取近似，登记差异）。
4. 自适应降级接入（档位映射步数）；lensing 池容量 1。

## 验收标准
1. L3 巡游两黑洞站：飞抵平滑过渡到透镜渲染，光子环+盘翻折+束流不对称可辨（对照现状截图登记升级幅度）；Esc 退出恢复。
2. ≥55 FPS（自适应 mid 允许）；进出 5 次堆/显存回落登记。
3. L3 全序列回归；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：两黑洞站飞抵/绕行/退出复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-13 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只动 BlackHole 组件挂载分支与 detailLayer 接线；参数差异用两份配置对象，勿复制组件。
````

## R4-14：环状星云 M57 壳层体积

````markdown
# 任务：实现 R4-14 环状星云 M57 壳层体积模型

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-14 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-8 已交付（体积框架已在主场景验证）。

## 实现要点
1. `nebulaVolume.ts` 新增 M57 密度场：三轴椭球壳（O'Dell et al. 2013 参考：赤道增密环 + 极向暗瓣，参数登记）——内腔近空 + 环壳 OIII 青绿 + 外缘 Hα/NII 红橙 + 弱外晕壳；96³ 纹理（预算登记）。
2. 中心白矮星亮点（R4-6 白矮星色档 sprite）。
3. 主场景接入同 R4-8 模式（volume 池；现有 billboard 与 R2-7 交付的 +200 环向粒子在体积激活时淡出，登记）；行星状星云组件位置 `SpecialBodies.tsx` :1912 起。
4. 预览页注册 `?body=ring-nebula`；密度场单测（赤道环密度>极向、内腔低）。

## 验收标准
1. 近观 3 角度截图：正视"环"→ 侧视"桶状/椭球壳"视差变化真实可辨（billboard 不可能呈现的核心升级点）。
2. 与 M42 连续巡游切换：volume 池 LRU 逐出正常、无双体积同挂、无泄漏；60 FPS。
3. 单测 + 回归全绿；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：3 角度 + M42↔M57 切换复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-14 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 复用 R4-8 的接入模式代码路径（照抄接线只换密度场与配置）；壳层为解析式塑形，噪声仅做扰动。
````

## R4-15：马头星云吸收体积

````markdown
# 任务：实现 R4-15 马头星云吸收体积（暗云 + 背景发射幕）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-15 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-8 已交付。

## 实现要点
1. `nebulaVolume.ts` 新增马头密度场：**吸收为主**的暗分子云柱（马头轮廓 SDF 近似 + fBm 边缘侵蚀，Hubble 公版轮廓参考，近似度登记），发射通道近零。
2. 背景发射幕：IC 434 红色背景（低密度大尺度发射层 vs 保留现有背景 billboard 作幕布，二选一登记）——剪影 = 吸收体积遮挡背景幕。
3. 主场景接入同 R4-8 模式（暗星云组件 `SpecialBodies.tsx` :1041 起；R2-7 的 2 视差发射层 + 3 前景暗云团在体积激活时交叉淡出，登记）。
4. 预览页注册 `?body=horsehead`；密度场单测（轮廓内吸收高/外低、发射近零）。

## 验收标准
1. 近观 3 角度截图：正面剪影清晰、侧向可见云柱纵深。
2. 巡游切换回归无泄漏；60 FPS；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：3 角度复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-15 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 马头轮廓用 3–4 个椭球/胶囊 SDF 布尔组合近似即可，勿追求逐像素贴合照片。
````

## R4-16：蟹状星云丝状结构 + PWN

````markdown
# 任务：实现 R4-16 蟹状星云丝状结构 + PWN 环面/喷流

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-16 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-8 已交付。

## 关键实现锚点（直接采信，勿全量探索）
- 现有脉冲星组件：`SpecialBodies.tsx` `PulsarRemnant`（:1406）——射束扫描/脉冲节奏保留；R2-7 交付 +16 丝状云团（体积激活时交叉淡出）。
- 喷流复用：`src/components/Scene/ExtragalacticObjects.tsx` `RelativisticJet`（:42 起）锥体 shader，参数化缩小尺度勿新造（复用登记）。

## 实现要点
1. `nebulaVolume.ts` 蟹状密度场：外围丝状网络（方向场扭曲密度脊，Hα 红橙丝 + 内部 OIII 青弥散，Hubble 形态登记）+ 椭球包络；128³。
2. PWN 内核：Chandra 参考的赤道环面 shader 发射体（蓝白同步辐射色）+ 极向双喷流（复用 RelativisticJet 参数化）。
3. 与 PulsarRemnant 整合：射束/脉冲保留；体积层与射束/环面深度关系正确（renderOrder/深度方案登记）；主场景接入同 R4-8 模式。
4. 预览页注册 `?body=crab-pulsar`；密度场单测（丝状脊>弥散、环面平面增强）。

## 验收标准
1. 近观 3 角度截图：红橙丝网 + 青色弥散 + 蓝白环面/双喷流三层可辨、绕行立体；脉冲节奏不回退。
2. 体积+环面+射束+Bloom 组合 ≥55 FPS（自适应 mid 允许）；LRU 回归无泄漏；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：3 角度 + 脉冲节奏复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-16 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 丝状网络 = 少量（8–12 条）参数化曲线骨架沿线增密 + 噪声扰动，勿做真流体结构。
````

## R4-17：昴星团 Gaia 真实成员星

````markdown
# 任务：实现 R4-17 昴星团 Gaia 真实成员星 + 反射星云

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-17 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-5（`pleiades.json`）与 R4-2（detailLayer）已交付；R4-6 的 `blackbodyRGB` 若已交付则复用。

## 关键实现锚点（直接采信，勿全量探索）
- 现状：`SpecialBodies.tsx` `OpenCluster`（:856）昴星团分支——程序化点簇 + R2-7 近观 +320 粒 + 七姊妹辉光 ×7（真实星表替代后登记）。
- 加载器：`src/utils/bakedData.ts`（R4-5）；星芒 sprite：`src/components/CelestialBody/proceduralTextures.ts` 既有衍射星芒。

## 实现要点
1. 消费 `public/data/pleiades.json`：真实 3D 位置（pc→场景单位比例登记）+ B−V→颜色 + 视星等→粒径/亮度；加载失败降级现状程序化分布（登记）。
2. 9 颗命名亮星：真实相对位置 + 星芒 + 悬停/点选星名（成本高则仅信息面板列名，二选一登记）。
3. 反射星云：Merope/Maia 周边蓝色反射——3–5 椭球壳低密度体积（volume 池，96³ 单纹理多壳）或分层 sprite（性能优先二选一登记；蓝色反射色调区别于发射星云）。
4. `useDetailLayer({kind:'starCatalog'})` 挂载；预览页注册 `?body=pleiades`。

## 验收标准
1. 近观亮星构型与真实昴星团可对应（对照公版图像截图登记）；蓝色反射星云包裹成立。
2. 降级路径实测（临时改名产物验证回落不报错）；巡游回归无泄漏；60 FPS。
3. 单位换算/星等映射纯函数单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：近观构型 + 降级路径复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-17 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 只动 OpenCluster 昴星团分支；反射星云优先取 sprite 方案（若体积池已被巡游高频占用）。
````

## R4-18：参宿四巨对流胞 + 恒星近观点缀

````markdown
# 任务：实现 R4-18 参宿四非对称巨对流胞 + 恒星近观日冕/衍射星芒

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-18 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-6 已交付（starPhysics + StellarSurface 物理化）。

## 实现要点
1. 参宿四专属：`StellarSurface` 叠加低阶球谐（l ≤ 3）扰动——2–3 个大尺度不对称亮/暗斑，缓慢演化（视觉周期 40–90 s 登记；VLTI/Montargès 2021 参考）；尘埃抛射暗斑事件可选（实现时定夺登记，非硬性）。
2. 恒星近观通用（6 类恒星）：色球边缘辉光环（limb 外薄发射环，色温联动）+ 中距衍射星芒 sprite（近观淡出防遮挡，距离窗口纯函数 + 单测）。
3. 主场景经 `useDetailLayer` 近观激活（远景零开销）；预览页参宿四滑杆：球谐幅度/演化速度。

## 验收标准
1. 预览页参宿四间隔 30s 两帧对比：大尺度不对称斑块可辨且演化，与其他恒星均匀颗粒区分。
2. L3 恒星站近观：色球环/星芒出现与淡出平滑；60 FPS。
3. 距离窗口/球谐幅度纯函数单测；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：两帧对比 + 恒星站近观复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-18 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 球谐扰动在 shader 内以 3–4 项固定系数展开实现，系数由 uniform 驱动缓变，勿做通用球谐库。
````

## R4-19：M13 King 分布 + HR 颜色

````markdown
# 任务：实现 R4-19 M13 球状星团 King 分布 + HR 图颜色

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-19 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-5（`m13-profile.json`）已交付；R4-6 `blackbodyRGB` 复用。

## 关键实现锚点（直接采信，勿全量探索）
- `SpecialBodies.tsx` `GlobularCluster`（:2121）+ R2-7 近观 +1,200 粒（rand^2.4 分布）——替换为 King 采样，总预算不变。
- R2-9 银晕程序化 29 星团**不在范围**（登记）。

## 实现要点
1. 纯逻辑：King (1966) profile 逆变换采样（核半径/潮汐半径/浓度 c 自 `m13-profile.json`，失败降级现状）；HR 颜色分布（红黄主序为主 + ~10% 蓝离散/水平支，比例登记）→ blackbodyRGB。
2. 确定性种子；远观/近观两级粒子均接新分布。
3. 预览页注册 `?body=m13`；单测：径向密度单调递减、半质量半径断言、颜色比例。

## 验收标准
1. 近观：致密核 + 稀疏晕密度梯度可辨（对照现状截图登记）；红黄主色 + 蓝星点缀。
2. 巡游回归、60 FPS；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：近观对照复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-19 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- King profile 用数值反查表（预计算 64 点插值）实现逆变换采样，勿解析求逆。
````

## R4-20：WR 124 星风壳 + 脉冲星射束体积化

````markdown
# 任务：实现 R4-20 WR 124 星风抛射壳 + 脉冲星射束体积化

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-20 + 附录 A（全局硬性约束）**。开工前只读这两处，无需通读全文。
**前置依赖**：R4-8（体积框架已入场景）已交付；R4-16 若已交付注意与蟹状体积层共存回归。

## 关键实现锚点（直接采信，勿全量探索）
- WR 124：`SpecialBodies.tsx` :702 起（shader 球 + 抛射壳 mesh）；脉冲星射束：`PulsarRemnant`（:1406）ShaderMaterial 射束锥。

## 实现要点
1. WR 124：抛射壳 mesh 升级为小型体积层（64³，团块泡沫 + 径向膨胀速度场 uTime 驱动，M1-67 观感登记）；volume 池复用、近观激活。
2. 脉冲星射束：锥体升级为轻量体积锥（轴向密度衰减 + 边缘软化 + 扫描旋转保留）；与蟹状体积层（R4-16）深度共存正确。
3. 均经 `useDetailLayer` 门控；预览页注册 `?body=wr-124`；密度塑形纯函数单测。

## 验收标准
1. WR 124 近观两帧对比：抛射壳团块泡沫立体膨胀；脉冲星射束柔和无硬边锥。
2. 与蟹状站连续巡游 LRU 正常；60 FPS；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：两帧对比 + 连续巡游复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-20 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 两项均为既有组件小增量 + 复用体积基元；勿动 R4-16 蟹状密度场本体。
````

## R4-21：类星体 3C 273 近观升级

````markdown
# 任务：实现 R4-21 类星体 3C 273 近观升级（吸积盘 + 尘埃环面）

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-21 + 附录 A（全局硬性约束）**。开工前只读这两处，无需通读全文。
**前置依赖**：R4-12 已交付（盘着色逻辑复用）。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/ExtragalacticObjects.tsx` `Quasar`（3C 273：辉光 sprite + `RelativisticJet` 喷流 + 光变）——喷流/光变保留。

## 实现要点
1. 近观细节层：中心吸积盘（复用 R4-12 温度分布 + 束流着色的**非透镜简化版**，raymarch 不启用，登记）+ 外围尘埃环面（torus：小型体积或粒子环二选一登记）+ BLR 弥散辉光过渡层 sprite。
2. `useDetailLayer` 门控；预览页注册 `?body=quasar-3c273`。

## 验收标准
1. 近观截图：盘（亮蓝白）→ BLR 辉光 → 尘埃环面（暗红棕）→ 喷流四层结构可辨；光变不回退。
2. L4 巡游回归；60 FPS；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：近观四层结构复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-21 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 盘着色函数从 `blackHoleLensing.ts`/`starPhysics.ts` 导入复用，勿复制公式。
````

## R4-22：触须星系 N-body 潮汐尾

````markdown
# 任务：实现 R4-22 触须星系 N-body 烘焙潮汐尾

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-22 + §0.4 数据源表 + 附录 A（全局硬性约束）**。开工前只读这三处，无需通读全文。
**前置依赖**：R4-5（烘焙管线）与 R4-10（星系近观渲染扩展）已交付。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/ExtragalacticObjects.tsx` `AntennaeGalaxies`（现为静态渲染）；加载器 `src/utils/bakedData.ts`。

## 实现要点
1. `scripts/bake-data/` 新增受限三体/测试粒子模拟（Toomre & Toomre 1972 图景：两质心 + 各 ≤3,000 测试粒子盘、抛物线交会），烘焙 8–12 个时间快照 → `public/data/antennae.bin`（Float32；模拟参数/近似登记；总量计入 ≤5 MB 预算）。
2. 近观层消费快照：两核 + 双潮汐尾，快照间线性插值随 simDays 缓慢演化（时间映射登记）；加载失败降级现状。
3. `useDetailLayer({kind:'starCatalog'})` 门控；预览页注册 `?body=antennae`；脚本自校验 + 加载器单测。

## 验收标准
1. 近观：双核 + 两条弯曲潮汐尾立体可辨且缓慢演化（对照公版图像构型登记）；插值无跳变。
2. 烘焙幂等；降级实测；60 FPS；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿（含 `npm run bake:data` 幂等验证）。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：近观演化两帧对比复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-22 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 模拟脚本 = 固定势场（两 Plummer 球）中测试粒子 RK4 积分，百行内可完成，勿引入模拟库。
````

## R4-23：透镜星系团屏幕空间透镜弧

````markdown
# 任务：实现 R4-23 透镜星系团屏幕空间引力透镜弧

权威需求定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-23 + 附录 A（全局硬性约束）**。开工前只读这两处，无需通读全文。
**前置依赖**：R4-4 已交付（postprocessing 集成经验可参考）。

## 关键实现锚点（直接采信，勿全量探索）
- `src/components/Scene/ExtragalacticObjects.tsx` `LensingArcs`（:409-416 域判据：跟随/飞往 cluster-lensing）；后期管线：`src/components/Scene/PostEffects.tsx`（EffectComposer + Bloom）。

## 实现要点
1. 方案二选一并登记（**推荐 a**）：a) postprocessing 自定义 Effect——团块质心 SIS 模型偏转屏幕 UV，背景拉伸成切向弧/部分爱因斯坦环；b) 场景内参数化弧形 mesh 升级（多重像布局，非真折射）。与 EffectComposer/Bloom 集成风险过高时降级 b 并登记理由。
2. SIS 偏转纯函数（θ_E 参数化）+ 单测；仅跟随 cluster-lensing 时激活（复用现状域判据），非跟随零开销。
3. 预览页注册 `?body=cluster-lensing`。

## 验收标准
1. 近观：背景源拉伸为切向弧/部分环，位置随视角一致（截图登记）；非跟随时零开销（性能对比登记）。
2. 与 Bloom/体积层组合无伪影；60 FPS；覆盖率 gate ≥90% 保持。

## 收尾流程（按序执行，缺一不可）
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验并截图登记（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本可复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下既有模板；开发服务器一律 3100 端口）：激活/关闭对比复验。
3. 更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。
4. `IMPROVEMENT_REQUIREMENTS_4.md` §R4-23 各条 🔲 回写 ✅/🔶（实现差异逐条登记）。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 方案 a 的 Effect 以 `postprocessing` 库 Effect 基类最小实现（单 fragment 函数），勿改既有 Bloom 配置。
````

## R4-24：集成回归验收 + 文档回写

````markdown
# 任务：执行 R4-24 集成回归验收 + 文档回写（R4 迭代收尾）

权威定义见 `IMPROVEMENT_REQUIREMENTS_4.md` 的 **§R4-24 + 附录 A（性能预算总账）**。
**前置依赖**：R4-1 ~ R4-23 已全部交付。

## 任务清单
1. 全量 `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿；覆盖率 gate ≥90% 确认；`npm run bake:data` 幂等确认。
2. 无头 Chrome 端到端（Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`；CDP 脚本复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下各阶段模板；开发服务器 3100 端口）：
   - L3 15 站 + L4 8 站巡游整圈，逐站近观截图 + FPS + JS 堆登记；
   - 连续切换 15 个细节层目标后堆稳定；四类细节层（particles/volume/lensing/starCatalog）LRU 交叉逐出验证；
   - 预览页全注册对象逐一截图归档；自适应降级强制触发验证；
   - R2/R3 关键点抽查回归：巡游域切换、事件域隔离、卫星角尺寸钳制、合并演化各 1 项。
3. 性能总账登记：L3/L4 粒子峰值、体积纹理常驻显存、`public/data/` 总量，逐项对照附录 A 预算。
4. `CHANGELOG.md` `[Unreleased]` 查漏补全全部 R4 条目（含实测数据）；`IMPROVEMENT_REQUIREMENTS_4.md` 全部 🔲 回写 ✅/🔶（实现差异逐条登记），文档版本升 1.x；REQUIREMENTS.md 受影响小节同步更新。
5. Git 遵循 AGENTS.md：开工前先询问用户是否新建分支；完成后仅本地 commit，再询问是否创建 PR；禁止直接提交 master。

## 省 token 建议
- 复验脚本按站点批量执行；文档回写用精准替换状态标记，勿重写全文。
````
