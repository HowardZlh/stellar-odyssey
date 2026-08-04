# 开发指南

## 技术栈

| 领域 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js 16 + React 19 | App Router，`src/app/` 入口 |
| 语言 | TypeScript（strict） | 禁用 `any`，函数显式返回类型 |
| 3D | Three.js + React Three Fiber | 对数深度缓冲支撑跨 10+ 量级尺度渲染；raymarch 体积渲染（发射-吸收积分 + 3D 密度纹理 + 蓝噪声抖动 + 半分辨率 RT + 帧率自适应质量档）、黑洞/星系团引力透镜 shader |
| 数据管线 | `scripts/bake-data/`（Node 原生 TS，零新依赖） | Gaia DR3 / SIMBAD / 2MRS / DSS2 影像 → `public/data/` 静态产物（≈2.5 MB，运行时零外部请求；快照随仓库提交保证幂等离线可复现） |
| 状态 | Zustand | 单 store（`src/store/index.ts`），每帧渲染数据走注册表模式不经 React |
| 音频 | Web Audio API | 程序化合成（无音频资源文件），PannerNode 3D 定位 |
| 样式 | Tailwind CSS | 深空主题（`space-*` 色板） |
| 测试 | Jest + React Testing Library | 3,000+ 用例，覆盖率 gate ≥90%（jest 配置强制，CI 拦截） |

## 常用命令

```bash
npm run dev            # 开发服务器（默认 3000 端口，留给用户测试）
npm run dev:3100       # Agent/并行实例专用（3100 端口 + 独立构建目录，与 3000 互不干扰）
npm run build          # 生产构建
npm run start          # 生产服务器
npm test               # 全部单元测试
npm run test:coverage  # 覆盖率报告（gate ≥90%，不达标即失败）
npm run type-check     # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier
npm run bake:data      # 重新烘焙 public/data/ 真实数据产物（幂等；--fetch 系列开关可联网重拉快照）
```

## 目录结构

```
src/
├── app/                # Next.js 入口（layout/page + /dev/preview 预览页路由）
├── components/
│   ├── Scene/          # 场景级组件：Galaxy（银河系）/ Universe（宇宙）/
│   │   │               #   Supernova / StarField / SolarSystem /
│   │   │               #   体积星云层 / 黑洞透镜层 / 星系近观层 / 尘埃盘层 ……
│   │   └── volumetric/ # 体积渲染基建：VolumeMaterial（raymarch 材质）/
│   │                   #   VolumeHalfRes（半分辨率 RT + 合成）/ BlackHoleLensed ……
│   ├── CelestialBody/  # 天体组件：Sun / Planet / Moon / Comet /
│   │                   #   SpecialBodies / SunActivity / SunCutaway ……
│   ├── Camera/         # 相机控制、连续缩放、飞往/跟随运镜
│   ├── UI/             # ControlPanel / HudInfo / InfoPanel / HelpHint /
│   │                   #   事件通知 / ClampedHtmlLabel ……
│   ├── Audio/          # 音效引擎接入
│   └── dev/            # 开发预览工位组件（DevPreviewHarness + 各天体预览场景）
├── data/               # 天体数据集（行星/卫星/彗星/特殊天体/星系/纹理/模型清单）
│                       #   ——数据来源逐项注释登记
├── hooks/              # useKeyboardShortcuts / useCamera / useAudio /
│                       #   useDetailLayer（细节层四池 LRU）/ useGalaxyImageMaps ……
├── utils/              # 纯函数层（本项目的核心可测试逻辑）：
│                       #   physics（开普勒）/ scale（尺度）/ time / cameraFocus /
│                       #   eventScopes / panelScopes / volume（密度场基元）/
│                       #   adaptiveQuality / bakedData（产物加载校验）……
├── types/              # 统一类型定义（ViewLevel 等）
└── store/              # Zustand store + tick 驱动
scripts/bake-data/      # 离线烘焙：昴星团（Gaia DR3）/ 恒星参数（SIMBAD）/
                        #   M13（Harris）/ 2MRS 目录 / DSS2 星系影像图组
public/data/            # 烘焙产物 + meta（source/license/retrievedAt 登记）
```

## 核心架构约定

### 1. 纯函数先行

一切可计算逻辑（物理/尺度/门控/动画曲线）先写成 `src/utils/` 纯函数并配单测，
组件只做接线。shader 内公式需在 utils 提供 **CPU 镜像函数**，单测断言两者常量同源。

### 2. 渲染/解析同源

每帧动态位姿（如银心固定参考系、垂直展开增益）由**单写者写入注册表**
（如 `renderedGalacticFrame()`），渲染组件与相机焦点解析（`cameraFocus.ts`）
消费同一数据源，保证"飞往/跟随落点与所见一致"。

### 3. 作用域注册表

跨切面的域判定收敛为注册表纯函数，禁止在组件里散写条件：

- `utils/eventScopes.ts`——动态事件视角域（触发/通知/按钮可用性、离域丢弃）
- `utils/panelScopes.ts`——控制面板选项可见视角（15 选项 × L1–L4 矩阵）
- `utils/cycleScopes.ts`——四巡游域序列路由

### 4. 渲染循环零分配

`useFrame` 内禁止创建新对象（Vector3 等预分配复用）；粒子系统用顶点着色器推进；
标签直改 DOM transform 不经 React 重渲染。

### 5. 状态更新纪律

- `viewLevel`（离散视角）与 `continuousLevel`（连续层级）分离：滚轮经
  `syncZoomLevel`/`syncCameraDistance` 同步，跟随/飞往期间层级锁定
- 组件订阅 store 尽量选布尔/标量切片，减少重渲染

### 6. 统一细节层机制（R4-2）

重资产近观层（体积星云 / 黑洞透镜 / 星系近观粒子 / 星表点云）一律经
`hooks/useDetailLayer` 挂接：**四资源池**（particles / volume / lensing /
starCatalog）各容量 1，按"跟随 + 距离阈值（滞回）"门控挂载、0.5s 淡入淡出、
LRU 逐出即卸载 dispose；粒子数/GPU 字节预算集中登记（`utils/detailLayer.ts`），
dev 钩子 `window.__detailLayerDebug` 可在无头验收中读取持有者与显存占用。

### 7. 透明层绘制次序注册表

L4 宇宙域透明层 renderOrder 统一登记于 `utils/universeRenderOrder.ts`
（单一事实来源，禁止散落魔数）；新增透明层必须在注册表取值并同步登记序列
（单测锚定递增/唯一，防深度排序键交叉导致的帧间闪烁）。

### 8. 离线烘焙纪律（R4-5）

真实数据一律构建期烘焙进 `public/data/`（运行时零外部网络请求）：脚本内置
"公开接口拉取 + 提交快照"双路径（离线可复现），产物写出前自校验（数值域/
计数/科学性断言，失败退出非零），`npm run bake:data` 幂等（两次运行产物
逐字节一致）；运行时经 `utils/bakedData.ts` 校验加载，失败降级程序化路径。

## 测试要求

- 核心业务逻辑必须有单测；物理计算函数必须完整覆盖
- **覆盖率 gate ≥90%**（jest 配置强制，低于即 CI 失败）
- 新增 utils 纯函数目标覆盖率 100%
- 数据科学性校验也写成单测（如轨道参数区间、纹理清单文件存在性）

## 开发预览工位（/dev/preview）

单天体独立渲染验证页（R4-1），跳过主场景直接挂载目标组件：

```
http://localhost:3100/dev/preview?body=orion-nebula   # 体积星云
http://localhost:3100/dev/preview?body=blackhole-test # 黑洞引力透镜
http://localhost:3100/dev/preview?body=m31            # 影像驱动星系近观（含体积尘埃盘）
http://localhost:3100/dev/preview?body=m87            # M87 环境 + EHT 推近预设
```

条目注册于 `utils/devPreview.ts`（20+ 天体：恒星表面/体积星云/黑洞/星团/
星系/类星体/触须/透镜团/GRB……），每条目 ≤8 个调参滑杆（帧读 getter 直达
uniform 零重建）+ HUD 性能与体积质量档读数（含强制档位滑杆做 A/B 对比）。

## 视觉验证（无头 Chrome）

UI/渲染类改动需无头 Chrome 目验并截图登记：

```bash
# dev 服务器（勿占 3000，用户测试占用；dev:3100 使用独立构建目录可并行）
npm run dev:3100

# 无头 Chrome（macOS）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-angle=metal --window-size=1280,800 \
  --remote-debugging-port=9222 about:blank
```

通过 CDP（`http://127.0.0.1:9222/json`）驱动：`Input.dispatchKeyEvent` 模拟按键
（`1`–`4` 切视角）、`Runtime.evaluate` 断言 DOM、`Page.captureScreenshot` 截图核对；
dev 钩子 `window.__simStore`（Zustand store）与 `window.__detailLayerDebug`
（细节层持有者/显存）可用于脚本化断言。

## 性能预算

| 指标 | 目标 |
|---|---|
| 帧率 | 60 FPS 不跌破（体积渲染帧率自适应降档兜底） |
| 单场景多边形 | ≤100 万 |
| 纹理分辨率 | ≤4096×4096（3D 密度纹理各维 ≤128） |
| 内存 | <1 GB（实测 L4 巡游 GC 后堆 ~50 MB） |
| 细节层显存 | 四池 GPU 估算 ≤64 MB（LRU 释放出账） |
| 烘焙产物 | `public/data/` 总量 ≤15 MB（当前 ≈2.5 MB） |
| 首屏加载 | <5 秒（模型/4K 纹理/烘焙数据近观懒加载） |

## 工作流（AGENTS.md 摘要）

1. 禁止直接提交 `master`；改动前确认分支策略
2. 实现 → 测试 → 性能检查 → 更新 `CHANGELOG.md [Unreleased]` → 提交
3. 用户可见变更必须登记 CHANGELOG（按 新增/修复/改进 归类）
4. 科学准确性优先；艺术化处理必须登记（见 [science-notes.md](science-notes.md)）

## 需求与变更记录

需求文档系列为内部文档（`docs/internal/`，不随仓库公开）。对外的历次变更均记录于：

| 文档 | 内容 |
|---|---|
| `CHANGELOG.md` | 全部变更记录（Keep a Changelog 格式，含各迭代交付内容） |
