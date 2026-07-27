/**
 * 人造/自然卫星"渲染相位"注册表（P7 §3.1 近观跟随一致性）
 *
 * 背景：快周期卫星（ISS 92 分钟）在高时间压缩比下做速率钳制（需求 3.3），
 * 渲染相位按降速角速度累计（Moon.tsx），与"精确相位"（严格按共享模拟
 * 时间轴求值）存在偏差。P4 前该偏差仅影响一个 0.06 单位的小盒子，可接受；
 * P7 近观 glTF 模型下相机若按精确相位跟随，卫星会在数秒内漂出视野。
 *
 * 方案：渲染组件每帧把实际使用的轨道相位（弧度）写入本注册表，
 * cameraFocus.moonScenePosition 优先读取注册相位解析目标位置，
 * 保证"相机跟随的点"与"渲染的卫星"始终一致。
 *
 * 纯逻辑模块（供单元测试）；注册表为模块级状态，卫星组件卸载时清除。
 */

const renderedPhases = new Map<string, number>();

/** 写入卫星当前渲染相位（平近点角，弧度） */
export function setRenderedSatellitePhase(bodyId: string, phaseRad: number): void {
  if (!Number.isFinite(phaseRad)) {
    throw new RangeError(`渲染相位必须为有限数，收到 ${phaseRad}`);
  }
  renderedPhases.set(bodyId, phaseRad);
}

/** 读取卫星当前渲染相位（弧度）；未注册返回 null */
export function renderedSatellitePhaseRad(bodyId: string): number | null {
  return renderedPhases.get(bodyId) ?? null;
}

/** 清除单个卫星的注册相位（组件卸载时调用） */
export function clearRenderedSatellitePhase(bodyId: string): void {
  renderedPhases.delete(bodyId);
}

/** 清空注册表（测试用） */
export function clearAllRenderedSatellitePhases(): void {
  renderedPhases.clear();
}
