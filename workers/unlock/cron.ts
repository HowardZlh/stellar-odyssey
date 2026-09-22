/**
 * `stellar-unlock-cron` Worker 入口（2026-09-22 起）：只暴露 `scheduled`，
 * 复用 index.ts 的统一对账 + 运营通知壳。
 *
 * 为什么单独一个 Worker：HTTP 面已打包进 Pages 高级模式 `_worker.js`
 * （账号 D `stellar-odyssey` 项目），而 Pages 不支持 Cron Trigger；本 Worker
 * 与 Pages 绑同一 D1 `UNLOCK_DB`，secrets 两处各放一份（见 UNLOCK_OPS.md）。
 * 不暴露 fetch：workers.dev 入口对任何请求返回 404，避免成为第二个公网面。
 */
import worker, {
  type ExecutionCtxLike,
  type ScheduledCtrlLike,
  type UnlockWorkerEnv,
} from "./index";

const cronWorker = {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
  scheduled(
    controller: ScheduledCtrlLike | null,
    env: UnlockWorkerEnv,
    ctx: ExecutionCtxLike,
  ): void {
    worker.scheduled(controller, env, ctx);
  },
};

export default cronWorker;
