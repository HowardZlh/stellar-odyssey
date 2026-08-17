# 🌌 星海奥德赛 Stellar Odyssey

**中文** | [English](./README.en.md)

> **从行星表面到宇宙尽头的一次滚轮之旅。**
> 一个基于 React + Three.js 的多层级天体运动 3D 可视化系统：真实开普勒轨道驱动的太阳系、
> 体积渲染的发射星云与引力透镜黑洞、公版天文影像驱动的星系近观、43,000+ 真实星系构成的
> 宇宙大尺度背景——四个层级由滚轮连续缩放无缝贯通，配以随尺度渐变的空间音效，
> 是一场科学数据驱动的沉浸式宇宙遨游。界面与科普说明**中英双语**即时切换。

<p align="center">
  <a href="https://stellar.guushu.com"><strong>🚀 立即在线体验 → stellar.guushu.com</strong></a>
</p>

[![live](https://img.shields.io/badge/在线体验-stellar.guushu.com-4d9fff)](https://stellar.guushu.com) [![CI](https://github.com/HowardZlh/stellar-odyssey/actions/workflows/pr-gate.yml/badge.svg)](https://github.com/HowardZlh/stellar-odyssey/actions/workflows/pr-gate.yml) ![tech](https://img.shields.io/badge/Next.js-16-black) ![tech](https://img.shields.io/badge/React-19-61dafb) ![tech](https://img.shields.io/badge/Three.js-R3F-049ef4) ![tech](https://img.shields.io/badge/TypeScript-strict-3178c6) ![coverage](https://img.shields.io/badge/coverage-%E2%89%A590%25-brightgreen) ![license](https://img.shields.io/badge/license-AGPL--3.0-blue)

**目录**：[效果演示](#-效果演示) · [亮点特性](#-亮点特性) · [快速开始](#-快速开始) · [文档与教程](#-文档与教程) · [技术栈](#-技术栈) · [科学性承诺](#-科学性承诺) · [参与贡献](#-参与贡献) · [支持者解锁](#-支持者解锁) · [赞助支持](#-赞助支持) · [商业合作](#-商业合作) · [开源协议](#️-开源协议)

---

## 🎬 效果演示

**四层级连续缩放遨游**：滚轮从地球近观一路拉远，穿越太阳系、银河系，直抵可观测宇宙边界——

![四层级连续缩放遨游](docs/media/zoom-journey.webp)

> 🎬 [观看 60fps 高清视频（1280px MP4，7.6 MB）](https://github.com/HowardZlh/stellar-odyssey/releases/download/v0.1.2/zoom-journey-60fps.mp4)

**太阳活动事件链**：触发太阳耀斑 → 飞往近观米粒组织与黑子 → 日冕物质抛射（CME）朝地球扑来——

![太阳耀斑与 CME 事件演示](docs/media/solar-events.webp)

> 🎬 [观看 60fps 高清视频（1280px MP4，9.3 MB）](https://github.com/HowardZlh/stellar-odyssey/releases/download/v0.1.2/solar-events-60fps.mp4)

**银河系—仙女座碰撞合并快进预览**：十几秒穿越 45 亿年，见证两大星系首次穿越、潮汐扭曲直至合并——

![银河系—仙女座碰撞合并预览](docs/media/galaxy-merger.webp)

> 🎬 [观看 60fps 高清视频（1280px MP4，10 MB）](https://github.com/HowardZlh/stellar-odyssey/releases/download/v0.1.2/galaxy-merger-60fps.mp4)

| 人马座 A* 引力透镜光子环 | 体积渲染的猎户座星云 | 仙女座星系近观（DSS2 影像驱动） |
|---|---|---|
| ![人马座 A* 光子环](docs/media/shot-sgr-a-photon-ring.jpg) | ![猎户座星云体积渲染](docs/media/shot-orion-nebula-volume.jpg) | ![M31 近观粒子云](docs/media/shot-m31-close-up.jpg) |

> 以上只是三条主线。**推近人马座 A\* 看引力透镜光子环、钻进体积渲染的猎户座星云、
> 飞抵由真实巡天影像驱动的仙女座星系、在 43,000+ 真实星系点云中环视宇宙网**——
> 更多新看点见下方亮点特性，或[直接开玩](https://stellar.guushu.com)。

---

## ✨ 亮点特性

### 🔭 四层级连续缩放遨游
- **行星视角 → 太阳系视角 → 银河系视角 → 宇宙视角**，按 `1`–`4` 一键切换，或用**滚轮从行星表面一路拉远到可观测宇宙边界**（半径约 465 亿光年），无需任何点击切换
- 缩放过程中内容 LOD 淡入淡出、时间压缩比对数插值、背景色与音景实时混合，HUD 显示当前尺度标尺（AU / 光年 / Mpc 自动切换）

### 🪐 真实物理驱动的太阳系
- 八大行星完整**开普勒轨道六要素**（NASA JPL 数据），求解开普勒方程满足匀面速度定律；初始相位基于 J2000 历元——**打开应用时行星位置与真实当前日期一致**
- 金星逆向自转、天王星 97.8° 侧躺、哈雷彗星 162° 逆行高离心率轨道近日点疾驰、小行星带/柯伊伯带每粒子独立开普勒剪切
- 20+ 卫星：月球潮汐锁定、伽利略四卫星 1:2:4 共振、ISS/哈勃/天宫 glTF 精细模型近观

### ☀️ 太阳活动系统
- 近观可见**米粒组织、黑子（11 年周期蝴蝶图纬度迁移）、日珥、光斑**；较差自转（赤道 25.4 天 / 极区 34 天）
- **耀斑与 CME（日冕物质抛射）**事件链：泊松自动触发 + 手动演示，CME 抵达地球触发极光增强
- **太阳内部剖面**：1/4 切除视图，核心/辐射区/对流区可点选科普

### 🌀 银河系与深空
- 3D 棒旋结构（4.3 万粒子银盘 + 密度波旋臂 + 尘埃带 + 银晕 + **HI 翘曲盘**），太阳系沿波浪轨道绕银心公转（银河年约 2.3 亿年，"You are here" 标记）
- 20+ 特殊天体基于真实原型逐一近观：人马座 A* 黑洞、蟹状脉冲星灯塔扫束、天狼星双星互绕、猎户座星云、昴星团、马头星云、类星体 3C 273……
- **超新星爆炸**四阶段动画（Sedov-Taylor 冲击波扩张 → 遗迹归档）；**垂直展开模式**（`V`）将整个银盘 morph 为椭球体观察真实银纬分布

### 🕳 体积渲染星云与引力透镜黑洞
- **raymarch 体积星云**（发射-吸收积分 + 3D 密度纹理 + 蓝噪声抖动）：猎户座 M42 扇贝状发射腔与四边形星团空腔、环状星云 M57 壳层、马头星云吸收暗云剪影、蟹状星云丝状遗迹 + 脉冲星风云环面/极向喷流、WR 124 星风抛射壳
- **黑洞引力透镜近观**：飞抵人马座 A* / 天鹅座 X-1 推近可见**光子环、背景星场弯曲、吸积盘温度黑体色 + 多普勒束流增亮 + 引力红移**；跟随 M87 推近还原 **EHT 2019 首张黑洞照片的近正视光子环**
- **恒星表面物理化**：Planck 黑体谱定色温（参宿四橙红 → 参宿七蓝白）、光谱型临边昏暗、时变对流米粒（巨星颗粒大而慢、矮星细密）、参宿四非对称巨对流胞与衍射星芒
- **帧率自适应质量档**：体积渲染按滑动窗 FPS 自动升降步数与渲染分辨率（半分辨率 RT 动态视口），低端设备平滑降档不跌帧

### 🎞 真实天文数据驱动的星系（离线烘焙管线）
- **公版影像驱动近观**：M31/M33/大小麦哲伦云由 DSS2 彩色巡天影像烘焙为密度/颜色/尘埃图组——近观粒子云的旋臂走向、尘埃暗带、恒星形成区与真实照片逐一对应（M31 按 77° 倾角反投影回盘面）
- **体积尘埃盘视线消光**：斜视/侧视 M31 时近侧尘埃带**真实遮挡**后方星光与核球辉光，消光随倾角物理增强
- **2MRS 真实巡天背景**：43,488 个真实星系的三维点云（2MASS 红移巡天，Huchra et al. 2012）——室女座团聚集、银道遮挡带、宇宙网纤维走向均为真实数据，全目录仅 2 次 draw call
- **昴星团 Gaia DR3 真实成员星**（600 颗，视差+自行共动选星）+ M13 球状星团 King 分布与 HR 图颜色
- 更多真实原型细节：M87 星系团环境（2,000 球状星团 + HST-1 类喷流节点 + 室女座团成员点缀）、LMC 30 Doradus 蜘蛛星云与中央棒、触须星系 N-body 潮汐尾、Abell 370 型引力透镜弧、GRB 221009A 相对论喷流与余辉膨胀壳、银河系**费米气泡**双极辉光

### 🌠 宇宙尺度演化
- 本星系群 → 室女座星系团 → 拉尼亚凯亚超星系团 → 宇宙网大尺度结构（真实 2MRS 点云 + 程序化纤维氛围层）
- **银河系—仙女座碰撞合并快进预览**：12 秒穿越 45 亿年，完整呈现首次穿越 → 潮汐扭曲 → 星暴 → 终态椭圆星系 Milkomeda
- 哈勃膨胀示意、麦哲伦星流、人马座潮汐流、可观测宇宙边界

### 🖥 展馆模式与深链启动
- **展馆模式**：控制面板一键启动或 `?mode=kiosk` 链接直入——全屏自动巡游逐站运镜，观众任意触碰即暂停并显示界面，片刻无操作自动恢复巡游；`tour=all` 四域由内向外轮转（行星系统 → 太阳系 → 银河系 → 宇宙），每站停留时长可调
- **深链直达**：`?body=jupiter` 分享链接开屏即飞往任意天体；天体观察站单天体页路径直达 `/lab/observatory/<天体id>`；`?lang=en` 英文界面启动；`?logo=` 注入合作方标识（仅 https，展馆冠名场景 UI 隐藏时仍保留）——参数可自由组合，详见 [docs/launch-params.md](docs/launch-params.md)
- `H` 键一键隐藏全部界面，纯净画面用于截图、录屏与投屏

### 🎧 沉浸式体验
- **Web Audio 程序化合成空间音效**：四层级音景随缩放等功率交叉混合，太阳轰鸣与黑洞嗡鸣 3D 定位（真空无声，音效为艺术化设计并已登记）
- 任意天体**点选 → 飞往 → 跟随**（2.5 秒平滑运镜），`[` / `]` 按视角域巡游序列逐个打卡（L1 行星系统 / L2 十五天体 / L3 十四站深空 / L4 八站星系）
- **中英双语**：界面、3D 天体标签与科普说明随控制面板 zh/EN 开关即时切换（或 `?lang=en` 启动）
- **真实比例模式**（`R`）：如实呈现"真实比例下行星几乎不可见"的尺度事实
- 控制面板选项按视角作用域智能显隐，Bloom 泛光后处理，60 FPS 满帧目标

---

## 🚀 快速开始

**在线体验**：直接访问 [stellar.guushu.com](https://stellar.guushu.com)，无需安装。

**本地运行**：

```bash
# 安装依赖
npm install

# 启动开发服务器（http://localhost:3000）
npm run dev

# 生产构建与启动
npm run build
npm run start
```

打开浏览器后：**滚轮缩放**体验连续遨游，按 `1`–`4` 切换四大视角，**点击任意天体**查看信息并飞往观察。完整操作见 [docs/getting-started.md](docs/getting-started.md)。

> 建议使用支持 WebGL 2 的现代浏览器（Chrome / Edge / Firefox / Safari）。
> 手机/平板**已全站适配**：单指拖动旋转、双指捏合缩放、点按选中天体；小屏界面自动切换为移动布局（底部标签栏 + 抽屉面板），渲染质量按设备能力自动降档。移动端操作详见 [docs/controls.md](docs/controls.md) 的「触屏操作」一节。

## 📖 文档与教程

| 文档 | 内容 |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | 快速上手：安装运行、第一次遨游的推荐路线 |
| [docs/view-guide.md](docs/view-guide.md) | 四视角导览：每个层级能看什么、怎么玩 |
| [docs/controls.md](docs/controls.md) | 交互与快捷键完整参考、控制面板选项说明 |
| [docs/launch-params.md](docs/launch-params.md) | 启动 URL 参数：深链直达、展馆模式部署、logo/语言注入 |
| [docs/events-guide.md](docs/events-guide.md) | 动态事件演示：耀斑 / CME / 超新星 / 星系合并预览 |
| [docs/meteor-shower-lab.md](docs/meteor-shower-lab.md) | 天文实验室：盛夏双重流星雨观测指南（英仙座 / 天鹅座κ / 1966 狮子座暴） |
| [docs/science-notes.md](docs/science-notes.md) | 科学性说明：真实数据来源与艺术化处理登记 |
| [docs/unlock-guide.md](docs/unlock-guide.md) | 支持者解锁：档位价格、三通道兑换步骤、token 使用与常见问题 |
| [docs/how-it-works.md](docs/how-it-works.md) | 技术揭秘：跨 10+ 量级尺度渲染、体积渲染、引力透镜、离线烘焙管线 |
| [docs/attribution.md](docs/attribution.md) | 素材许可与数据来源完整登记 |
| [docs/development.md](docs/development.md) | 开发指南：架构、测试、代码规范 |

> English versions of all guides are available under [docs/en/](docs/en/).

## 🛠 技术栈

| 领域 | 技术 |
|---|---|
| 框架 | Next.js 16 · React 19 · TypeScript（strict） |
| 3D 渲染 | Three.js · React Three Fiber · 自定义 GLSL shader（对数深度缓冲跨尺度渲染 · raymarch 体积渲染 · 引力透镜 · 半分辨率 RT + 帧率自适应质量档） |
| 数据管线 | 离线烘焙脚本（`npm run bake:data`，零新依赖）：Gaia DR3 / SIMBAD / 2MRS / DSS2 影像 → `public/data/` 静态产物（约 2.5 MB，运行时零外部请求） |
| 状态管理 | Zustand |
| 音频 | Web Audio API（程序化合成 + PannerNode 3D 定位，无音频资源文件） |
| UI | Tailwind CSS |
| 测试 | Jest + React Testing Library（3,000+ 用例，覆盖率 gate ≥90%，CI 强制） |

实现细节的通俗版解读见 [docs/how-it-works.md](docs/how-it-works.md)。

## 📂 项目结构

```
src/
├── components/          # React 组件
│   ├── Scene/          # 3D 场景（银河系/宇宙/超新星/体积星云/引力透镜/星场……）
│   │   └── volumetric/ # 体积渲染基建（raymarch 材质/半分辨率 RT/黑洞透镜）
│   ├── CelestialBody/  # 天体（太阳/行星/卫星/彗星/特殊天体……）
│   ├── Camera/         # 相机控制与运镜
│   ├── UI/             # 控制面板/HUD/信息面板/通知
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
```

## 🧪 开发命令

```bash
npm test               # 运行全部单元测试
npm run test:coverage  # 测试覆盖率（gate ≥90%）
npm run type-check     # TypeScript 类型检查
npm run lint           # ESLint 检查
npm run format         # Prettier 格式化
npm run bake:data      # 重新烘焙真实数据产物（幂等；产物已提交，日常无需运行）
```

开发预览工位：`/dev/preview?body=orion-nebula`（体积星云/黑洞透镜/星系近观等 20+ 条目独立渲染 + 调参滑杆 + 质量档 HUD），完整说明见 [docs/development.md](docs/development.md)。

## 🔬 科学性承诺

所有天体物理参数基于真实科学数据（NASA JPL、SIMBAD、NED、USGS Astrogeology 等，数据来源在代码与信息面板中逐项登记）；轨道计算使用开普勒定律；**所有艺术化处理（尺寸夸大、时间压缩、音效设计等）均在应用内说明与代码注释中明确登记**。详见 [docs/science-notes.md](docs/science-notes.md)。

## 素材许可（Attribution）

所有纹理、3D 模型与天文数据均来自公有领域或开放许可来源：NASA（JPL / New Horizons / Dawn / 3D Resources / SVS）、USGS Astrogeology、ESA Gaia DR3、2MASS 红移巡天、DSS2 彩色巡天、SIMBAD，以及 [Solar System Scope Textures](https://www.solarsystemscope.com/textures/)（CC BY 4.0）。星表与影像经离线烘焙为派生产物随仓库提交，来源/许可/检索语句登记于各产物 meta 与 `scripts/bake-data/`。

**逐项素材来源、许可与登记说明见 [docs/attribution.md](docs/attribution.md)。**

## 📄 变更记录

- 变更记录：[CHANGELOG.md](CHANGELOG.md)（Keep a Changelog 格式）

## 🤝 参与贡献

欢迎 issue 与 PR！请先阅读 [贡献指南](CONTRIBUTING.md)——代码贡献需签署 [CLA](CLA.md)（许可授予型，你保留自己贡献的版权），以维持本项目 AGPL-3.0 + 商业授权的双许可模式。

## 🔓 支持者解锁

部分高级内容（近观细节层 / 银河系与宇宙视角巡游序列 / 事件演示不限次 / 天文实验室「天体观察站」不限次）为**支持者限时解锁**，免费体验保持完整（L1/L2 全部功能与全部远观科普不受影响，观察站每日有免费观察额度）。档位：**周卡 ¥6 / 月卡 ¥15 / 年卡 ¥88**（Ko-fi 参考价 $1 / $2.5 / $13）。

支持渠道（按推荐顺序）：**支付宝扫码**（推荐，支付后自动发码、即时解锁）→ 微信赞赏码（人工核验，token 经 Email 发送）→ 爱发电（备选，订单号自动兑换）→ Ko-fi（海外备选）。购买与兑换见 [stellar.guushu.com/unlock](https://stellar.guushu.com/unlock)，详细说明见 [docs/unlock-guide.md](docs/unlock-guide.md)。支持者昵称与留言（均可选）将记入捐赠名单与[贡献者宇宙](https://stellar.guushu.com/contributors)。

## 💖 赞助支持

如果这个宇宙曾让你停下滚轮多看了一会儿，欢迎支持项目——支持即可解锁高级内容（见上节「支持者解锁」），昵称与留言可记入贡献者名单：

- 🔓 解锁页（推荐入口：支付宝扫码，支付后自动发码即时解锁）：[stellar.guushu.com/unlock](https://stellar.guushu.com/unlock)
- ⚡ 爱发电（备选，订单号自动兑换）：[afdian.com/a/stellar-odyssey](https://afdian.com/a/stellar-odyssey)
- ☕ Ko-fi（海外备选）：[ko-fi.com/howardzlh](https://ko-fi.com/howardzlh)
- ☄️ 站内捐赠页（汇总全部支持通道与捐赠名单）：[stellar.guushu.com/donate](https://stellar.guushu.com/donate)
- ✨ 贡献者宇宙（支持者名单的 3D 星空陈列页——每颗星对应一位已登记的支持者，大小与亮度随累计金额呈现）：[stellar.guushu.com/contributors](https://stellar.guushu.com/contributors)

项目的全部源代码对所有人平等开放。你的支持将用于持续开发与域名维护，让它保持**免费、无广告、开源**。

## 💼 商业合作

欢迎教育机构、科技馆与展陈集成商联系合作。合作方向示例：展馆大屏部署、定制开发、课程内容。

**展馆部署开箱即用**：全屏自动巡游 + 空闲自动恢复 + 合作方 logo 注入 + 中英双语，一条 URL 即可完成配置——见 [docs/launch-params.md](docs/launch-params.md)。

- 📮 邮箱：[stevenzearo@163.com](mailto:stevenzearo@163.com)
- 💬 GitHub Issues：[HowardZlh/stellar-odyssey/issues](https://github.com/HowardZlh/stellar-odyssey/issues)

## ⚖️ 开源协议

本项目代码以 [GNU AGPL-3.0](LICENSE) 协议开源：

- **个人学习、教育教学、科研用途**：自由使用、修改与分发（遵循 AGPL 条款）
- **商业闭源集成**（如展馆展项、商业产品嵌入等不愿以 AGPL 开源衍生代码的场景）：请联系作者获取商业授权——邮箱 [stevenzearo@163.com](mailto:stevenzearo@163.com)，或通过 [GitHub Issues](https://github.com/HowardZlh/stellar-odyssey/issues) 留言
- 纹理、3D 模型等素材的许可归属见 [docs/attribution.md](docs/attribution.md)，不适用代码协议
- **商标声明**：「星海奥德赛」与「Stellar Odyssey」名称及项目标识不在开源许可授权范围内，fork 与衍生项目请使用自己的名称
