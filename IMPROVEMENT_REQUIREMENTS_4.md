# 改进需求文档（第四批，R4 迭代：天体真实观感 3D 模型）

> **文档版本**: 1.2（R4-1/R4-2 ✅ 已完成，其余 🔲 未实现）
> **参考文档**: REQUIREMENTS.md、IMPROVEMENT_REQUIREMENTS_2.md（R2-7/R2-8 近观基础）、IMPROVEMENT_REQUIREMENTS_3.md（R3-1 巡游域）、AGENTS.md
> **状态标记**: ✅ 已完成 / 🔶 部分完成 / 🔲 未实现
> **调研说明**: §0.2 现状锚点已经代码调研核实（2026-07），实现时若行号漂移以符号名为准。
> **任务粒度原则**: 每个 R4-x 阶段 = 单个 Agent 单个任务可保质量完成的粒度（XL 主题已预先拆分为多阶段）；渲染类阶段的最终观感验收依赖人工目检，Agent 交付止于"验收标准全部可复验 + 预览页/截图登记"。

## 优先级与阶段总览

| 阶段 | 优先级 | 主题 | 复杂度 | 依赖 | 状态 |
|---|---|---|---|---|---|
| R4-1 | P0 | 开发预览工位（/dev/preview 独立天体渲染验证页） | S | 无 | ✅ |
| R4-2 | P0 | 细节层管理泛化（统一近观细节层注册/门控/LRU/预算） | M | 无 | ✅ |
| R4-3 | P0 | 体积渲染框架 ①：raymarch 材质 + 3D 密度纹理工具 | L | R4-1 | ✅ |
| R4-4 | P0 | 体积渲染框架 ②：半分辨率管线 + 蓝噪声抖动 + 帧率自适应降级 | M | R4-3 | ✅ |
| R4-5 | P0 | 离线数据烘焙管线（Gaia/SIMBAD → public/data/） | M | 无 | 🔲 |
| R4-6 | P0 | 恒星表面物理化增强（黑体色温/光谱型临边昏暗/时变对流） | M | R4-1 | ✅ |
| R4-7 | P0 | 猎户座星云 M42 体积化 ①：密度场构建 + 预览页验证 | L | R4-3, R4-4 | ✅ |
| R4-8 | P0 | 猎户座星云 M42 体积化 ②：场景接入 + 色彩调参 | M | R4-7, R4-2 | ✅ |
| R4-9 | P0 | 星系近观多分量 ①：粒子生成器扩展（尘埃带/HII 区/年轻星团） | M | 无 | ✅ |
| R4-10 | P0 | 星系近观多分量 ②：渲染接入 + M31 专属细节 | M | R4-9, R4-2 | ✅ |
| R4-11 | P1 | 黑洞引力透镜 ①：raymarch 原型（光子环 + 背景弯曲） | L | R4-1 | 🔲 |
| R4-12 | P1 | 黑洞引力透镜 ②：吸积盘物理（温度黑体色/多普勒束流/红移） | M | R4-11 | 🔲 |
| R4-13 | P1 | 黑洞引力透镜 ③：场景接入（人马座 A* / 天鹅座 X-1） | M | R4-12, R4-2 | 🔲 |
| R4-14 | P1 | 环状星云 M57 壳层体积模型 | M | R4-8 | 🔲 |
| R4-15 | P1 | 马头星云吸收体积（暗云 + 背景发射幕） | M | R4-8 | 🔲 |
| R4-16 | P1 | 蟹状星云丝状结构 + PWN 环面/喷流 | L | R4-8 | 🔲 |
| R4-17 | P1 | 昴星团 Gaia 真实成员星 + 反射星云 | M | R4-5, R4-2 | 🔲 |
| R4-18 | P1 | 参宿四非对称巨对流胞 + 恒星近观日冕/衍射星芒 | M | R4-6 | 🔲 |
| R4-19 | P2 | M13 球状星团 King 分布 + HR 图颜色 | M | R4-5 | 🔲 |
| R4-20 | P2 | WR 124 星风抛射壳 + 脉冲星射束体积化 | M | R4-8 | 🔲 |
| R4-21 | P2 | 类星体 3C 273 近观升级（吸积盘 + 尘埃环面） | M | R4-12 | 🔲 |
| R4-22 | P2 | 触须星系 N-body 烘焙潮汐尾 | L | R4-5, R4-10 | 🔲 |
| R4-23 | P2 | 透镜星系团屏幕空间引力透镜弧 | L | R4-4 | 🔲 |
| R4-24 | 收尾 | 集成回归验收 + 文档回写 | M | R4-1~R4-23 | 🔲 |

> 优先级依据：P0 = 基础设施 + 覆盖面/视觉冲击最大的标杆升级；P1 = 标志性天体专属细节；P2 = 长尾完善。
> 建议实施顺序：R4-1 → R4-2 → R4-5 → R4-3 → R4-4 → R4-6 → R4-9 → R4-7 → R4-8 → R4-10 → R4-11 → R4-12 → R4-13 → R4-14 → R4-15 → R4-16 → R4-17 → R4-18 → R4-19 → R4-20 → R4-21 → R4-22 → R4-23 → R4-24。
> 可并行组：{R4-2, R4-5, R4-6, R4-9} 互不依赖可与体积框架线（R4-3/R4-4）并行；P1 中 R4-14/15/16/17/18 在各自依赖就绪后可并行。
> **框架检查点（强制）**：R4-3 交付后须先以预览页测试体（单个体积球）人工确认 API 与观感方向，再启动 R4-7；R4-11 交付后须先人工确认光子环观感，再启动 R4-12。避免框架返工放大。

---

## 0. 背景与现状调研

### 0.1 用户诉求归纳

银河系内天体（L3）和宇宙视角天体（L4）的细节呈现太潦草：飞往对应天体、显示天体细节时，应渲染接近真实观感的 3D 模型。三维空间数据可从公开数据获取，不同类型天体的渲染方式不同，需按类型分别设计。

### 0.2 现状锚点速查（已调研核实）

| # | 对象类别 | 现状机制 | 关键位置 | 核心差距 |
|---|---|---|---|---|
| 1 | 恒星（参宿四/参宿七/天狼星/造父一/WR 124） | `StellarSurface` 共享 shader 球：fBm 对流颗粒 + 简单临边昏暗 + 硬编码颜色（P6 交付） | `src/components/Scene/SpecialBodies.tsx` `StellarSurface`（:104-220）、各恒星组件 :447/:635/:702/:789/:1212 | 颜色非黑体物理色；临边昏暗无光谱型区分；对流静态无时变；近观颗粒尺度失真 |
| 2 | 星云（猎户座/环状/马头/蟹状） | ≤512px 程序化 DataTexture billboard（`utils/nebulaTexture.ts`）+ R2-7 近观 sprite 团絮（`NebulaPuffCloud` :358） | `SpecialBodies.tsx` :1041/:1757/:1912、`src/data/nebulaTextures.ts` | 平面 billboard 叠 sprite，无体积结构；近观绕行视差穿帮 |
| 3 | 黑洞（人马座 A* / 天鹅座 X-1） | 黑色球 + 吸积盘 ShaderMaterial + 固定光环 shader（无光线弯曲） | `SpecialBodies.tsx` `BlackHole`（:1603-1756） | 无引力透镜弯曲/光子环/多普勒束流，与 EHT 观感差距大 |
| 4 | 星团（M13/昴星团） | `PointsMaterial` 程序化均匀点簇 + R2-7 近观增量粒子（M13 +1,200 / 昴 +320） | `SpecialBodies.tsx` `OpenCluster` :856 / `GlobularCluster` :2121 | 非真实成员星位置/颜色；昴星团缺反射星云包裹 |
| 5 | 星系近观（M31/M33/LMC/SMC/M87 等 9 个） | R2-8 交付：近观 3D 粒子层（核球+盘+旋臂/团块/Sérsic 椭球，单星系 ≤8,000 粒，LRU 容量 1） | `src/components/Scene/GalaxyNearView.tsx`、`src/utils/galaxyNearView.ts` | 无尘埃带暗纹、无 HII 区/年轻星团色彩分量、单色调粒子；M31 真实倾角/尘埃环未呈现 |
| 6 | 近观门控 | R2-7 滞回门控（进入 = 飞往观察距离 ×1.5、退出 ×1.4）+ R2-8 LRU（容量 1，纯函数 `nearViewLruUpdate`） | `src/utils/nearView.ts`、`src/utils/galaxyNearView.ts`、`useNearViewGate` | 两套门控/LRU 并存且仅支持粒子层；无统一"细节层类型注册 + 显存预算"机制，体积纹理/烘焙星表无处挂 |
| 7 | 渲染管线 | `EffectComposer(multisampling=4)` + 选择性 Bloom；Canvas 启用 `logarithmicDepthBuffer` | `src/components/Scene/PostEffects.tsx`、`SolarSystemApp.tsx` :43 | 无体积渲染（raymarch）能力；自定义 shader 须兼容 log depth（`Starfield.tsx` :33 有 include 先例） |
| 8 | 资源与数据 | 位图纹理仅太阳系（`textureManager.ts` + `utils/textureBudget.ts` LRU 预算）；无 `scripts/` 烘焙管线、无 `public/data/` | `src/data/textures.ts`、`public/textures/` | L3/L4 天体无任何真实数据驱动的资产；缺离线烘焙通道 |
| 9 | 巡游与飞往 | L3 15 站 / L4 8 站巡游（`utils/cycleScopes.ts`）；`requestFlyTo` → 2.5s 运镜 → 跟随（`utils/cameraFocus.ts` `resolveFocusTarget`） | `src/store/index.ts` `requestFlyTo`（:619）、`CameraController.tsx` | 交互链路完整，细节层只需挂接现有跟随/飞往判据，勿另造交互 |

### 0.3 总体技术方案（四类渲染方案 + 基础设施）

- **方案 A（恒星）— shader 球体物理化**：Planck 黑体谱 → CIE RGB 色温着色（Teff 驱动）；按光谱型系数的临边昏暗律 I(μ)=1−u(1−μ)（Claret 2000 系数取近似档）；3D simplex 噪声对流 + 时间演化 + 自转流动；参宿四叠加低阶球谐非对称巨对流胞（VLTI/Montargès et al. 2021 观感）。
- **方案 B（星云）— 体积 raymarching**：包围盒内步进采样 3D 密度纹理（≤128³，程序化塑形 + 离线烘焙），发射-吸收积分；Hα（红）/OIII（青绿）双通道窄带色彩映射；半分辨率 + 蓝噪声抖动 + 双边上采样保性能；仅跟随目标时激活（LRU 容量 1）。**不采用外部 3D 网格资产下载路线**（公开网格稀缺、授权杂、包体大），密度场以公版观测图像与学术形状模型为参考程序化构建，差异登记。
- **方案 C（黑洞）— 引力透镜 raymarch**：近观时切换为包围球 raymarching，Schwarzschild 测地线近似（二阶弯曲近似即可，非全数值积分）弯曲视线，产生光子环与吸积盘上下缘翻折；薄盘温度 T∝r^(−3/4)（Novikov-Thorne 近似）黑体色 + 多普勒束流（近侧增亮 δ³）+ 引力红移；远景保留现有廉价 shader，近观 LOD 切换。
- **方案 D（星团/星系）— 真实数据/形态参数驱动粒子**：昴星团用 Gaia DR3 成员星真实 3D 位置 + B−V 转色；M13 用 King 1966 профile 采样 + 真实 HR 图颜色分布；星系近观在 R2-8 基础上增补尘埃带暗粒子、HII 区发射点、蓝色年轻星团分量，分量参数取自公开形态目录（RC3/S4G/NED）；触须星系用离线轻量 N-body 烘焙潮汐尾快照。
- **基础设施**：统一细节层管理（注册/门控/LRU/显存预算，泛化 R2-7/R2-8 两套机制）；开发预览工位（隔离验证每个细节模型，人工目检提效）；离线烘焙管线（构建期脚本产出静态资产，运行时零外部网络请求）。

### 0.4 公开数据源登记（实现时在代码/面板 dataSource 登记）

| 数据 | 来源 | 用途 |
|---|---|---|
| 恒星 Teff/半径/光度/B−V | SIMBAD、Gaia DR3（ESA Archive） | R4-5/R4-6/R4-17/R4-19 |
| 临边昏暗系数 | Claret (2000) A&A 表格（按光谱型取近似档） | R4-6 |
| 昴星团成员星 3D 位置 | Gaia DR3 视差+自行（选星判据登记） | R4-17 |
| M13 结构参数 | Harris (1996, 2010 版) 球状星团目录（核半径/潮汐半径/浓度 c） | R4-19 |
| M42/M57/马头/蟹状形态 | NASA/ESA Hubble 公版图像（形态参考）；M57 三轴椭球壳模型（O'Dell et al. 2013）；蟹状环面/喷流（Chandra/Weisskopf et al. 2000） | R4-7/R4-14/R4-15/R4-16 |
| 参宿四对流胞/变暗事件 | VLTI/SPHERE（Montargès et al. 2021） | R4-18 |
| 黑洞观感基准 | EHT M87*（2019）/ Sgr A*（2022）光子环形态 | R4-11~R4-13 |
| 星系形态参数（倾角/臂数/螺距角/B/D 比） | RC3、S4G、NED | R4-9/R4-10 |
| 触须星系动力学 | Toomre & Toomre (1972) 潮汐相互作用图景 | R4-22 |

---

# 第一部分（P0）：基础设施

## R4-1 开发预览工位（/dev/preview）

### 1.1 需求

- ✅ 新增独立路由 `src/app/dev/preview/page.tsx`（App Router）：单独渲染指定天体细节模型，不加载主场景（无 Galaxy/Universe/SolarSystem/音频/store 主循环），黑色背景 + 可选参考网格（drei `Grid`，面板开关）
- ✅ URL 参数 `?body=<id>` 指定预览对象（页面客户端读 `window.location.search`）；预览注册表纯逻辑模块 `src/utils/devPreview.ts`：`previewEntryForBody(id)` 返回该天体的细节组件挂载配置（`componentKey` 标识实际 R3F 组件，渲染依赖不污染纯逻辑层；后续 R4 各阶段追加条目），未注册 id 返回 null → 页面显示占位提示并列出可用对象链接
- ✅ 内置轨道相机控制（drei `OrbitControls`）+ 参数面板：曝光滑杆（tone mapping exposure）/Bloom 开关/参考网格开关、时间流速、每个细节组件可声明 ≤8 个调试滑杆（`PreviewParam { key, label, min, max, default, step? }`，`MAX_PREVIEW_PARAMS=8` + `validatePreviewEntry` 注册期防错），滑杆值经 props 传入组件（越界经 `clampParamValue` 钳制）。**修复登记（用户反馈：曝光/时间流速滑杆无效果）**：曝光改为帧缓冲级实现——Canvas `flat` + EffectComposer 常驻 + 末端 `ToneMapping(ACES_FILMIC)`（裸 ShaderMaterial 不响应 `renderer.toneMappingExposure`，帧缓冲级对后续 R4 体积/透镜自定义 shader 预览一并生效）；时间流速加 HUD「虚拟时钟」读数 + 预览自转基准 0.05→0.15 rad/s（感知增强，仅预览页）；滑杆调参改为挂载时缓存材质引用 + 每帧 uniform 直写（原 props→useMemo 路径高频重建材质），uTime 覆写改显式 useFrame 优先级（0.5）不依赖隐式挂载顺序
- ✅ 显示实时 FPS 与 JS 堆（复用 `utils/performance.ts` 的 `createFpsCounter`/`recordFrame`/`formatFpsLabel`/`formatMemoryMB`/`readUsedHeapBytes`；harness 组件自持 rAF，不依赖主循环）
- ✅ 生产安全（**登记：方案 = 生产渲染空页 + 动态 import**，非 404）：`NODE_ENV === 'production'` 下页面渲染空 div、不引用 harness；预览专用 harness（含 three/drei/postprocessing）经 `next/dynamic` 动态 import 仅 dev 加载——实测生产 `output:'export'` 构建将 harness 打入独立异步 chunk（`out/_next/static/chunks/*.js`），**不被生产页 HTML 引用**，主应用 bundle 零增大、生产路由为空页不可用
- ✅ 首个可预览对象：接入现有 `StellarSurface`（导出自 `SpecialBodies.tsx`，参宿四红巨星档配置 limbU=0.75/cellScale=2.2/convection=0.7/rednessStrength=0.6 + 弥散气体壳），时间流速经虚拟时钟覆写 material.uTime 实现可调，作为管线验证样例

### 1.2 验收标准

- ✅ `npm run dev`（3100 端口）访问 `/dev/preview?body=betelgeuse` 可见恒星球体，滑杆调参实时生效（cellScale 2.2→6.0 对流颗粒尺度实时变细，截图 r41-01/r41-03 对比），绕行流畅 60 FPS（无头 Chrome Metal 后端 rAF 3 秒窗实测 60 FPS + HUD "帧率：60 FPS"，截图 r41-metal-betelgeuse）
- ✅ 未注册 id（`?body=not-a-body`，截图 r41-04）/ 缺参（无 `?body`，截图 r41-05）访问显示占位提示（列出可用对象链接），不报错（控制台仅 Cloudflare RUM CORS 噪声，与本页无关）；生产构建下路由为空页不可用
- ✅ `devPreview.ts` 纯逻辑（注册/查找/参数默认值/钳制/校验）单测覆盖（`devPreview.test.ts` 24 例，覆盖率 100%）；全量测试（1995 例/115 套件）/type-check/lint/build 全绿，覆盖率 gate ≥90% 保持

## R4-2 细节层管理泛化（detailLayer）

### 2.1 需求

- ✅ 新建纯逻辑 `src/utils/detailLayer.ts`，泛化 R2-7 `nearView.ts` 滞回门控与 R2-8 `nearViewLruUpdate` LRU 为统一机制：
  - `DetailLayerKind = 'particles' | 'volume' | 'lensing' | 'starCatalog'`（可扩展）
  - `DetailLayerSpec { bodyId, kind, enterDistanceUnits, exitDistanceUnits, budget: { particles?, volumeTexBytes?, gpuBytesEstimate } }`
  - 门控判据沿用现状：进入 = 飞往观察距离 ×1.5、退出 ×1.4 滞回，与 `resolveFocusTarget` 同源（单测断言：`galaxyDetailLayerSpec` 阈值同源逐星系对拍 + `nearViewGateUpdate` 委托逐状态对拍）；仅当前跟随/飞往目标可激活（`detailGateUpdate` 泛化为显式 enter/exit 双阈值入参）
  - LRU 按 kind 分池：`particles` 沿用容量 1；`volume` 容量 1（lensing/starCatalog 亦各 1，`DETAIL_LRU_CAPACITY_BY_KIND`）；总 GPU 估算预算 `DETAIL_GPU_BUDGET_BYTES = 64 MB`，超限先按池容量逐出、再跨池按最旧优先逐出（新声明层豁免；单层超总预算属注册期防错抛 RangeError），持有者注册表（claim/release/reset + `detailLayerGpuBytesInUse` 出账）供渲染端单例消费
- ✅ 提供 React 挂载 Hook `useDetailLayer(spec)`（`src/hooks/useDetailLayer.ts`，组件层薄封装）：返回 `{ active, opacity01 }`（0.5s 交叉淡入淡出，`DETAIL_LAYER_TRANSITION_SECONDS` 与 `NEAR_VIEW_TRANSITION_SECONDS` 同源同值），卸载即 dispose（React 卸载子树 + 注册表持有权幂等释放）。实现差异登记：a) `opacity01` 以帧读 getter（`() => number`）而非 React state 交付——附录 A 渲染纪律（零逐帧重渲染/零分配），沿用 R2-7 `getNear01` 先例；b) 增设保留策略两档 `retention: 'release-on-exit'（默认，R2-7 退出即释放）| 'lru-retain'（R2-8 LRU 保留淡出不卸载）`，两套现状语义收敛于同一 Hook；c) 支持自定义跟随判据/距离注入（`getFocused`/`getDistanceUnits`，日球层顶含旅行者标记判据、距离 = 相机位置模长的特例所需）
- ✅ 迁移改造：`nearView.ts` / `galaxyNearView.ts` 现有门控调用方切换到统一机制（**行为零回退**：进入/退出阈值、LRU 语义、淡入淡出时长逐项与现状一致，现有 `nearViewR27`（43 例）/ `galaxyNearViewR28`（29 例）单测**零修改全绿**，无需等价迁移）。迁移登记：`nearViewGateUpdate`/`nearViewLruUpdate`/星系持有者注册表改为委托 detailLayer 的兼容包装（API 不变）；调用方 `SpecialBodies.useNearViewGate`（7 处近观组件共用，包装签名不变）、`Heliopause`、`Universe.GalaxyObject` 三处切换到 `useDetailLayer`；新增 `galaxyDetailLayerSpec(galaxyId)` 生成星系近观统一规格。实现差异登记：Heliopause 原实现以"挂载态"作门控 prevActive（淡出窗口内滞回判据与 R2-7 canonical 实现略异的历史 quirk），迁移后统一为 SpecialBodies 同款纯门控状态语义（差异仅存在于 0.5s 淡出窗口内的重进入判据，目验无观感差异）
- ✅ 显存估算纯函数：`estimateGpuBytes(spec.budget)`（粒子按 float32 属性布局 position3+color3+size1 = 28 B/粒，与 GalaxyNearView 几何一致；体积纹理按 `volumeTextureGpuBytes(size, channels, bytesPerChannel)` = 分辨率³×通道×字节，size ≤128 附录 A 约束校验）；预算/逐出决策（`detailClaimUpdate`）单测覆盖

### 2.2 验收标准

- ✅ R2-5/R2-7/R2-8 既有行为回归：L3 15 站与 L4 8 站巡游逐站近观激活/释放正常（无头 Chrome 整圈实测），连续切换 10 个目标 JS 堆稳定（末 10 站采样 29–53 MB GC 波动、净差 +4 MB，无泄漏趋势），L3/L4 实测均 60 FPS（rAF 3 秒窗）
- ✅ 现有近观相关单测全部通过（零修改，无需等价迁移）；新增 `detailLayerR42` 门控/LRU/预算单测（42 例，`detailLayer.ts` 覆盖率 100%）；全量 2037 例/116 套件通过，覆盖率 gate ≥90% 保持（全局 98.4%）
- ✅ 无头 Chrome 目验（Metal 后端 1280×800，生产静态构建 3100 端口）：L3 巡游一整圈（截图 r42-L3-01～15）+ L4 巡游一整圈（截图 r42-L4-01～08）截图抽查——M13 近观星场/M42 云团/M31 旋臂粒子层/M87 Sérsic 椭球云均正常激活与交叉淡出，与 R2-7/R2-8 交付截图观感一致（无回退）

## R4-3 体积渲染框架 ①：raymarch 材质 + 3D 密度纹理工具

### 3.1 需求

- ✅ 新建纯逻辑 `src/utils/volume.ts`：
  - ✅ 3D 密度场构建工具：`buildDensityTexture(size, sampler)` → `THREE.Data3DTexture`（R8 单通道，`assertVolumeTextureSize` 校验 2 ≤ size ≤ 128；`buildDensityData` 体素中心映射归一化坐标 (-1,1)³）；确定性（FNV-1a 种子 `volumeSeed(id)`——`galaxyNearViewSeed` 同款算法，噪声域偏移经 `utils/random.ts` `createSeededRandom` 从种子展开）
  - ✅ 密度场塑形基元：`fbm3`（复用 `stellarSurface.ts` 现有 `valueNoise3D`/`hash3` 基元，勿新造）、球/椭球/壳层 SDF（椭球取 IQ 一阶近似登记）+ `sdfDensityFalloff` 软衰减、`smoothUnionSdf`/`smoothSubtractSdf`（IQ 多项式，k=0 退化为硬并/差）；测试体采样器 `makeSphericalFbmCloudSampler` 一并交付（R4-7 塑形可复用）
  - ✅ 发射-吸收积分参考实现 `integrateEmissionAbsorption`（CPU 版 front-to-back，与 shader 循环同式）+ 恒定密度解析解 `constantDensityEmissionAnalytic` 对比（单测：512 步相对误差 <1% 且随步数递减）；另附 `intersectRayBox`（shader hitBox 的 CPU 镜像，盒内/盒外入射 + 方向零分量 NaN 防护同式单测）
- ✅ 新建 `src/components/Scene/volumetric/VolumeMaterial.ts`：raymarch ShaderMaterial 工厂 `createVolumeMaterial`
  - ✅ 单位盒内固定步数步进（默认 64 步，uSteps 可调、`clampVolumeSteps` 钳 16–128，循环编译期上界 128）；发射-吸收模型；密度→双色映射（uColorA/uColorB + uThreshold 密度阈值 smoothstep 平滑混色）。实现差异登记：密度纹理为 R8 单通道（附录 A 显存预算取向），"双通道密度"以单通道密度绕阈值混双色实现，Hα/OIII 双通道分离留待 R4-7 按需扩展
  - ✅ 相机盒内/盒外两种入射（slab 求交 t0 钳 0 + side=BackSide 穿盒不消失）、透明排序（depthWrite=false + `VOLUME_RENDER_ORDER` 常量由挂载方设 renderOrder）、log depth buffer 兼容（logdepthbuf include，`Starfield.tsx` :33 先例）
  - ✅ 与 Bloom 共存：uIntensity 控亮 + 输出硬钳上限（`VOLUME_MAX_OUTPUT_LUMINANCE`）、方向零分量 1e-5 下限防除零——无 NaN/Inf。实现差异登记：**不设** `glslVersion: GLSL3`——three r169 WebGL2 下 ShaderMaterial 默认路径即编译为 GLSL ES 3.0（sampler3D/inverse() 可用）且保留 gl_FragColor 兼容 define；显式 GLSL3 会关闭该 define 致 tonemapping/colorspace include 编译失败（无头 Chrome 实测登记）
- ✅ 预览页接入：注册测试体 `?body=volume-test`（componentKey `volume-raymarch-test`，`VolumeTestPreview` 组件）——球形 fBm 密度云（96³ 纹理、确定性种子、卸载即 dispose），滑杆调步数/密度倍率/吸收系数/混色阈值/双色（色相 A/B → HSL）/亮度（7 个 ≤8 上限），供人工确认框架观感方向（**框架检查点：待用户目检**）
- ✅ 本阶段不接主场景、不做半分辨率（R4-4 范围）；uniforms 已预留：uTime（流动，预览页每帧写入、shader 本阶段不消费）、uQuality（R4-4 降级用，默认 1）

### 3.2 验收标准

- ✅ 预览页 `volume-test`：绕行观察密度云有真实体积感（无头 Chrome Metal 1280×800 截图 r43-01 正视 / r43-02 侧视 / r43-03 俯仰：内部团块结构随视角变化、视差正确、无 billboard 感），步数 64 默认视角（占屏约 1/3）实测 60 FPS（rAF 3 秒窗；128 步亦 60 FPS）
- ✅ 相机穿入包围盒内部画面连续无翻转/消失（截图 r43-04，盒内 60 FPS）；Bloom 关/开组合无发光溢出异常（截图 r43-05/r43-06 对比），控制台零错误无 NaN 异常
- ✅ 密度场构建/塑形基元/CPU 积分校验单测 `volumeR43`（37 例，含确定性双次构建逐字节一致断言 `Buffer.compare === 0`）；`volume.ts` 覆盖率 100%（语句/函数/行）/98.2%（分支），全局覆盖率 gate ≥90% 保持（全量 2074 例/117 套件）

## R4-4 体积渲染框架 ②：半分辨率管线 + 蓝噪声抖动 + 帧率自适应降级

### 4.1 需求

- ✅ raymarch 步进起点蓝噪声抖动（`utils/volume.buildBlueNoiseData/Texture`：64×64 程序化生成，void-and-cluster 简化算法——逐秩最小能量填充 + 环绕高斯斥力核，Repeat 平铺无缝，确定性种子，零新依赖；单测断言直方图严格均匀 + 邻差显著高于白噪声期望的蓝色频谱特征；shader 侧 texelFetch(gl_FragCoord mod 64) 取值偏移起点 [0,1) 步长，uJitter 可关做 A/B 对比；抖动粒度随 RT 视口缩放与渲染分辨率一致）
- ✅ 半分辨率渲染路径：**选择「独立 RT + 合成 pass」**（`volumetric/VolumeHalfRes.ts`，未采用降步数等效近似，故无两方案对比实测义务）。实现登记：a) RT 常驻满分辨率（HalfFloat 线性 HDR、无深度附件），渲染经**动态视口/剪裁子区域**落到 scale² 像素——RT 比例可连续取值（平滑插值需要），切档零重分配；b) 体积 mesh 置独立子场景，useFrame（优先级 0.7，uniform 覆写后、Composer 渲染前）手动 render 到 RT；主场景全屏三角形合成（采样 uv×子区域比例 + 边缘半像素钳制防残留 texel 渗色），预乘 alpha 链路与直绘等效，落入 EffectComposer 输入缓冲 → Bloom/ToneMapping 管线零改动；c) 差异登记：合成三角形 depthTest=false（体积不被主场景实体逐像素遮挡——预览页仅参考网格受影响可关闭，主场景深度合成归 R4-8 接入时处理）；RT 无 MSAA（软性云雾无几何边缘，实测无观感差异）
- ✅ 新建纯逻辑 `src/utils/adaptiveQuality.ts`：3 秒滑动窗 FPS 采样 → 档位状态机（high 64 步/full → mid 48 步/half → low 32 步/half），滞回防抖（降档 <55 即时、升档 ≥58 需连续 5s，55–58 迟滞带；换档清窗防跨档样本混算；样本不足——帧数 <24 或跨度 <1.5s——不决策），档位映射 uQuality（=步数比例 1/0.75/0.5，作用于基准步数）/步数/RT 比例；核心判定 `decideTier` 纯函数 + 就地更新状态容器（渲染循环零分配）。实现差异登记：升档达标起点**回溯到窗口起点**（窗口均值已达标则达标事实自窗口起点成立）——否则窗口积累期（~1.5s）会把验收"5 秒内升档"拖长到 ~6.5s
- ✅ 档位变化平滑过渡：`advanceQualityBlend` ≤0.5s 线性插值（uQuality 与 RT 比例速率 1.0/s，相邻档 ≤0.25s；目验 HUD 捕捉到 RT 60%/66%/78%/85%/88% 中间态，无画面跳变）；HUD 性能指示实现定夺登记：**予以显示**——预览页 HUD 增设「体积质量档」行（档位/自动|强制/步数/RT 比例/窗口 FPS，每帧直写 textContent 不走 React state）
- ✅ 预览页 `volume-test` 增加质量档位强制切换滑杆（0 自动 / 1 低 / 2 中 / 3 高，`forcedTierFromSlider` 映射；强制期间状态机后台继续采样，回自动即接管）+ 蓝噪声抖动开关滑杆。登记：为容纳两个新滑杆（条目上限 8），R4-3 的「混色阈值」滑杆移除（uThreshold 保持材质默认 0.45，非核心调参，双色观感由色相滑杆覆盖）

### 4.2 验收标准

- ✅ 全屏体积（占比 >2/3）自适应降级生效（Metal 2560×1600 + 基准 128 步制造负载：high 窗口 <55 → ~1s 降至 mid，帧率恢复 59–60 ≥55）；恢复小占比后 4.5s 升档（≤5s，达标起点回溯窗口起点生效）。行为登记：负载恰处两档之间时（mid 稳态 60 FPS 持续达标）状态机按滞回规则周期性探测上档（~6.5s 一轮、探测 ≤1.5s 即回落）——动态分辨率控制器的标准探测行为；SwiftShader 软渲染极端环境下加载期即自动降至 low 封底不再震荡。截图 r44-timing-01/02 + r44-sw-01～03 登记
- ✅ 蓝噪声抖动后无肉眼可见步进条带（截图对比登记：r44-03/04（20 步远景）+ r44-05/06（近景）——关闭时青色团块内"洋葱环"条带清晰可见，开启后完全打散为均匀噪点）
- ✅ `adaptiveQuality` 状态机单测全覆盖（`adaptiveQualityR44` 44 例：滞回边界 55/58/5000ms 恰值、迟滞带、窗口不足样本（帧数/跨度双下限）、换档清窗、时间回退、插值收敛/单调、强制档映射；覆盖率 100%）+ 蓝噪声单测（`volumeR44` 9 例：确定性/直方图/频谱/平铺）；全量 2125 例/119 套件通过，覆盖率 gate ≥90% 保持

## R4-5 离线数据烘焙管线（scripts → public/data/）

### 5.1 需求

- ✅ 新建 `scripts/bake-data/` Node 脚本目录 + `npm run bake:data` 命令：构建期（开发者手动）运行，产出静态资产到 `public/data/`；**运行时零外部网络请求**（烘焙产物随仓库提交）——`scripts/bake-data/index.ts`（Node 26 原生 TS 执行，零新依赖），产物三件已提交
- ✅ 数据获取策略：脚本内置从公开接口拉取（Gaia TAP/VizieR）**或** 以内嵌文献数值表为源（网络不可用时的降级路径，二选一实现并登记来源与查询语句/文献表号）——实现差异登记：两路径兼备。昴星团默认从**内嵌查询快照**烘焙（`snapshots/pleiades-gaia-dr3.csv` + meta 文件登记 ADQL 语句/选星判据/retrievedAt/license，离线可用），`--fetch` 可选联网重拉快照（Gaia TAP sync）；star-params/m13 为脚本内嵌文献数值表（逐项 ref 登记）
- ✅ 首批烘焙产物：
  - ✅ `pleiades.json`：昴星团成员星 ≤600 颗（Gaia DR3 视差 7.0–7.7 mas + 自行共动选星，判据登记）——每星 {x,y,z}（pc，簇质心系）、B−V、视星等。判据登记：锥形检索中心 (ICRS 56.75°, +24.1167°) 半径 2.5° + 视差 7.0–7.7 mas + |(pmra,pmdec)−(19.9,−45.5)|<5 mas/yr，按 G 取最亮 600 颗；坐标 ICRS 轴向、原点平移至成员星质心；光度转换登记：Gaia DR3 文档 §5.5.1 表 5.9 官方 Johnson-Cousins 关系（V = G − f(BP−RP)，σ=0.030；B−V 由 GBP−GRP = f(B−V)（σ=0.066）单调区间二分反解；抽检 Maia 计算 V=3.89 vs 目录 3.87 在 σ 内）。已知限制登记：Gaia DR3 对极亮成员（如昴宿六 Alcyone V=2.87）天测/测光解不全，不在选星结果中——Gaia 基选星的固有特性
  - ✅ `star-params.json`：R4 涉及恒星（参宿四/参宿七/天狼星 A/B/造父一/WR 124）的 Teff/半径/光度/光谱型（SIMBAD 数值 + 文献登记）——SIMBAD sp_type（检索 2026-07-28）+ 逐星 ref：Joyce et al. 2020（参宿四）/Przybilla 2010 + Moravveji 2012（参宿七）/Kervella 2003 + Adelman 2004 + Liebert 2005（天狼 A）/Barstow 2005 + Holberg 1998（天狼 B）/Mérand 2005 + Engle 2014（造父一，脉动均值）/Hamann et al. 2019（WR 124）
  - ✅ `m13-profile.json`：M13 King profile 参数（Harris 目录：核半径/潮汐半径/浓度/积分星等）——Harris (1996, 2010 版) NGC 6205 行：r_c=0.62′、r_h=1.69′、c=1.53、d=7.1 kpc、V_t=5.78、[Fe/H]=−1.53；潮汐半径 21.01′ 由 r_t = r_c·10^c 导出（King 模型定义，meta.note 登记），另附小角度近似导出的 pc 值
- ✅ 产物格式约束：JSON（数据量 <1 MB）或二进制 Float32（≥1 MB 时）；`public/data/` 总量（gzip 前）≤5 MB；每个产物含 `meta { source, retrievedAt, license, count }`——三产物均 <1 MB 取 JSON（pleiades 48.0 KB / star-params 2.1 KB / m13-profile 0.8 KB，总量 50.9 KB）；meta 四字段齐全，pleiades 另附 query/selectionCriteria/photometricTransform 登记字段
- ✅ 运行时加载器 `src/utils/bakedData.ts`：fetch + 解析 + 内存缓存 + 校验（count/数值范围断言），加载失败返回 null（消费方需可降级到现状程序化分布）；单测用本地 fixture——校验为纯函数三件（validatePleiades/validateStarParams/validateM13Profile：meta 结构、count 一致性、坐标模长 ≤30 pc、B−V/V/Teff/半径/光度数值域、r_t>r_c、无 NaN）；缓存按 URL、成功缓存失败不缓存（可重试）；fixture 三件入 `__tests__/fixtures/`
- ✅ 脚本自校验：产物写出前断言（星数范围、坐标模长合理、无 NaN），失败即退出非零——星数 [100,600]、视差窗、质心距离 125–145 pc、坐标模长 ≤30 pc、B−V∈[−0.5,3.5]、V∈[−2,20]、转换关系适用域、恒星参数数值域、r_t>r_c、总量 ≤5 MB，`assertBake` 失败 `process.exit(1)`

### 5.2 验收标准

- ✅ `npm run bake:data` 幂等可重复执行，产物两次运行一致（或差异仅 meta.retrievedAt）；自校验通过——实测两次运行产物 SHA-1 逐字节一致（默认模式产物为快照的纯函数，retrievedAt 取自快照 meta；`-0` 归一化保证舍入幂等）；自校验通过
- ✅ `bakedData.ts` 加载/校验/降级单测（fixture 驱动）覆盖；产物总量 ≤5 MB；覆盖率 gate ≥90% 保持——`bakedData` 21 例（三校验器合法/非法路径、加载成功/缓存/网络异常重试/HTTP 非 2xx/JSON 解析失败/载荷未过校验/缓存重置 + 实际产物完整性集成断言），bakedData.ts 覆盖率 100%；产物总量 50.9 KB；全量覆盖率 gate 保持
- ✅ 主应用现有行为零影响（本阶段无消费方，仅管线就绪）；全量测试/build 全绿——src 侧仅新增 bakedData.ts（无引用方），全量 2146 例/120 套件通过，type-check/lint/build 全绿

---

# 第二部分（P0）：标杆渲染升级

## R4-6 恒星表面物理化增强

### 6.1 需求

> 增量基线：P6 已交付 `StellarSurface`（fBm 对流 + 简单临边昏暗），本阶段为物理化改造，勿重写整个组件。

- ✅ 新建纯逻辑 `src/utils/starPhysics.ts`：
  - ✅ `blackbodyRGB(teffK)`：Planck 谱 → CIE XYZ → sRGB（3,000–50,000 K 域外钳制，25 采样点查表插值——表取 Mitchell Charity CIE 10°/sRGB 黑体色数据，登记：不做运行时完整 CIE 管线；关键温度点单测断言：3,500 K 橙红 / 5,800 K 白黄 / 9,900 K 蓝白 / 25,000 K 蓝 + 蓝红比单调）
  - ✅ `limbDarkeningU(spectralType)`：按光谱型档位（M/K/G/F/A/B/O + WD）返回线性临边昏暗系数 u（Claret 2000 V 波段近似档来源登记：M 0.85 → O 0.30、WD 0.25；实现差异登记：Wolf-Rayet W 型归 O 档高温近似、未识别型回落 G 档默认值）
  - ✅ `granulationScale(radiusRsun)`：对流颗粒相对尺度（实现为 `granulationCellScale` 直接输出 shader 噪声频率 uCellScale——巨星颗粒大而少 → 频率低、矮星细密 → 频率高；近似关系 clamp(12−3.4·log10(R/R☉), 2, 12) 登记，锚点参宿四 764 R☉→2.2 与 P6 现状一致）
- ✅ `StellarSurface` shader 改造：uniform 注入 `blackbodyRGB(Teff)` 基色（替换硬编码颜色，sRGB→线性工作色彩空间）、u 系数临边昏暗、噪声频率按 `granulationCellScale` 调制、对流时间演化（uTime 驱动 fBm 噪声域漂移，首层视觉周期 ≈20 s 落在 20–60 s 区间，登记）+ 自转流动（实现差异登记：各恒星组件无既有自转参数可沿用，新增 uSpin 绕 y 轴旋转采样域、默认 0.02 rad/s 缓慢流动为可视化选择）
- ✅ 各恒星参数接入：Teff/半径/光谱型经新增 `useStarParams` hook 从 `public/data/star-params.json`（R4-5，`bakedData.loadStarParams`）读取，加载失败降级 `FALLBACK_STAR_PARAMS` 硬编码表（降级路径登记；降级表与烘焙产物逐字段一致由单测断言同步）；天狼星 B 白矮星单独档（u 0.25 最弱档、25,200 K 黑体蓝，与 R2-7 既有调蓝一致化）；增量交付：天狼星 A/B 由 meshBasicMaterial 纯色球升级为 StellarSurface
- ✅ 预览页注册全部 6 类恒星（betelgeuse/rigel/sirius/sirius-b/delta-cephei/wr-124），滑杆：Teff 覆写（黑体基色实时重算）/噪声频率/时间流速
- ✅ 太阳（Sun.tsx 独立管线）**不在本阶段范围**（登记）；颜色变化对 Bloom 亮度的影响逐星目检无过曝（预览页 6 星 + L3 恒星站截图核对）
- ✅ 补齐 `StellarSurface` shader 的 log depth 兼容（vertex/fragment 各三件 `logdepthbuf` include，`Starfield.tsx` :33 先例）

### 6.2 验收标准

- ✅ 预览页逐星目检：颜色与光谱型一致（截图登记 6 张 r46-preview-*：参宿四橙红/参宿七蓝白/天狼星 A 蓝白/天狼星 B 蓝/造父一白黄/WR 124 深蓝）；对流有可感知时间演化（4× 流速两帧对流图案明显重分布，r46-time-A/B）；临边昏暗巨星/矮星观感区分可辨（参宿四边缘显著变暗红 vs 天狼星 B 近平盘）
- ✅ 主场景 L3 巡游恒星站点回归：5 个恒星站逐站截图（r46-L3-*）远景观感无突兀变化、无过曝，逐站实测 60 FPS、JS 堆 21–28 MB、控制台零错误
- ✅ `starPhysics` 纯函数单测（26 例：色温关键点/系数档位/尺度单调性/降级表同步，starPhysics.ts 覆盖率 100%）；全量 2175 用例/121 套件通过，覆盖率 gate ≥90% 保持（语句 98.52%）

## R4-7 猎户座星云 M42 体积化 ①：密度场构建 + 预览页验证

### 7.1 需求

- ✅ 新建纯逻辑 `src/utils/nebulaVolume.ts`：M42 密度场塑形（组合 R4-3 基元）——
  - ✅ 主体：不对称扇贝状发射腔（椭球包络 − 前向炮膛碗腔开口朝观察侧 +z、碗壁经湍流扰动成扇贝缘；近似程度登记于文件头：只复现扇贝腔/西北亮弓/东南暗湾/Trapezium 空腔四特征的相对方位与量级，云体细节程序化生成、与真实 M42 天区方位存在艺术化差异；西北亮弓 = 碗壁增密壳 × 西北象限角向加权 + 全域角向增益，西北发射柱积分 ≥1.25× 东南镜像柱单测锚定）
  - ✅ 内嵌四边形星团（Trapezium）空腔（乘法软挖孔，星点处密度近零）+ 电离前沿密度增强壳（空腔外侧 1.8× 增密带）
  - ✅ 细节：3 八度 fBm 湍流（轮廓扰动 + 表层阈值化侵蚀出碎散云缘）+ 丝状密度脊（ridged 噪声，采样域经湍流值方向场扭曲）
  - ✅ 双通道输出：发射密度 R + 吸收密度 G（东南前景尘埃湾：双椭球平滑并 z 向压薄——薄板登记：避免高消光柱投出过长阴影隧道，目验调参）；实现差异登记：Hα/OIII 混合权重不烘焙进纹理，由 `m42ColorWeight01(r)` 随到 Trapezium 距离在 shader 侧径向计算（内区 OIII 偏青、外区 Hα 偏红，纯径向近似登记）；发射总量 ×0.32 标定防 8-bit 钳制饱和抹平亮弓角向梯度
- ✅ 烘焙为 128³ Data3DTexture（RG 双通道 `createRgDensityTexture`）；实现方式登记：取**分帧构建**（非 Worker——Jest/Next 集成简单且已满足卡顿约束）——`createRgVolumeBuild`/`advanceRgVolumeBuild` 以 z 切片为粒度按每帧 22ms 预算推进，数据与分块方式无关（任意预算逐字节一致单测断言）；实测墙钟 513ms（<1s）、计算 473ms、20 块、最大单块 26.2ms，console.info 打点登记；FNV-1a 确定性种子（`volumeSeed('orion-nebula')`，同种子双次逐字节一致单测断言）
- ✅ 预览页注册 `?body=orion-nebula`：体积渲染（`NebulaVolumeMaterial.ts` RG 双通道 raymarch——尘埃只消光不发射，离散格式与 CPU 参考 `integrateEmissionAbsorptionDual` 同式单测校验；半分辨率 RT + 自适应质量沿用 R4-4 路径）+ Trapezium 四颗亮星 sprite 内嵌（`trapeziumStarBoxPositions()` 与空腔一致，程序化双高斯 glow；近似登记：体积按全程透射率压暗星点、未按星点深度截断积分，空腔内密度低偏差可忽略）+ 滑杆（§R4-7 指定三件：密度倍率/双色权重/步数，另有尘埃吸收/亮度/质量档/抖动共 7 ≤ 上限 8）
- ✅ 本阶段仅预览页可见，不接主场景（R4-8 范围）；**交付后人工目检检查点**：形态与 Hubble 公版图像可对应（扇贝腔/暗湾可辨），确认后方可启动 R4-8

### 7.2 验收标准

- ✅ 预览页绕行 360°：体积视差真实、扇贝开口/暗湾/内腔结构三向可辨，无 billboard 感（8 方向截图 r47-01～08 + 俯仰 r47-09/10 + 推近 r47-11 登记；暗湾随视角绕行跨越腔前、背面透视腔体发光，视差正确）
- ✅ 128³ 构建期主线程无 >100ms 卡顿（分帧打点登记：最大单块 26.2ms，console.info 输出无头 Chrome 捕获取证）；预览页 60 FPS（实测全程 60 FPS 保持 high 档未触发降级；含 128 步/推近/强制低档）
- ✅ 密度场纯函数单测（`nebulaVolumeR47` 31 例：确定性/关键采样点密度断言——腔内 0、壳层 ≥0.25 且 ≥10× 腔内、暗湾吸收 >0.5 且西北镜像近零/亮弓不对称/分帧预算语义/积分一致性与解析收敛/输入校验，nebulaVolume.ts 覆盖率 99.5%）；覆盖率 gate ≥90% 保持（语句 98.56%，全量 2211 用例/122 套件）

## R4-8 猎户座星云 M42 体积化 ②：场景接入 + 色彩调参

### 8.1 需求

- ✅ 主场景接入：`SpecialBodies.tsx` 猎户座星云组件挂接 `useDetailLayer({ kind:'volume' })`（R4-2，release-on-exit）——跟随/飞往 M42 且距离达阈值（与 R2-7 近观层同源同值，两层同时机激活、交叉淡出无空档）时挂载新组件 `Scene/OrionVolumeLayer.tsx`（分帧烘焙 22ms/帧 + R4-4 半分辨率 RT/合成路径复用），与现有 billboard + `NebulaPuffCloud` + youngStars 星点交叉淡出（0.5s，纯函数 `utils/nebulaVolumeScene.orionBaseLayerFactor/orionPuffFactor`——vol01=0 时与 R2-7 现状逐点一致，行为零回退单测锚定）；退出时反向恢复，体积纹理/RT/材质随卸载 dispose。实现差异登记：a) detailLayer 0.5s 门控淡入之上叠加"烘焙就绪"二次平滑（`orionVolumeFadeTarget`：未就绪目标恒 0，billboard 保持原样无空档）——烘焙晚于门控就绪时有效过渡 0.5–1s（主场景烘焙实测 ~490ms/20 块/最大单块 26.2ms）；b) 合成材质新增 uOpacity 淡入淡出 uniform（预乘 alpha 颜色/alpha 同乘，淡出为变透明非变黑）；c) 合成全屏三角形 raycast 置空（不拦截点选）；d) R4-4 遗留的主场景深度合成决议：维持 depthTest=false——M42 体积仅近观跟随激活、视野内无前景实体穿插（billboard/星点已交叉淡出移交），实测无遮挡穿帮，免深度附件带宽；e) Trapezium 星点经共享模块 `volumetric/TrapeziumSprites.ts` 内嵌体积子场景（R4-7 预览页重构复用），主场景原 youngStars sprite 经 volDim 标记淡出移交
- ✅ 位姿对齐：体积包围盒边长 = `visualRadiusLy` 场景尺寸 × 2.6（`orionVolumeBoxEdgeUnits`，发射包络折算 ≈1.0× 视觉半径与 billboard/PuffCloud 尺度衔接）；体积容器逐帧复制星云组世界矩阵（`useGalacticPlacement` 银河系组变换 + sun-relative 偏移），远近景过渡无位置跳变（截图 r48c-04→06 位置连续）
- ✅ 色彩：默认自然色近似 Hα 红棕 #cc5a3c + OIII 青灰 #8fb3a8（`ORION_SCENE_VOLUME_PARAMS`，相对 R4-7 预览页窄带饱和默认降饱和），与"哈勃调色板"（SII/Hα/OIII→RGB 假彩色）差异说明已入信息面板 dataSource 行；亮度 1.3→1.15 随主场景 Bloom 联调（目验核心不过曝、外缘不糊黑，截图 r48c 系列）
- ✅ 自适应质量（R4-4）在主场景生效（high 64 步/full → mid 48 步/half → low 32 步/half，无强制档滑杆）；LRU：体积池容量 1（单测断言），切换到其他体积天体（后续 R4-14/15/16）时逐出
- ✅ 信息面板 M42 卡片补"结构"行（电离腔（扇贝状发射腔朝观察侧开口）+ 四边形星团空腔 + 东南前景尘埃湾）+ dataSource 追加 Hubble 公版图像形态参考与色彩映射差异登记

### 8.2 验收标准

- ✅ L3 巡游至猎户座站：飞抵后 billboard 平滑过渡到体积层（时序截图 t=1.8s billboard 淡出中 → t=2.7s 体积接管，位置连续），绕行（6 方向）/渐进穿越无薄片或跳变观感——尘埃湾暗斑/青灰内腔/Trapezium 星点随视角连续视差（截图 r48c-1x/2x/3x 登记；升级幅度对照登记：R2-7 交付为 18 张 billboard sprite 团絮的伪视差（r27 系列），本阶段为真体积 raymarch，穿越云体内部结构为 R2-7 不可达能力）
- ✅ 离开跟随 → 体积层淡出释放，JS 堆回落（连续进出 5 次，CDP 强制 GC 后采样：out 45–47 MB / in 50–51 MB，无增长趋势；体积纹理/RT/材质随卸载 dispose，每次返回重新烘焙打点 ~490ms 一致）；全程 60 FPS 未触发降档（≥55 达标，自适应 mid 未介入）
- ✅ L3 全序列巡游整圈回归（14 站 + 循环闭合，逐站截图 r48d-L3 系列）无其他站点观感/性能回退（60 FPS、末 10 站堆净差 0 MB）；覆盖率 gate ≥90% 保持（新增 `nebulaVolumeSceneR48` 22 例，nebulaVolumeScene.ts 覆盖率 100%，全量 2233 例/123 套件）

## R4-9 星系近观多分量 ①：粒子生成器扩展（纯逻辑）

### 9.1 需求

> 增量基线：R2-8 `utils/galaxyNearView.ts` 已有核球+盘+旋臂/团块/Sérsic 椭球生成器，本阶段纯逻辑扩展 + 单测，不动渲染。

- ✅ 生成器新增分量（每分量独立函数 + 组合入口 `generateGalaxyNearViewComposite`，种子按分量派生 `galaxyNearViewSeed('<id>:<component>')`）：
  - ✅ 尘埃带：沿旋臂内缘的暗吸收粒子（`generateDustLaneParticles`：相位 = 对数螺旋脊线 + 0.6×臂宽内缘偏移 + 0.35×臂宽窄散布 ±3σ 截断，深棕全通道 <0.3；输出分量标记 `component:'dust'` 与位置/尺寸，混合方式归 R4-10）
  - ✅ HII 区：沿旋臂离散分布的发射团（`generateHiiRegionParticles`：粉红大颗粒 3.0–4.5 少量，确定性 dart-throwing 泊松盘采样，最小间距 = 盘半径×0.055、尝试上限 60×配额）
  - ✅ 年轻星团：旋臂脊线上的蓝白小颗粒串（`generateYoungClusterParticles`：散布 0.15×臂宽 ±3σ 截断紧贴脊线，b ≥ r 通道）
  - ✅ 老年盘底色：色调按半径梯度参数化（`oldDiskColorAtRadius` 内红黄 #ffce8a → 外偏蓝 #aabfff，红/蓝通道单调性单测）+ `applyOldDiskColorGradient`（纯函数再着色副本，不改现有生成器输出——实现差异登记：现有盘粒子的实际着色替换随 R4-10 渲染接入，本阶段渲染零改动）
- ✅ 形态参数表扩展：`GALAXY_MORPHOLOGY_PARAMS` 9 星系（M31/M33/LMC/SMC/M32/M110/人马座矮/M87 + 银河系近观复用登记，无近观配置、配额抛错）逐星系登记 {倾角、臂数、螺距角、B/D 比、尘埃带强度、HII 密度}——来源 RC3/S4G/NED 近似档逐星系注释（椭圆/矮椭圆 dust/HII 为零且 B/D 无盘登记 Infinity，M110 少量尘埃云差异登记；不规则 LMC/SMC dust/HII 登记非零但新分量配额为 0——HII 粉与蓝白年轻星已由 R2-8 团块分量承载，登记；螺距角为登记值不驱动几何，新分量沿基础层 spiralTightness 对数螺旋对齐旋臂，差异登记）
- ✅ 粒子预算：单星系总量 ≤12,000（`GALAXY_NEAR_VIEW_MAX_PARTICLES` 8,000→12,000 上调登记；基础层上限 8,000 不变，新常量 `GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES`；LRU 容量 1 不变→ 全局峰值增量 +4,000）；各分量配额纯函数 `galaxyComponentQuota`（dust 1600×强度 / HII 140×密度 / 年轻星团 1000×密度，峰值 M31 合计 9,850）并单测断言总量；登记：`galaxyDetailLayerSpec` GPU 估算仍按基础层粒子计，随 R4-10 渲染接入一并更新
- ✅ 确定性：FNV-1a 种子沿用，两次生成逐字节一致（单测）；全部新分量纯函数 + 单测（分布范围/配额/泊松盘最小间距/颜色梯度单调性）

### 9.2 验收标准

- ✅ `galaxyNearView` 扩展单测全绿（新增 `galaxyNearViewR49` 34 例 + 现有 `galaxyNearViewR28` 29 例回归全绿，其中 R2-8 预算断言改指基础层常量 8,000——等价迁移登记）：分量配额/确定性/参数表完整性（9 星系逐一断言 dust/HII 配置与形态类型一致：椭圆类 0、旋涡 >0、不规则登记值非零、银河系复用登记）
- ✅ 类型检查/lint/build 全绿；覆盖率 gate ≥90% 保持（全量 2267 例/124 套件，语句 98.54%，galaxyNearView.ts 98.57%）
- ✅ 本阶段渲染零改动（`GalaxyNearView.tsx` 零 diff、不消费新分量），主场景行为零变化（全量回归确认；纯逻辑阶段无需无头 Chrome 目验，登记）

## R4-10 星系近观多分量 ②：渲染接入 + M31 专属细节

### 10.1 需求

- ✅ `GalaxyNearView.tsx` 消费 R4-9 新分量（`generateGalaxyNearViewComposite`）：dust 粒子用 normal 混合暗色第三 Points（renderOrder=2 置于加性星光层之后，对先绘制亮层普通混合变暗实现"吸光"观感——加性混合无法画暗，方案登记；Galaxy.tsx 银河系尘埃带同款先例）；HII/年轻星团合入第二加性 Points 不同 size/color 通道（HII 大颗粒点径上限 6→16px 呈发射团辉斑、星团蓝白小颗粒串沿脊线；基础层加性参数与 R2-8 现状一致，颜色升级为老年盘底色梯度）。实现登记：软圆点 shader 源三层共享，层间差异经 uniform（uMaxSize/uAlphaBase/uAlphaScale）注入；几何只建一次、渲染循环仅写 uOpacity，卸载 dispose 全部几何/材质
- ✅ M31 专属：真实倾角 77° 姿态——近观朝向统一入口 `galaxyNearViewOrientation`：M31 由 id 哈希改为专属登记值（倾角 77°/NED + PA 38° 经新纯函数 `inclinedOrientationRad` 构造：视线 = 原点→M31 方向、盘面法线-视线夹角 = 倾角，欧拉角与 three.js 'XYZ' 同约定，单测复核夹角 77°），其余星系沿用哈希（差异登记，零变化单测断言）+ 尘埃环结构（`M31_DUST_RING`：10 kpc = 32,600 光年环，dust 配额 45% 划归环粒子——方位均匀 + 径向高斯 ±3σ 截断；环宽/占比为观感示意档登记；`generateDustLaneParticles` 可选 ring 参数缺省时与 R4-9 逐字节一致，零回退单测锚定）+ 核球色调偏黄（`applyBulgeTint`：核球内 3D 半径线性衰减混合暖黄 #ffd18c 档，纯函数副本语义，仅 M31 套用登记）。附带兑现 R4-9 登记项：`galaxyDetailLayerSpec` GPU 估算改按多分量配额合计（M31 = 9,850 粒；HII 泊松盘实际接受数 ≤ 配额取上界登记；detailLayerR42 断言等价迁移）
- ✅ 与远观贴图交叉过渡回归：billboard ↔ 粒子层切换在新姿态下无位置跳变（M31 远观 billboard 恒面向相机，77° 姿态差异在 0.5s 淡入过程中呈现，观感登记；无头 Chrome 目验飞抵/切站过渡无异常）
- ✅ 预览页注册 `?body=m31` + 不规则对照 `?body=lmc`（新组件 `components/dev/GalaxyNearViewPreview.tsx` 复用主场景 `GalaxyNearViewLayer` + 缩放组适配预览尺度）滑杆三件：dust 强度/HII 密度（[0,1] 域经 `GalaxyCompositeOverrides` 重新生成分量，越界抛 RangeError、域内任意组合总量 ≤12,000 单测断言；登记：LMC 新分量配额恒 0 属 R4-9 设计——HII 粉/蓝白年轻星由 R2-8 团块承载，两滑杆对 LMC 无可见效果，面板标注）/倾角覆写（0–90°，预览视线 +z 重构姿态）
- ✅ 信息面板星系卡片"结构"行扩展：旋涡/棒旋补尘埃带暗纹 + HII 区/年轻星团描述、椭圆标注"无尘埃带/HII 区"；`GALAXY_STRUCTURE_SOURCE_ZH` 追加 RC3（de Vaucouleurs et al. 1991）/S4G（Sheth et al. 2010）。附带修复（目验发现的既有问题登记）：特殊天体卡片"距离"行重复（catalog 自动行与 factsZh 同 label）与 React 同 key 串卡——factsZh 已含"距离"时不再叠加自动行，HudInfo 行 key 加序号前缀

### 10.2 验收标准

- ✅ 飞往 M31：近观可辨倾斜盘面姿态、旋臂间尘埃暗纹、粉色 HII 区点缀、蓝白年轻星团串、偏黄核球（截图 r410-m31-near-front/zoom；M33 站 HII 密度 0.9 粉色发射团最醒目，截图 r410-L4-02），绕行 4 方向 + 推近立体连续（截图 r410-m31-near-orbit90/180/topdown，60 FPS）；对照 R2-8 r28-L4-05 升级幅度登记：单色调白色粒子 → 老年盘底色梯度 + 尘埃暗纹 + HII/星团色彩分层 + M31 真实倾角姿态（哈希姿态 → 77° 登记值）
- ✅ L4 全序列巡游：8 站逐站截图（r410-L4-01～08）近观形态与类型一致——M31/M33 多分量旋涡盘、LMC/SMC 团块云、M87/人马座矮椭球云无 dust/HII、银河系复用既有粒子盘、类星体非星系近观；登记：M32/M110 不在 L4 巡游主序列（R2-5 可选子条目登记，仍可点选/飞往），其椭圆类无 dust/HII 由单测逐星系断言覆盖（9 星系参数表 + 配额为 0）；全程 60 FPS、站间堆 44–48 MB 平稳；m31↔m33 LRU 进出 5 次（容量 1 互相挤出）强制 GC 后堆 46–47 MB 无增长趋势（无泄漏）
- ✅ 现有 `galaxyNearViewR28`（29 例）零修改回归全绿；`detailLayerR42` spec GPU 估算断言等价迁移（基础层粒子 → 配额合计，登记）；新增 `galaxyNearViewR410` 29 例；覆盖率 gate ≥90% 保持（全量 2296 例/125 套件，语句 98.53%）

---

# 第三部分（P1）：标志性天体专属细节

## R4-11 黑洞引力透镜 ①：raymarch 原型（预览页）

### 11.1 需求

- 🔲 新建 `src/components/Scene/volumetric/BlackHoleLensed.tsx` + 纯逻辑 `src/utils/blackHoleLensing.ts`：包围球内全屏面片/球壳 raymarching——
  - 光线弯曲：Schwarzschild 二阶近似（偏转角 α ≈ 4GM/(c²b) 弱场式 + 近光子球增强项，近似公式与适用域登记；**不做全数值测地线积分**）
  - 视界内黑（撞击 r ≤ 1.05 r_s 终止为黑）；光子环（b ≈ 2.6 r_s 附近积累增亮）
  - 背景采样：弯曲后方向采样程序化星场 cubemap（小尺寸 128px/面程序化生成，勿引入贴图资产），呈现背景恒星拖曳成弧
- 🔲 数值稳定：步进上限/提前终止/NaN 防护；log depth 兼容；性能 64 步 60 FPS（包围球屏占比 ≤1/2 时）
- 🔲 预览页注册 `?body=blackhole-test`：滑杆（质量尺度/相机距离/步数）；**交付后人工目检检查点**：光子环成形、背景弧状拖曳可辨，确认后方可启动 R4-12
- 🔲 纯逻辑（偏转角函数/撞击判定/CPU 参考光线追踪 3–5 条样例光线）单测：与 shader 同式系数一致性断言

### 11.2 验收标准

- 🔲 预览页可见清晰光子环 + 背景星弧状弯曲，绕行/推近连续无闪烁（4 距离档截图登记）
- 🔲 相机从远处推入至近光子球距离画面无 NaN 黑块/白闪；60 FPS（自适应允许降档）
- 🔲 偏转角/撞击判定单测；覆盖率 gate ≥90% 保持

## R4-12 黑洞引力透镜 ②：吸积盘物理

### 12.1 需求

- 🔲 raymarch 内加入薄盘相交（盘平面 r ∈ [r_isco≈3r_s, ~12r_s]，几何薄盘，弯曲光线与盘面求交可多次相交——上下缘翻折成像的来源）
- 🔲 盘温度分布 T(r) ∝ r^(−3/4)（Novikov-Thorne 近似，内缘截断登记）→ `blackbodyRGB`（复用 R4-6 `starPhysics`）着色
- 🔲 多普勒束流：盘内开普勒速度场 → 近侧蓝移增亮（δ³ 近似）、远侧红移减暗；引力红移随 r 减小加深（近似式登记）
- 🔲 盘面细节：径向流动噪声条纹（uTime 驱动差速旋转）；亮度与 Bloom 联调不过曝
- 🔲 预览页滑杆：盘倾角/内外缘半径/束流强度；**人工目检检查点**：上下缘翻折 + 左右不对称亮度（Interstellar/EHT 观感）成立后方可启动 R4-13

### 12.2 验收标准

- 🔲 预览页：盘的上缘/下缘翻折像 + 近侧亮远侧暗不对称清晰可辨（正视/斜视/侧视 3 角度截图登记）
- 🔲 温度→颜色/速度→束流因子纯函数单测（与 shader 系数同式断言）；60 FPS（占比 ≤1/2）；覆盖率 gate ≥90% 保持

## R4-13 黑洞引力透镜 ③：场景接入（人马座 A* / 天鹅座 X-1）

### 13.1 需求

- 🔲 `SpecialBodies.tsx` `BlackHole` 组件挂接 `useDetailLayer({ kind:'lensing' })`：跟随/飞往两黑洞且近观距离内激活 `BlackHoleLensed`，与现有廉价 shader（吸积盘+光环）交叉淡出；退出恢复、资源 dispose
- 🔲 两黑洞参数区分：Sgr A*（大质量、盘暗弱偏橙红——实际为射电亮度，艺术化登记）/ 天鹅座 X-1（恒星级、盘亮偏蓝白 + 保留现有伴星联动如有）
- 🔲 尺度处理：视界渲染半径沿用现有 `visualRadiusLy` 压缩比例（真实角尺寸远小于可视化，压缩登记）；背景弯曲采样接入真实场景（方案二选一并登记：场景 cubemap 快照 vs 程序化星场近似——快照成本高可取近似，但须登记差异）
- 🔲 性能：lensing 池容量 1；自适应降级接入（R4-4 档位映射步数）；巡游切换进出 5 次无泄漏

### 13.2 验收标准

- 🔲 L3 巡游至人马座 A* / 天鹅座 X-1：飞抵后平滑过渡到透镜渲染，光子环+盘翻折+束流不对称可辨（对照现状截图登记升级幅度）；Esc 退出恢复远景表现
- 🔲 60 FPS 不跌破 55（允许自适应 mid 档）；进出 5 次 JS 堆/显存回落数值登记
- 🔲 L3 全序列回归无其他站点影响；覆盖率 gate ≥90% 保持

## R4-14 环状星云 M57 壳层体积模型

### 14.1 需求

- 🔲 `nebulaVolume.ts` 新增 M57 密度场：三轴椭球壳层模型（O'Dell et al. 2013 形状参考：内亮环为赤道增密环 + 极向暗淡瓣，参数登记）——内腔近空 + 环壳 OIII 青绿 + 外缘 Hα/NII 红橙渐变 + 外晕弱壳
- 🔲 中心白矮星亮点（复用 R4-6 白矮星色档 sprite）；体积纹理 96³ 即可（结构较简单，预算登记）
- 🔲 主场景接入同 R4-8 模式（`useDetailLayer` volume 池，与现有 billboard/环粒子交叉过渡；R2-7 交付的 +200 环向粒子在体积激活时淡出，登记）
- 🔲 预览页注册 `?body=ring-nebula`；确定性种子；密度场关键点单测（赤道环密度 > 极向、内腔低）

### 14.2 验收标准

- 🔲 近观绕行：从正视"环"到侧视"桶状/椭球壳"的视差变化真实可辨（3 角度截图登记）——这是 billboard 方案不可能呈现的核心升级点
- 🔲 与 M42 巡游连续切换：volume 池 LRU 逐出正常、无双体积同挂、无泄漏；60 FPS 保持
- 🔲 密度场单测 + 回归全绿；覆盖率 gate ≥90% 保持

## R4-15 马头星云吸收体积（暗云 + 背景发射幕）

### 15.1 需求

- 🔲 `nebulaVolume.ts` 新增马头密度场：以**吸收为主**的暗分子云柱（马头轮廓 SDF 近似塑形 + fBm 边缘侵蚀，轮廓参考 Hubble 公版图像，近似度登记），发射通道近零
- 🔲 背景发射幕：暗云后方 IC 434 红色发射背景（大尺度低密度发射层或保留现有背景 billboard 作幕布，方案二选一登记）——暗云剪影效果 = 吸收体积遮挡背景幕
- 🔲 主场景接入同 R4-8 模式；R2-7 交付的 2 视差发射层 + 3 前景暗云团在体积激活时交叉淡出（登记）
- 🔲 预览页注册 `?body=horsehead`；密度场单测（马头轮廓内吸收高/轮廓外低、发射通道近零断言）

### 15.2 验收标准

- 🔲 近观绕行：马头剪影随视角变化呈现真实体积轮廓（正面剪影清晰、侧向可见云柱纵深，3 角度截图登记）
- 🔲 巡游连续切换回归、无泄漏；60 FPS 保持；覆盖率 gate ≥90% 保持

## R4-16 蟹状星云丝状结构 + PWN 环面/喷流

### 16.1 需求

- 🔲 `nebulaVolume.ts` 新增蟹状密度场：外围丝状网络（方向场扭曲的密度脊，Hα 红橙丝 + 内部 OIII 青色弥散，Hubble 形态参考登记）+ 整体椭球包络
- 🔲 PWN（脉冲星风云）内核：Chandra 形态参考的赤道环面（torus）+ 极向双喷流——环面用 shader 环形发射体（蓝白同步辐射色），喷流复用/参数化 `ExtragalacticObjects.tsx` `RelativisticJet` 锥体 shader（缩小尺度，勿新造，复用登记）
- 🔲 与现有 `PulsarRemnant`（:1406）整合：射束扫描/脉冲节奏保留；R2-7 的 +16 丝状云团在体积激活时交叉淡出；脉冲星本体/射束与体积层深度关系正确（renderOrder/深度测试方案登记）
- 🔲 主场景接入同 R4-8 模式；预览页注册 `?body=crab-pulsar`；密度场单测（丝状脊密度 > 弥散区、环面平面增强断言）

### 16.2 验收标准

- 🔲 近观：外围红橙丝状网络 + 内部青色弥散 + 中心蓝白环面/双喷流三层结构可辨，绕行立体（3 角度截图登记）；脉冲节奏不回退
- 🔲 体积 + 环面 + 射束 + Bloom 组合 60 FPS 不跌破 55（自适应允许 mid）；LRU 回归无泄漏；覆盖率 gate ≥90% 保持

## R4-17 昴星团 Gaia 真实成员星 + 反射星云

### 17.1 需求

- 🔲 `OpenCluster`（昴星团分支）改造：消费 `public/data/pleiades.json`（R4-5）真实成员星 3D 位置（pc → 场景单位比例登记）+ B−V → `blackbodyRGB` 颜色 + 视星等 → 粒径/亮度；加载失败降级现状程序化分布（降级登记）
- 🔲 "七姊妹" + Atlas/Pleione 等 9 颗命名亮星：真实相对位置 + 衍射星芒 sprite（复用 `proceduralTextures.ts` 既有星芒）+ 悬停/点选显示星名（复用现有标签机制，实现成本高则仅信息面板列名，二选一登记）
- 🔲 反射星云：围绕 Merope/Maia 等亮星的蓝色反射星云——轻量方案：3–5 个椭球壳低密度蓝色体积（volume 池复用，96³ 单纹理内多壳）或分层 sprite（性能优先二选一并登记，蓝色反射色调区别于发射星云红/青）
- 🔲 近观粒子经 `useDetailLayer({ kind:'starCatalog' })` 挂载（R4-2）；R2-7 的 +320 程序化增量粒子被真实星表替代（登记）；预览页注册 `?body=pleiades`

### 17.2 验收标准

- 🔲 近观形态与真实昴星团可对应（亮星相对构型可辨认，对照公版图像截图登记）；蓝色反射星云包裹观感成立
- 🔲 数据加载失败降级路径实测（临时改名产物文件验证不报错回落现状）；巡游回归无泄漏；60 FPS 保持
- 🔲 数据消费纯函数（单位换算/星等→粒径映射）单测；覆盖率 gate ≥90% 保持

## R4-18 参宿四非对称巨对流胞 + 恒星近观日冕/衍射星芒

### 18.1 需求

- 🔲 `StellarSurface` 参宿四专属增强：低阶球谐（l ≤ 3）扰动叠加基础噪声——2–3 个大尺度不对称对流亮/暗斑，缓慢演化（视觉周期 ~40–90 s 登记；VLTI/Montargès 2021 观感参考）；可选尘埃抛射暗斑事件（实现时定夺并登记，非硬性）
- 🔲 恒星近观通用点缀（全部 6 类恒星）：近观距离内色球边缘辉光环（limb 外薄发射环，色温联动）+ 相机中距衍射星芒 sprite（近观淡出防遮挡表面，距离窗口纯函数 + 单测）
- 🔲 预览页参宿四滑杆：球谐幅度/演化速度；主场景经 `useDetailLayer` 近观激活（星芒/色球环仅近观，远景零开销）

### 18.2 验收标准

- 🔲 预览页参宿四：大尺度不对称斑块可辨且缓慢演化（间隔 30 s 两帧对比截图登记），与其他恒星均匀颗粒观感形成区分
- 🔲 L3 巡游恒星站近观：色球环/星芒出现与淡出平滑；60 FPS 保持；覆盖率 gate ≥90% 保持（距离窗口/球谐幅度纯函数单测）

---

# 第四部分（P2）：长尾完善

## R4-19 M13 球状星团 King 分布 + HR 图颜色

### 19.1 需求

- 🔲 纯逻辑：King (1966) profile 逆变换采样（`m13-profile.json` 参数：核半径/潮汐半径/浓度 c）替代现状均匀分布；恒星颜色按球状星团 HR 图近似分布（主序拐点以下红黄为主 + ~10% 蓝离散星/水平支蓝白，比例登记）→ `blackbodyRGB`
- 🔲 `GlobularCluster`（:2121）与 R2-7 近观 +1,200 粒接入新分布（总预算不变）；确定性种子；R2-9 银晕程序化 29 星团**不在范围**（登记）
- 🔲 预览页注册 `?body=m13`；King 采样/颜色比例纯函数单测（径向密度单调递减、半质量半径断言）

### 19.2 验收标准

- 🔲 近观：中心致密核 + 外围稀疏晕的真实球状星团密度梯度可辨（对照现状截图登记）；红黄主色 + 少量蓝星点缀
- 🔲 巡游回归、60 FPS、覆盖率 gate ≥90% 保持

## R4-20 WR 124 星风抛射壳 + 脉冲星射束体积化

### 20.1 需求

- 🔲 WR 124：现有抛射壳 mesh 升级为小型体积层（64³，团块状抛射泡沫 + 径向速度场膨胀 uTime 驱动，M1-67 星云观感参考登记）；volume 池复用，近观激活
- 🔲 脉冲星射束：`PulsarRemnant` 射束锥升级为轻量体积锥（沿锥轴密度衰减 + 边缘软化 + 扫描旋转保留），与 R4-16 蟹状体积层共存深度正确
- 🔲 两项均经 `useDetailLayer` 门控；预览页注册 `?body=wr-124`；密度塑形纯函数单测

### 20.2 验收标准

- 🔲 WR 124 近观：抛射壳呈团块泡沫状立体膨胀（两帧对比登记）；脉冲星射束体积柔和无硬边锥
- 🔲 与蟹状站点连续巡游 LRU 正常；60 FPS 保持；覆盖率 gate ≥90% 保持

## R4-21 类星体 3C 273 近观升级（吸积盘 + 尘埃环面）

### 21.1 需求

- 🔲 近观细节层：中心吸积盘（复用 R4-12 盘着色逻辑的非透镜简化版——温度分布 + 束流着色，透镜 raymarch 不启用，登记）+ 外围尘埃环面（torus，小型体积或粒子环二选一登记）+ 现有相对论喷流保留联动
- 🔲 光变（现有）保留；BLR 辉光过渡层（盘与环面之间弥散辉光 sprite）
- 🔲 `useDetailLayer` 门控 + 预览页注册 `?body=quasar-3c273`

### 21.2 验收标准

- 🔲 近观：盘（亮蓝白）→ BLR 辉光 → 尘埃环面（暗红棕）→ 喷流四层结构可辨（截图登记）；L4 巡游回归；60 FPS；覆盖率 gate ≥90% 保持

## R4-22 触须星系 N-body 烘焙潮汐尾

### 22.1 需求

- 🔲 `scripts/bake-data/` 新增轻量受限三体/测试粒子模拟脚本（Toomre & Toomre 1972 图景：两质心 + 各 ≤3,000 测试粒子盘，抛物线交会）：烘焙 8–12 个时间快照的粒子位置到 `public/data/antennae.bin`（Float32，总量预算内；模拟参数/近似登记）
- 🔲 `AntennaeGalaxies`（`ExtragalacticObjects.tsx`）近观层：消费烘焙快照——两核 + 双潮汐尾粒子形态，快照间线性插值随 simDays 缓慢演化（时间映射登记）；加载失败降级现状渲染
- 🔲 `useDetailLayer({ kind:'starCatalog' })` 门控；预览页注册 `?body=antennae`；脚本自校验（粒子数/能量单调性宽松断言）+ 加载器单测

### 22.2 验收标准

- 🔲 近观：双核 + 两条弯曲潮汐尾立体可辨且缓慢演化（对照公版图像构型登记）；快照插值无跳变
- 🔲 烘焙产物幂等；降级路径实测；60 FPS；覆盖率 gate ≥90% 保持

## R4-23 透镜星系团屏幕空间引力透镜弧

### 23.1 需求

- 🔲 `LensingArcs`（`ExtragalacticObjects.tsx`）升级：近观时以屏幕空间折射近似呈现引力透镜——方案二选一并登记：a) postprocessing 自定义 Effect（团块质心 SIS 模型偏转屏幕 UV，背景星系像拉伸成弧/爱因斯坦环）；b) 场景内弧形 mesh 升级（更弯曲的参数化弧 + 多重像布局，成本低但非真折射）。**推荐 a**，若与现有 EffectComposer/Bloom 集成风险过高则降级 b 并登记
- 🔲 SIS 偏转角纯函数（θ_E 爱因斯坦半径参数化）+ 单测；效果仅跟随 cluster-lensing 时激活（域判据复用 :409-416 现状）
- 🔲 预览页注册 `?body=cluster-lensing`

### 23.2 验收标准

- 🔲 近观：背景源被拉伸为切向弧/部分爱因斯坦环，弧位置随视角一致（截图登记）；非跟随时零开销
- 🔲 与 Bloom/体积层组合无伪影；60 FPS；覆盖率 gate ≥90% 保持

---

# 收尾

## R4-24 集成回归验收 + 文档回写

### 24.1 任务清单

- 🔲 全量 `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿；覆盖率 gate ≥90% 确认
- 🔲 无头 Chrome 端到端：L3 15 站 + L4 8 站巡游一整圈，逐站近观截图 + FPS + JS 堆登记；连续切换 15 个细节层目标后堆稳定；四类细节层（particles/volume/lensing/starCatalog）LRU 交叉逐出验证
- 🔲 预览页全注册对象过一遍目检（截图归档）；自适应降级强制触发验证
- 🔲 `CHANGELOG.md` `[Unreleased]` 查漏补全全部 R4 条目；`IMPROVEMENT_REQUIREMENTS_4.md` 全部 🔲 回写 ✅/🔶（实现差异逐条登记），文档版本升 1.x；REQUIREMENTS.md 受影响小节同步
- 🔲 性能总账登记：L3/L4 场景粒子峰值、体积纹理常驻显存、`public/data/` 资产总量，逐项对照附录 A 预算确认不超

### 24.2 验收标准

- 🔲 上述全部完成并登记；无既有功能回归（R2/R3 关键验收点抽查：巡游/事件域隔离/卫星钳制/合并演化各 1 项）

---

## 附录 A：全局硬性约束（每个阶段均须遵守）

1. **性能**：60 FPS 目标、任何验收场景不跌破 55（自适应降级允许介入）；单目标近观粒子 ≤12,000、全局粒子峰值增量登记；体积纹理 ≤128³、volume/lensing 池容量各 1、细节层 GPU 估算总预算 ≤64 MB（`DETAIL_GPU_BUDGET_BYTES`）；`public/data/` 总量 ≤5 MB。
2. **确定性**：所有程序化生成用 FNV-1a 种子（`utils/random.ts` 先例），两次进入同一天体形态一致（单测断言）；渲染循环零随机、零逐帧对象分配（Three.js 对象复用）。
3. **纯函数先行**：分布/物理/塑形/门控逻辑一律纯函数入 `utils/` 并单测；组件只消费函数输出；覆盖率 gate ≥90% 保持。
4. **科学与艺术化登记**：物理近似、比例压缩、颜色艺术化一律在代码文件头/信息面板 dataSource 登记来源与差异（AGENTS.md 数据准确性要求）；公开数据引用登记出处（§0.4）。
5. **兼容既有管线**：log depth buffer（自定义 shader 须含 logdepthbuf include，`Starfield.tsx` :33 先例）、选择性 Bloom、R2-7/R2-8 门控语义、R3-1 巡游域、`realScaleMode`——不得破坏；改造迁移须"行为零回退"并保留/迁移既有单测。
6. **资源生命周期**：细节层卸载即 dispose（geometry/material/texture）；连续进出 ≥5 次 JS 堆/显存回落实测登记；运行时零外部网络请求（烘焙产物随仓库提交）。
7. **验证闭环**：每阶段收尾按 PROMPT 文档五步流程执行（测试四件套 → 无头 Chrome 目验截图 → CHANGELOG → 本文档回写 → Git 询问流程）；开发服务器一律 3100 端口（3000 留给用户）。
8. **人工检查点**：R4-3（体积测试体）、R4-7（M42 密度场）、R4-11（光子环）、R4-12（盘翻折）四处标记"人工目检检查点"的阶段，Agent 交付后须等待用户目检确认方可启动其下游阶段。
