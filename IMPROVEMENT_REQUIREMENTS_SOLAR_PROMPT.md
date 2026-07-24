# 太阳活动真实度提升 S4 — 实现任务

## 任务
实现太阳活动真实度提升 **S4**，权威定义见 `IMPROVEMENT_REQUIREMENTS_SOLAR.md`（v1.3）的 **§4.7 + §7-S4** 两节。开工前只读这两节即可，无需通读全文。

## 已确认范围
先做**核心档**，做完再问用户是否继续进阶/精修档：
- **A1+A2+A3**：黑子群 McIntosh 复杂度分级（1 大黑子 + 2–8 卫星簇，替代当前固定 2 颗）+ 不规则本影/丝状半影 + 群生长/衰退/自行演化
- **B1**：双带耀斑（沿磁中性线两条带状增亮）
- **E2**：活动区磁环族（复杂群上方多重同源日冕环拱）

## 关键实现锚点（直接采信，勿全量探索）
- **黑子逻辑** `src/utils/sunspots.ts`：`sunspotPairInto(slot,simDays,outLeader,outFollower)` 每槽位固定 2 颗；`fillSunspotShaderData(simDays,outDirs,outParams)` 写 shader 数组（当前 `SUNSPOT_PAIR_SLOTS=5`、`SUNSPOT_MAX_RENDERED=10`）。A1 需把"对"扩为"群"（1 前导 + N 卫星），扩容 `SUNSPOT_MAX_RENDERED`（→ ~24）并同步 Sun.tsx shader uniform 数组长度与循环。已有 `sunspotSlotEnabledByCycle`（周期门控）、`butterflyLatitudeDeg`、`filamentDarkening`、`sunspotEarthCount` 勿破坏。
- **黑子 shader** `src/components/CelestialBody/Sun.tsx` 光球 fragmentShader（约 L265–320）：本影 `SUNSPOT_UMBRA_FRAC/UMBRA_BRIGHTNESS`、半影 `PENUMBRA_BRIGHTNESS` + `valueNoise3` 纤维。A2 在此加角向噪声扰动本影边界 + 径向细丝。uniform：`uSpotDirs[]`/`uSpotParams[]`/`uSpotCount`。
- **耀斑** `src/utils/solarActivity.ts`：`flareLocalBoost(angDistRad,intensity01)` 单点圆窗（`FLARE_SPOT_RADIUS_RAD`）、`flareIntensity01` 单峰指数。B1 需沿黑子群前导-后随连线（磁中性线）做带状增亮——新增纯函数如 `flareRibbonBoost(distToNeutralLine,alongFrac,intensity01)`，Sun.tsx shader 用黑子对方向计算中性线（已有 filament 用同款几何，可复用 mid/axis 计算）。耀斑源方位来自 `activeSolarFlare.sourceDir`。
- **日冕环/日珥** `src/components/CelestialBody/SunActivity.tsx`：`CORONAL_LOOP_MAX=5` 池化 `ArcCurve`/`loopArcPoint`，每组锚定黑子对足点渲染**单环**（约 L560–585 循环）。E2 需复杂群渲染多重环拱（扩池上限，按群内多黑子足点生成环族）。

## 硬性约束（沿用 S1–S3，违反即返工）
- 纯逻辑抽 `src/utils/` 镜像 + 就近 `__tests__` 单测，命名 `<模块>S4.test.ts`，覆盖率 gate **≥90%** 保持（当前全量 1288 用例 / 85 套件，语句 97.84%）。GLSL 不直接测。
- 确定性伪随机（禁每帧 `Math.random`，用 `sunspotHash01`/`createSeededRandom`）；渲染循环零分配；卸载 dispose；不可见跳过演算与 uniform 更新。
- **粒子峰值 ≤ 20,000**（现 15,000）；纹理 ≤ 4096；60 FPS 不跌破。
- 艺术化/夸大一律登记文件头 + HelpHint/面板说明；科学参数注来源（McIntosh 1990、Yashiro et al. 2005、Solanki 2003）。
- 共享全局模拟时间轴 `simDays`（暂停冻结/快进/跳变无残留）；剖面模式与外部活动互斥保持。
- §9 排除项不做：MHD 真实模拟、日珥体积渲染、8K 纹理、日震学。

## 验收与收尾流程
1. `npm test` / `npm run type-check` / `npm run lint` / `npm run build` 全绿。
2. 无头 Chrome 目验（复用 `/var/folders/ys/_2dk9x8504l1hmv_17g03bww0000gp/T/opencode/` 下现成 CDP 脚本模板 `sun_s3_*.mjs`；Chrome 路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，参数 `--headless=new --use-angle=metal --window-size=1280,800`）：截图核对复杂黑子群 / 不规则黑子 / 双带耀斑 / 磁环族，FPS ≥ 60 登记。
3. 更新 `CHANGELOG.md [Unreleased]`（含实测数据）；`IMPROVEMENT_REQUIREMENTS_SOLAR.md` §4.7 / §7-S4 对应 🔲 回写 ✅/🔶（登记差异），文档版本升至 **v1.4**。
4. Git（遵循 AGENTS.md）：**开工前先询问用户是否新建分支**（当前在 `feature/p0-core`）；完成后仅本地 commit，再询问是否创建 PR。

## 省 token 建议
- 只读 §4.7 / §7-S4 与上述 4 个锚点文件的相关行段（用 Grep 定位行号，勿整文件重读）。
- 分档分模块实现，每完成一模块跑对应 `npx jest <file>`，最后统一全量验收，减少反复执行。
- 复用现有 shader 噪声基元（`hash3`/`valueNoise3`）与几何工具（`loopArcPoint`/`ArcCurve`/中性线 mid+axis 计算），勿新造。

## 备注
需求文档 §4.7 与 §7-S4 已由上一任务写入（`IMPROVEMENT_REQUIREMENTS_SOLAR.md` 有一处未提交改动），可在本任务一并提交或单独处理。