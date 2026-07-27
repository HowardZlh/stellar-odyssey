# 开发指南

## 技术栈

| 领域 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js 14 + React 18 | App Router，`src/app/` 入口 |
| 语言 | TypeScript（strict） | 禁用 `any`，函数显式返回类型 |
| 3D | Three.js + React Three Fiber | 对数深度缓冲支撑跨 10+ 量级尺度渲染 |
| 状态 | Zustand | 单 store（`src/store/index.ts`），每帧渲染数据走注册表模式不经 React |
| 音频 | Web Audio API | 程序化合成（无音频资源文件），PannerNode 3D 定位 |
| 样式 | Tailwind CSS | 深空主题（`space-*` 色板） |
| 测试 | Jest + React Testing Library | 覆盖率 gate ≥90% |

## 常用命令

```bash
npm run dev            # 开发服务器（默认 3000 端口）
npm run build          # 生产构建
npm run start          # 生产服务器
npm test               # 全部单元测试
npm run test:coverage  # 覆盖率报告（gate ≥90%，不达标即失败）
npm run type-check     # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier
```

## 目录结构

```
src/
├── app/                # Next.js 入口（layout/page）
├── components/
│   ├── Scene/          # 场景级组件：Galaxy（银河系）/ Universe（宇宙）/
│   │                   #   Supernova / StarField / SolarSystem ……
│   ├── CelestialBody/  # 天体组件：Sun / Planet / Moon / Comet /
│   │                   #   SpecialBodies / SunActivity / SunCutaway ……
│   ├── Camera/         # 相机控制、连续缩放、飞往/跟随运镜
│   ├── UI/             # ControlPanel / HudInfo / InfoPanel / HelpHint /
│   │                   #   事件通知 / ClampedHtmlLabel ……
│   └── Audio/          # 音效引擎接入
├── data/               # 天体数据集（行星/卫星/彗星/特殊天体/星系/纹理/模型清单）
│                       #   ——数据来源逐项注释登记
├── hooks/              # useKeyboardShortcuts / useCamera / useAudio ……
├── utils/              # 纯函数层（本项目的核心可测试逻辑）：
│                       #   physics（开普勒）/ scale（尺度）/ time / cameraFocus /
│                       #   eventScopes / panelScopes / galacticLatitude ……
├── types/              # 统一类型定义（ViewLevel 等）
└── store/              # Zustand store + tick 驱动
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

## 测试要求

- 核心业务逻辑必须有单测；物理计算函数必须完整覆盖
- **覆盖率 gate ≥90%**（jest 配置强制，低于即 CI 失败）
- 新增 utils 纯函数目标覆盖率 100%
- 数据科学性校验也写成单测（如轨道参数区间、纹理清单文件存在性）

## 视觉验证（无头 Chrome）

UI/渲染类改动需无头 Chrome 目验并截图登记：

```bash
# dev 服务器（勿占 3000，用户测试占用）
npm run dev -- -p 3100

# 无头 Chrome（macOS）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-angle=metal --window-size=1280,800 \
  --remote-debugging-port=9222 about:blank
```

通过 CDP（`http://127.0.0.1:9222/json`）驱动：`Input.dispatchKeyEvent` 模拟按键
（`1`–`4` 切视角）、`Runtime.evaluate` 断言 DOM、`Page.captureScreenshot` 截图核对。

## 性能预算

| 指标 | 目标 |
|---|---|
| 帧率 | 60 FPS 不跌破 |
| 单场景多边形 | ≤100 万 |
| 纹理分辨率 | ≤4096×4096 |
| 内存 | <1 GB |
| 首屏加载 | <5 秒（模型/4K 纹理近观懒加载） |

## 工作流（AGENTS.md 摘要）

1. 禁止直接提交 `master`；改动前确认分支策略
2. 实现 → 测试 → 性能检查 → 更新 `CHANGELOG.md [Unreleased]` → 提交
3. 用户可见变更必须登记 CHANGELOG（按 新增/修复/改进 归类）
4. 科学准确性优先；艺术化处理必须登记（见 [science-notes.md](science-notes.md)）

## 需求文档索引

| 文档 | 内容 |
|---|---|
| `REQUIREMENTS.md` | 主需求（P0–P7 迭代，逐项实现状态） |
| `IMPROVEMENT_REQUIREMENTS*.md` | 各批改进迭代（R1–R4）与实现差异登记 |
| `IMPROVEMENT_REQUIREMENTS_SOLAR.md` | 太阳专项迭代（S1–S4） |
| `CHANGELOG.md` | 全部变更记录 |
