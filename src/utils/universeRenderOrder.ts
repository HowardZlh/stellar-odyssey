/**
 * L4 宇宙域透明层 renderOrder 注册表（P0 频闪修复，2026-07；单一事实来源）
 *
 * 背景（根因登记）：three.js 对透明队列按 renderOrder → 深度（back-to-front）
 * → object.id 排序。L4 宇宙域的透明层此前 renderOrder 全为默认 0，排序退化
 * 为对象原点深度比较——尾迹线逐帧增长、2MRS 目录/宇宙网每帧哈勃缩放、
 * 相机跟随星系持续运动，使多组对象的深度键在"平手"附近反复交叉，normal
 * 混合层与加性亮层的绘制顺序逐帧翻转 → 盘面雾光亮度双态跳变，经 Bloom
 * mip 链放大为大面积明暗频闪。本注册表给各层显式分配递增 renderOrder，
 * 使层间顺序与深度键脱钩、逐帧稳定。
 *
 * 排序语义（值小先画；同值层均为加性混合可交换，或空间互斥；未登记的
 * 加性层——银盘/银晕/星团粒子、核球辉光、星系贴图平面等——保持默认组 0，
 * 加性混合彼此可交换、无需登记）：
 * 1. 背景星场（登记 −1 = 透明队列最先绘制：星场 shell 几何上位于一切
 *    透明层之后/最远，但其对象原点在 (0,0,0)、深度键具欺骗性——实测曾
 *    与银晕加性粒子（同为原点系对象）深度键交叉翻转，负值锁定最先）；
 * 2. 2MRS 目录点云（两级 draw call 同值，加性可交换）；
 * 3. 程序化宇宙网点云；
 * 4. 加性流层：麦哲伦星流/人马座潮汐流/M31 接近流动光点/合并辉光/
 *    轨道银河年刻度（全加性，互相可交换）；
 * 5. 静态引导线层（normal 混合细线，几何一次构建）：卫星轨道线/
 *    MW–M31 接近虚线/边界环/可观测宇宙环；
 * 6. 运动线层（normal 混合，顶点逐帧更新——尾迹增长/预测弧滚动，深度
 *    键漂移故与静态线分档）：太阳系尾迹/预测虚线/高度指示线；
 * 7. 银河系尘埃带侧视暗带（R2-9 吸光 overlay；原魔数 2 迁入，保持
 *    "晚于全部加性宇宙层做普通混合变暗"的既有语义）；
 * 8. 星系近观加性粒子层（基础 + HII/年轻星团，加性可交换同值）；
 * 9. 近观尘埃暗纹（R4-10 方案登记：normal 混合晚于加性星光层"吸光"；
 *    原 GalaxyNearView DUST_LAYER_RENDER_ORDER=2 迁入）；
 * 10. 直绘发射体积（费米气泡 + 30 Dor，共享一档：原点分别锚定银心/
 *     LMC 盘面、相距 ~16 万 ly，深度键稳定不交叉且屏面重叠可忽略——
 *     组内深度排序即够；原与体积合成并列 renderOrder=10 存在同值深度
 *     歧义，错开登记：置于体积合成之前 → 被跟随星系尘埃盘按透射率
 *     压暗，与消光方案 a 物理一致）；
 * 11. 体积合成（VOLUME_RENDER_ORDER=10 保持不变——消光方案 a"合成晚于
 *     星光粒子"零回退；volume 池容量 1，星云/尘埃盘合成互斥不并存）。
 *
 * 纪律：禁止散落魔数——L4 宇宙域透明层新增/调序一律在此登记取值；
 * 本模块纯常量（不 import three/React），单测锚定递增链与唯一性。
 */

/** L4 宇宙域透明层 renderOrder 注册表（值小先画，见文件头排序语义） */
export const UNIVERSE_RENDER_ORDER = {
  /** 背景星场（全层级常驻；−1 = 透明队列最先绘制，与几何现实一致） */
  starfield: -1,
  /** 2MRS 真实巡天目录点云（R5-3 两级 draw call 同值，加性可交换） */
  galaxyCatalog: 1,
  /** 程序化宇宙网点云（哈勃膨胀每帧缩放，深度键不再参与层间排序） */
  cosmicWeb: 2,
  /** 加性流层：麦哲伦流/人马座流/M31 流动光点/合并辉光/银河年刻度 */
  additiveFlows: 3,
  /** 静态引导线层（normal 混合）：卫星轨道/接近虚线/边界环/可观测环 */
  guideLines: 4,
  /** 运动线层（顶点逐帧更新，深度键漂移）：尾迹/预测虚线/高度指示线 */
  motionLines: 5,
  /** 银河系尘埃带侧视暗带（R2-9 吸光 overlay，原魔数 2 迁入） */
  galaxyDustLane: 6,
  /** 星系近观加性粒子层（基础 + HII/年轻星团） */
  nearViewParticles: 7,
  /** 星系近观尘埃暗纹（R4-10；原 DUST_LAYER_RENDER_ORDER=2 迁入） */
  nearViewDust: 8,
  /** 直绘发射体积：费米气泡（R5-6）+ 30 Dor（R5-5）共享档
   * （原 10 并列组错开登记；组内深度键稳定见文件头） */
  emissiveVolumes: 9,
  /** 体积合成（= VOLUME_RENDER_ORDER，VolumeMaterial.ts 由此取值） */
  volumeComposite: 10,
} as const;

/** 注册表键（单测穷举用） */
export type UniverseRenderOrderKey = keyof typeof UNIVERSE_RENDER_ORDER;

/**
 * 注册表文件头登记的绘制次序（单测据此锚定递增链——新增层必须同步
 * 登记于此，否则唯一性/递增断言失败）
 */
export const UNIVERSE_RENDER_ORDER_SEQUENCE: readonly UniverseRenderOrderKey[] = [
  'starfield',
  'galaxyCatalog',
  'cosmicWeb',
  'additiveFlows',
  'guideLines',
  'motionLines',
  'galaxyDustLane',
  'nearViewParticles',
  'nearViewDust',
  'emissiveVolumes',
  'volumeComposite',
];
