/**
 * dev 专用录制诊断日志（结构化单行 JSON，供录制自动化消费）
 *
 * `recLog(tag, payload)` → `console.info("[rec]", tag, 单行 JSON)`。
 *
 * 门控 = 非生产构建 且（任一 rec* 参数出现 或 recLog=1）——由
 * useLaunchInit 解析启动参数后经 configureRecLog 一次性配置
 * （rec.active 已涵盖两种开启条件；生产构建 parseRecordingTuning
 * 恒返回 active=false，双重保险）。未配置/生产态零输出。
 *
 * 防御口径：序列化异常静默降级（payload 落为占位符）、console 异常
 * 吞掉——诊断日志**永不抛错**，不得影响主流程。
 */

/** 会话级日志开关（模块级快照，帧循环消费零 store 依赖——防循环依赖） */
let recLogEnabled = false;

/**
 * 配置诊断日志开关（useLaunchInit 挂载时一次）
 *
 * @param enabled 任一 rec* 参数出现（parseRecordingTuning 的 active）
 * @param isProduction 生产构建标记（默认取 NODE_ENV；生产恒关闭）
 */
export function configureRecLog(
  enabled: boolean,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): void {
  recLogEnabled = enabled && !isProduction;
}

/** 日志是否开启（埋点侧先查再算 payload，未开启时零计算开销） */
export function isRecLogEnabled(): boolean {
  return recLogEnabled;
}

/**
 * 输出一条结构化诊断日志（单行 JSON；未开启时 no-op）
 */
export function recLog(tag: string, payload: unknown): void {
  if (!recLogEnabled) return;
  let json: string;
  try {
    // JSON.stringify(undefined) 返回 undefined（非字符串）——落为 'null'
    json = JSON.stringify(payload) ?? 'null';
  } catch {
    // 循环引用/BigInt 等序列化异常：静默降级为占位符（永不抛错）
    json = '"<unserializable>"';
  }
  try {
    console.info('[rec]', tag, json);
  } catch {
    // console 被环境篡改/抛错：静默吞掉（诊断日志不影响主流程）
  }
}
