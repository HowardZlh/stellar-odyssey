# AGENTS.md

本文件为在此仓库工作的 AI Agent 提供项目级指令。

## 项目概述

星系运动3D动画可视化项目，使用React + Three.js实现多层级天体运动系统，支持多视角切换和空间音效。

## 技术栈

- **前端框架**: React 19 + TypeScript
- **3D引擎**: Three.js + React Three Fiber
- **构建工具**: Next.js 16
- **状态管理**: Zustand
- **音频引擎**: Web Audio API（程序化合成，无音频资源文件）
- **UI框架**: Tailwind CSS
- **国际化**: 自研轻量 i18n（`src/i18n/` zh/en 字典，键集合由 TypeScript 类型强制一致）
- **数据管线**: 离线烘焙脚本（`npm run bake:data`，Gaia DR3/SIMBAD/2MRS/DSS2 → `public/data/` 静态产物）
- **包管理器**: npm

## Git 工作流规则（强制）

1. **禁止直接在 `main`（或 `master`）分支提交代码。** 任何代码改动都不得直接 commit 到主分支。

2. **处理任何改动前，必须先征求用户确认是否需要新建分支。** 在开始修改文件之前，先询问用户：本次改动是否需要新建分支、以及分支名称。未获确认前不得自行创建分支。

3. **禁止自动创建分支。** 不得在未经用户明确同意的情况下执行 `git checkout -b` / `git switch -c` 等创建分支的操作。

4. **改动完成后，提示用户是否需要创建 PR。** 完成修改并提交后，主动询问用户是否需要创建 Pull Request，由用户决定。

5. **禁止自动创建 PR。** 不得在未经用户明确同意的情况下执行 `gh pr create` 或通过其他方式创建 Pull Request。

### 简要流程

```
收到改动需求
  → 询问：是否需要新建分支？分支名？  （等待用户确认）
  → 用户确认后再创建分支并进行改动
  → 完成并提交
  → 询问：是否需要创建 PR？           （等待用户确认）
  → 用户确认后再创建 PR
```

## CHANGELOG 更新规则（强制）

1. **每次实现完需求后，必须更新 `CHANGELOG.md` 的 `[Unreleased]` 区段。** 只要产生了用户可见的变更（新功能、修复、改进、发布流程等），在提交前就要把对应条目补入 `[Unreleased]`。

2. **按类别归类。** 使用 `新增` / `修复` / `改进` / `发布流程` 等小节，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式；每条为一句话，聚焦用户可感知的效果。

3. **不要写入已发布的版本区段。** 未发布变更一律记入 `[Unreleased]`，发布时再由发布流程归档到具体版本号下。

4. **纯内部改动可酌情省略。** 若改动对用户完全不可见（如仅调整注释、测试内部结构），可不记录，但拿不准时优先记录。

## 对外入口与文案同源纪律（强制）

以下对外信息存在多处副本，**修改任意一处必须同步全部同源点**（禁止只改一处）：

| 信息 | 同源点 |
|---|---|
| 商业合作邮箱 `stevenzearo@163.com` | README.md「商业合作」与「开源协议」节 · README.en.md 对应节 · `src/components/UI/ContactBadge.tsx` 的 `CONTACT_EMAIL` |
| 爱发电赞助链接 `https://afdian.com/a/stellar-odyssey` | README.md「赞助支持」节 · README.en.md「Sponsor」节 · `.github/FUNDING.yml` · `ContactBadge.tsx` 的 `SPONSOR_AFDIAN_URL` |
| Ko-fi 链接 `https://ko-fi.com/howardzlh` | README.md「赞助支持」节 · README.en.md「Sponsor」节 · `.github/FUNDING.yml`（`ko_fi` 字段） · `src/data/donationPlatforms.ts` 的 `SPONSOR_KOFI_URL` |
| GitHub Issues 链接 | README 两版 · `ContactBadge.tsx` 的 `CONTACT_GITHUB_ISSUES_URL` |
| 解锁档位价格 周卡 ¥6 / 月卡 ¥15 / 年卡 ¥88（$1/$2.5/$13） | `src/data/unlockPricing.ts`（代码单一事实源：前端档位表/Worker 判定/CLI 共享，改代码只改这一处） · 爱发电商品页（站外，人工同步） · `docs/internal/UNLOCK_OPS.md` §2/§3/§5 · `docs/unlock-guide.md` 与 `docs/en/unlock-guide.md` · README.md 与 README.en.md「支持者解锁」节 |

- **README 双语同步**：`README.md` 的对外内容（章节增删、入口链接、商标声明等）变更时必须同步 `README.en.md`，反之亦然
- **对外文案口径**：商业相关表述一律使用中性口径（"欢迎联系合作"），不写价格、不写内部策略；商标声明（名称与标识不在开源许可范围内）保留在两版 README 的协议节
- **赞助文案红线**：赞助入口保持"零回报承诺"口径，不得添加任何回报/更新义务类表述；捐赠相关的一切对外文案（页面、入口按钮、README、CHANGELOG、docs/）**禁止"捐赠即点亮专属星"类承诺式表述**——对捐赠者的展示（如名单、贡献者宇宙）只能以陈述口径描述既有事实（"这里陈列了每一位支持者"），不得表述为捐赠可换取的回报或权益
- **解锁/赞助双轨口径（U 迭代）**：支持者解锁（对外入口：`/unlock` 页 + 站内锁定提示/控制面板入口 + README「支持者解锁」节 + `docs/unlock-guide.md`）为明码标价对价，允许"付 ¥X 得 Y 天"承诺式表述；赞助保持零回报口径——**两轨文案与入口不得交叉**（禁止"捐赠/赞助即解锁"表述；解锁入口不进 /donate 页、ContactBadge、README 赞助节与 FUNDING.yml，赞助入口不以回报口径出现在解锁页）

## 内部文档（不入库）

- `docs/internal/` **整目录**已在 .gitignore 中（另有 `*_PROMPT.md`、`BUSINESS_*.md` 通配规则兜底），**不随仓库公开、不需要分支流程**：
  - `docs/internal/REQUIREMENTS*.md` / `IMPROVEMENT_REQUIREMENTS*.md`：需求文档系列（仅本地保留，实现后照常回写状态）
  - `docs/internal/*_PROMPT.md`：各迭代 Agent 实现提示词
  - `docs/internal/BUSINESS_ROADMAP_B2B.md`：商业化路线（个人开发者版），完成商业相关任务后更新其勾选状态与实现差异登记
  - `docs/internal/BUSINESS_LEADS.md`：询单/赞助/约稿登记表
- 内部策略、报价、线索信息**严禁**写入任何会入库的文件（代码注释、CHANGELOG、docs/ 公开文档）
- 公开文档（README、docs/）**不得链接** `docs/internal/` 下的文件（仓库中不存在，会成死链）

## 代码规范

### TypeScript 规范
- 使用严格模式：`"strict": true`
- 所有函数必须有明确的返回类型
- 避免使用 `any` 类型，优先使用 `unknown` 或具体类型
- 接口和类型定义放在 `src/types/` 目录

### React 规范
- 使用函数组件和 Hooks
- 组件命名使用 PascalCase
- 文件命名使用 PascalCase（组件）或 camelCase（工具函数）
- 避免过度嵌套组件，适当拆分
- 使用 React.memo 优化性能关键组件

### Three.js 规范
- 所有3D对象必须正确清理内存
- 使用 InstancedMesh 优化大量相同对象
- 纹理加载使用 TextureLoader
- 场景图层次结构要清晰
- 避免在渲染循环中创建新对象

### i18n 规范
- 面向用户的 UI 文案一律入字典（`src/i18n/zh.ts` + `en.ts`），消费侧经 `useT()` / `t(locale, key)` 查找；zh 为类型源，en 缺键/多键均编译报错
- emoji 由组件层持有，不入字典
- 3D 场景组件不直接订阅 locale（防语言切换重建场景）：标签走叶组件（`Scene/LocalizedLabelText.tsx`）或帧循环 `getState().locale`
- 数据来源署名（`dataSource` / `*_ZH` 常量族）保持原文的豁免项见 zh.ts 文件头登记

### 代码组织
- 按功能模块组织代码
- 每个模块包含：类型定义、数据、逻辑、组件
- 共享工具函数放在 `src/utils/`
- 自定义 Hooks 放在 `src/hooks/`

## 测试要求

### 单元测试
- 核心业务逻辑必须有单元测试
- 使用 Jest + React Testing Library
- 测试覆盖率 gate：**≥90%**（语句/分支/函数/行，CI 强制，低于即失败）
- 物理计算函数必须有完整测试
- 提交前必跑四件套：`npm test` / `npm run type-check` / `npm run lint` / （涉及构建路径时）`npm run build`
- **纯文档改动豁免四件套**：改动仅涉及 Markdown 文档（README、CHANGELOG、docs/、AGENTS.md 等）、不触碰任何代码/配置/数据文件时，提交前无需跑四件套。注意：`.ts/.tsx/.json/.mjs` 等被构建或测试消费的文件不属于纯文档，照常必跑

### 集成测试
- 关键用户交互流程需要集成测试
- 视角切换流程需要测试
- 音效切换需要测试

### 性能测试
- 3D渲染性能必须监控
- 帧率低于 60 FPS 需要优化
- 内存泄漏检测

## 性能优化要求

### 3D渲染优化
- 控制多边形数量，单场景不超过100万
- 纹理分辨率最大 4096×4096
- 使用 LOD（细节层次）系统
- 启用 frustum culling
- 合理使用光照和阴影

### 内存管理
- 及时释放不再使用的3D对象
- 纹理资源预加载和缓存
- 避免内存泄漏
- 监控内存占用，目标 < 1GB

### 加载优化
- 资源按优先级加载
- 使用懒加载非关键资源
- 显示加载进度
- 目标加载时间 < 5秒

## 数据准确性要求

### 天体参数
- 所有天体物理参数必须基于真实科学数据
- 轨道计算使用开普勒定律
- 比例尺要合理，兼顾科学性和可视化效果
- 数据来源要有注释说明

### 视觉表现
- 纹理要真实可信
- 颜色要符合实际观测
- 避免过度艺术化处理
- 保持科学教育和可视化平衡

## 音效规范

### 音频文件
- 使用无版权音频资源
- 音频格式：OGG 或 MP3
- 单个文件不超过 50MB
- 音频质量：128kbps 或更高

### 音效实现
- 使用 Web Audio API 实现3D空间音效
- 音效过渡要平滑（1-3秒）
- 音量可用户调节
- 支持静音模式

## 用户界面规范

### UI设计
- 界面简洁直观
- 使用科幻风格设计
- 支持深色模式
- 响应式设计，适配不同屏幕

### 移动端兼容（强制）

**所有面向用户的页面与功能必须兼容手机端**（基准视口 ≥375px 宽，无横向溢出）。新增/修改任何 UI 时逐条对照：

1. **判定体系统一**：布局分流一律用既有判据——`utils/deviceCapability.ts`（`pointer: coarse` = isTouch、`max-width: 767px` = isCompact）+ `hooks/useViewportKind.ts` / store `isCompact`。**禁止 UA 嗅探、禁止自建断点判据**
2. **优先纯 CSS 断点**：能用 `max-md:` / `max-sm:` 变体解决的布局差异不引入 JS 分流（断点口径与 isCompact 的 767px 一致）；需要结构性分流（如表格转堆叠卡片、桌面侧栏转底部抽屉）才用 `isCompact`
3. **触控目标 ≥44pt**：可点元素移动端最小 `min-h-11`（44px）/ 图标钮 `h-11 w-11`（惯用 `max-md:min-h-11 max-md:px-4 max-md:py-3` 追加放大，桌面样式不变）；滑杆 thumb 已由 `globals.css` 全局放大，勿覆盖
4. **safe-area 避让**：贴边固定元素必须避让刘海/圆角/Home 条——简单场景用 `pb-safe-b` 等简写类（tailwind.config 已注册四向），叠加偏移用 `calc(env(safe-area-inset-*) + …)` 任意值类；独立页面复用统一滚动骨架（donate/lab/unlock/contributors 同款 `fixed inset-0 overflow-y-auto + safe-area padding`）
5. **场景内浮层面板**：桌面侧栏在 `<sm` 转底部抽屉（标题栏常显 + ▾/▴ 开合钮 + `aria-expanded`，默认收起防遮挡场景），参照 `Lab/LabControlPanel.tsx` / `Lab/ObservatoryHarness.tsx` 范式；主应用走 `mobilePanel` 单值互斥 + BottomTabBar
6. **3D 场景触控**：必须支持单指旋转/双指捏合缩放（OrbitControls 原生或自定义手势，自定义捏合参照 `MeteorShowerLab` 的 `touchPinchScale`；`touchmove` 需 `passive: false`）
7. **测试范式**：移动端分流逻辑需有测试——组件订阅 store 的用 `useSimulationStore.setState({ isCompact: true })` 直写（`MobileLayoutM3.test.tsx` 先例）；页面消费 hook 的用 `jest.mock('@/hooks/useViewportKind')` 注入（`unlock.test.tsx` 先例）
8. **验收口径**：375–430px 宽无横向溢出、可交互元素可触达、贴边元素不被系统 UI 遮挡；涉及解锁/门控的锁定提示与引导链路在移动端必须完整可用

### 交互设计
- 操作响应时间 < 100ms
- 提供清晰的操作反馈
- 支持键盘快捷键
- 提供帮助信息

## 开发工作流

### 新功能开发
1. 更新 todo_write 任务列表
2. 创建/切换到功能分支
3. 实现功能代码
4. 编写测试
5. 运行测试确保通过
6. 性能检查
7. 更新 CHANGELOG.md
8. 提交代码
9. 询问是否创建 PR

### Bug 修复
1. 分析和定位问题
2. 编写复现测试
3. 修复问题
4. 验证修复效果
5. 更新 CHANGELOG.md
6. 提交代码

### 代码审查要点
- 代码规范性
- 性能影响
- 测试覆盖
- 数据准确性
- 用户体验

## 项目结构

```
src/
├── components/          # React 组件
│   ├── Scene/          # 3D 场景（银河系/宇宙/超新星/体积星云/引力透镜/星场……）
│   │   └── volumetric/ # 体积渲染基建（raymarch 材质/半分辨率 RT/黑洞透镜）
│   ├── CelestialBody/  # 天体（太阳/行星/卫星/彗星/特殊天体……）
│   ├── Camera/         # 相机控制与运镜
│   ├── UI/             # 控制面板/HUD/信息面板/通知/商业合作角标
│   ├── Audio/          # 空间音效
│   └── dev/            # 开发预览工位（/dev/preview 独立天体调参验证页）
├── data/               # 天体数据（NASA JPL/SIMBAD 等来源逐项登记）
├── hooks/              # 自定义 Hooks（快捷键/相机/音效/细节层/烘焙数据加载）
├── utils/              # 纯函数逻辑（物理计算/尺度管理/事件域……单测覆盖）
├── i18n/               # 中英双语字典与语言解析
├── types/              # TypeScript 类型定义
└── store/              # Zustand 全局状态
scripts/bake-data/      # 离线数据烘焙（Gaia/SIMBAD/2MRS/DSS2 → public/data/）
public/data/            # 烘焙产物（真实星表/影像图组/巡天目录，随仓库提交）
docs/                   # 用户教程（中文 + docs/en/ 英文版）
docs/internal/          # 内部文档（需求/提示词/商业文档，整目录不入库，仅本地保留）
```

## 常用命令
注意运行项目时，不要占用3000端口，使用3100端口，用户会执行npm run dev进行测试验证占用3000
### 开发
```bash
npm run dev          # 启动开发服务器（端口 3000，留给用户）
npm run dev:3100     # Agent 专用：端口 3100，独立 distDir，可与 3000 并行
npm run dev:3200     # 备用：端口 3200，独立 distDir
npm run build        # 构建生产版本
npm run start        # 启动生产服务器
```

> Next.js 在 `<distDir>/dev/lock` 上加了互斥锁，同一 distDir 只允许一个 dev server 运行，
> 仅用 `next dev -p 3100` 换端口会被拒绝启动。必须用 `dev:3100` / `dev:3200`，
> 它们通过 `NEXT_DIST_DIR` 分配了独立构建目录。该变量只在 dev 阶段生效，
> 不要在 `npm run build` 时设置——会改变静态导出产物路径并破坏部署。

### 测试
```bash
npm test             # 运行测试
npm run test:coverage # 测试覆盖率
```

### 代码质量
```bash
npm run lint         # ESLint检查
npm run format       # Prettier格式化
npm run type-check   # TypeScript类型检查
```

## 注意事项

1. **科学准确性优先**：在可视化和科学准确性之间，优先保证科学准确性
2. **性能为王**：3D应用的性能直接影响用户体验，要时刻关注性能指标
3. **渐进增强**：核心功能优先，特效和优化后续迭代
4. **用户友好**：操作要简单直观，避免复杂的学习成本
5. **资源管理**：3D资源文件较大，要注意加载速度和内存占用

## 外部资源

- Three.js文档: https://threejs.org/docs/
- React Three Fiber文档: https://docs.pmnd.rs/react-three-fiber
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- 开普勒定律: https://en.wikipedia.org/wiki/Kepler%27s_laws_of_planetary_motion
