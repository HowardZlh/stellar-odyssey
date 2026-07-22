# AGENTS.md

本文件为在此仓库工作的 AI Agent 提供项目级指令。

## 项目概述

星系运动3D动画可视化项目，使用React + Three.js实现多层级天体运动系统，支持多视角切换和空间音效。

## 技术栈

- **前端框架**: React 18 + TypeScript
- **3D引擎**: Three.js + React Three Fiber
- **构建工具**: Next.js 14
- **状态管理**: Zustand
- **动画系统**: React Spring + GSAP
- **音频引擎**: Web Audio API + Howler.js
- **UI框架**: Tailwind CSS
- **包管理器**: npm

## Git 工作流规则（强制）

1. **禁止直接在 `master` 分支提交代码。** 任何代码改动都不得直接 commit 到 `master`。

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

### 代码组织
- 按功能模块组织代码
- 每个模块包含：类型定义、数据、逻辑、组件
- 共享工具函数放在 `src/utils/`
- 自定义 Hooks 放在 `src/hooks/`

## 测试要求

### 单元测试
- 核心业务逻辑必须有单元测试
- 使用 Jest + React Testing Library
- 测试覆盖率目标：80%+
- 物理计算函数必须有完整测试

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
├── components/          # React组件
│   ├── Scene/          # 3D场景组件
│   ├── CelestialBody/  # 天体组件
│   ├── Camera/         # 相机控制
│   ├── UI/             # 用户界面
│   └── Audio/          # 音效组件
├── data/               # 数据文件
│   ├── planets.ts      # 行星数据
│   ├── galaxies.ts     # 星系数据
│   └── sounds.ts       # 音效数据
├── hooks/              # 自定义Hooks
│   ├── useCamera.ts    # 相机控制
│   ├── useAudio.ts     # 音效控制
│   └── useScene.ts     # 场景控制
├── utils/              # 工具函数
│   ├── physics.ts      # 物理计算
│   └── animation.ts    # 动画工具
├── types/              # 类型定义
│   └── index.ts        # 统一导出
└── store/              # 状态管理
    └── index.ts        # Zustand store
```

## 常用命令

### 开发
```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm run start        # 启动生产服务器
```

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
