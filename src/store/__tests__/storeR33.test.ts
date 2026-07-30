/**
 * Store R3-3 测试：动态事件视角域硬隔离（IMPROVEMENT_REQUIREMENTS_3 §3.1-B）
 * 1) 离域 >1 秒（真实时间）丢弃活跃事件：耀斑/CME 含在途抵达链与极光整链、
 *    超新星不归档遗迹（既有遗迹保留）、合并预览恢复预览前时间
 * 2) <1 秒折返域内事件保留（宽限，确认项 3）；回域不恢复被丢弃的事件
 * 3) 锚点切换/飞往运镜豁免（viewTransitionId/flyToRequestId 变更帧写入负计时）
 * 4) 计数器不回退；暂停不影响丢弃（真实时间驱动）
 *
 * R5-8 迁移登记：域判定基准由 continuousLevel 连续窗口改为离散 viewLevel
 * 视角集合——原 `setState({ continuousLevel: X })` 层级设置逐一等价迁移为
 * `setState({ viewLevel, continuousLevel })` 双写（continuousLevel 保留仅为
 * 状态真实感，门控不再读取）；新增"跟随造父一"用户场景回归套件。
 */

import { useSimulationStore } from '@/store';
import {
  EVENT_DISCARD_GRACE_SEC,
  FLY_TO_DISCARD_EXEMPT_SEC,
  VIEW_TRANSITION_DISCARD_EXEMPT_SEC,
} from '@/utils/eventScopes';

const DIR = { x: 1, y: 0, z: 0 };

function resetStore(): void {
  useSimulationStore.setState({
    simDays: 0,
    paused: false,
    speedMultiplier: 1,
    viewLevel: 'L2',
    continuousLevel: 2,
    viewTransitionId: 0,
    flyToRequestId: 0,
    followBodyId: null,
    flyToBodyId: null,
    activeSupernova: null,
    supernovaRemnants: [],
    supernovaNoticeVisible: false,
    supernovaCounter: 0,
    activeSolarFlare: null,
    solarFlareCounter: 0,
    solarFlareNoticeVisible: false,
    activeCme: null,
    cmeCounter: 0,
    cmeNoticeVisible: false,
    cmeArrivalSimDays: null,
    auroraStartedAtSimDays: null,
    cmeArrivalNoticeVisible: false,
    mergePreviewActive: false,
    mergePreviewProgress01: 0,
    mergePreviewReturnSimDays: null,
    solarEventsOutOfScopeSec: 0,
    supernovaOutOfScopeSec: 0,
    mergerOutOfScopeSec: 0,
    eventScopeSeenTransitionId: 0,
    eventScopeSeenFlyToId: 0,
  });
}

/** L2 域内触发一组太阳活动事件（耀斑 + CME + 在途抵达 + 极光 + 抵达通知） */
function seedSolarEvents(): void {
  useSimulationStore.getState().triggerSolarFlare({
    flareClass: 'X',
    magnitude: 2.3,
    startedAtSimDays: 0,
    sourceDir: DIR,
    cmeLinked: true,
  });
  useSimulationStore
    .getState()
    .triggerCme({ direction: DIR, speedKmS: 1000, startedAtSimDays: 0, earthDirected: true });
  useSimulationStore.getState().scheduleCmeArrival(3);
  useSimulationStore.setState({ auroraStartedAtSimDays: 1, cmeArrivalNoticeVisible: true });
}

describe('R3-3 太阳活动事件离域丢弃（耀斑/CME/抵达链整链）', () => {
  beforeEach(resetStore);

  it('L2 触发后切出域（L3）累计 >1 秒：整链清空、通知标志复位', () => {
    seedSolarEvents();
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3 });
    useSimulationStore.getState().tick(0.5);
    // 宽限期内未丢弃
    expect(useSimulationStore.getState().activeSolarFlare).not.toBeNull();
    useSimulationStore.getState().tick(0.6);
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare).toBeNull();
    expect(s.solarFlareNoticeVisible).toBe(false);
    expect(s.activeCme).toBeNull();
    expect(s.cmeNoticeVisible).toBe(false);
    expect(s.cmeArrivalSimDays).toBeNull();
    expect(s.auroraStartedAtSimDays).toBeNull();
    expect(s.cmeArrivalNoticeVisible).toBe(false);
  });

  it('<1 秒折返域内：事件保留、计时清零（宽限，确认项 3）', () => {
    seedSolarEvents();
    // 原 continuousLevel: 2.6（越过旧窗口上缘 2.4）；等价迁移为离散 L3
    // （自由缩放时 2.6 经 discreteLevelFromContinuous 即 L3）
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 2.6 });
    useSimulationStore.getState().tick(0.8);
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2 });
    useSimulationStore.getState().tick(0.016);
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare).not.toBeNull();
    expect(s.activeCme).not.toBeNull();
    expect(s.cmeArrivalSimDays).toBe(3);
    expect(s.solarEventsOutOfScopeSec).toBe(0);
  });

  it('回域不恢复被丢弃的事件；计数器不回退，下一次触发 id 单调递增', () => {
    seedSolarEvents();
    const counterBefore = useSimulationStore.getState().solarFlareCounter;
    useSimulationStore.setState({ viewLevel: 'L4', continuousLevel: 4 });
    useSimulationStore.getState().tick(1.1);
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2 });
    useSimulationStore.getState().tick(0.016);
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare).toBeNull();
    expect(s.solarFlareCounter).toBe(counterBefore);
    useSimulationStore.getState().triggerSolarFlare({
      flareClass: 'C',
      magnitude: 1,
      startedAtSimDays: 5,
      sourceDir: DIR,
      cmeLinked: false,
    });
    expect(useSimulationStore.getState().activeSolarFlare?.id).toBe(
      `flare-${counterBefore + 1}`,
    );
  });

  it('暂停不影响丢弃（真实时间驱动，模拟时间不推进）', () => {
    seedSolarEvents();
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3, paused: true });
    const simDaysBefore = useSimulationStore.getState().simDays;
    useSimulationStore.getState().tick(1.1);
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare).toBeNull();
    expect(s.simDays).toBe(simDaysBefore);
  });

  it('域外长时间停留计时上钳到宽限期（稳态无状态漂移）', () => {
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3 });
    useSimulationStore.getState().tick(5);
    expect(useSimulationStore.getState().solarEventsOutOfScopeSec).toBe(
      EVENT_DISCARD_GRACE_SEC,
    );
    useSimulationStore.getState().tick(5);
    expect(useSimulationStore.getState().solarEventsOutOfScopeSec).toBe(
      EVENT_DISCARD_GRACE_SEC,
    );
  });
});

describe('R3-3 超新星离域丢弃（不归档遗迹、既有遗迹保留，确认项 1）', () => {
  beforeEach(resetStore);

  it('L3 触发后切 L2 >1 秒：动画终止不产生新遗迹，既有遗迹完整保留', () => {
    useSimulationStore.setState({ continuousLevel: 3, viewLevel: 'L3' });
    // 先归档一枚既有遗迹
    useSimulationStore.getState().triggerSupernova({ x: 100, y: 0, z: 0 }, 25, 12, 0);
    useSimulationStore.getState().archiveSupernova();
    expect(useSimulationStore.getState().supernovaRemnants).toHaveLength(1);
    // 再触发进行中的爆发
    useSimulationStore.getState().triggerSupernova({ x: 200, y: 0, z: 0 }, 15, 12, 0);
    expect(useSimulationStore.getState().activeSupernova).not.toBeNull();
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2 });
    useSimulationStore.getState().tick(1.1);
    const s = useSimulationStore.getState();
    expect(s.activeSupernova).toBeNull();
    expect(s.supernovaNoticeVisible).toBe(false);
    expect(s.supernovaRemnants).toHaveLength(1);
    expect(s.supernovaRemnants[0].id).toBe('sn-1');
  });

  it('域内（L3）活跃超新星不受计时影响', () => {
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3 });
    useSimulationStore.getState().triggerSupernova({ x: 100, y: 0, z: 0 }, 25, 12, 0);
    useSimulationStore.getState().tick(5);
    expect(useSimulationStore.getState().activeSupernova).not.toBeNull();
    expect(useSimulationStore.getState().supernovaOutOfScopeSec).toBe(0);
  });

  it('R3-5：L4（宇宙视角）为超新星域外——缩到 L4 >1 秒活跃超新星被丢弃', () => {
    useSimulationStore.setState({ continuousLevel: 3, viewLevel: 'L3' });
    useSimulationStore.getState().triggerSupernova({ x: 100, y: 0, z: 0 }, 25, 12, 0);
    useSimulationStore.setState({ viewLevel: 'L4', continuousLevel: 4 });
    useSimulationStore.getState().tick(1.1);
    const s = useSimulationStore.getState();
    expect(s.activeSupernova).toBeNull();
    expect(s.supernovaNoticeVisible).toBe(false);
  });
});

describe('R3-3 合并预览离域丢弃（恢复预览前时间，确认项 2）', () => {
  beforeEach(resetStore);

  it('预览进行中缩出 L4 域 >1 秒：预览终止且模拟时间回跳预览前时刻', () => {
    useSimulationStore.setState({ simDays: 1234 });
    useSimulationStore.getState().startMergePreview();
    // 消费启动运镜豁免（L4 域内计时归零），预览推进一段
    useSimulationStore.getState().tick(2.5);
    expect(useSimulationStore.getState().mergePreviewActive).toBe(true);
    expect(useSimulationStore.getState().simDays).toBeGreaterThan(1234);
    // 滚轮缩出 L4 域（自由缩放时 viewLevel 随离散层级同步跌回 L3）
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3 });
    useSimulationStore.getState().tick(1.1);
    const s = useSimulationStore.getState();
    expect(s.mergePreviewActive).toBe(false);
    expect(s.mergePreviewProgress01).toBe(0);
    expect(s.simDays).toBe(1234);
    expect(s.mergePreviewReturnSimDays).toBeNull();
  });

  it('预览启动自动切 L4 的运镜途中不被误杀（R5-8：viewLevel 即时 L4 恒域内；运镜豁免保留）', () => {
    useSimulationStore.getState().startMergePreview();
    // 模拟 2 秒锚点运镜途中：连续层级尚在途中（2.8），但 startMergePreview
    // 已将 viewLevel 置 L4 且运镜期间不回写离散层级（CameraController
    // updateViewLevel=false）——R5-8 后域判定只看 viewLevel，恒域内
    useSimulationStore.setState({ continuousLevel: 2.8 });
    useSimulationStore.getState().tick(2.0);
    expect(useSimulationStore.getState().viewLevel).toBe('L4');
    expect(useSimulationStore.getState().mergePreviewActive).toBe(true);
    // 运镜抵达 L4 后计时归零，预览继续
    useSimulationStore.setState({ continuousLevel: 4 });
    useSimulationStore.getState().tick(0.5);
    expect(useSimulationStore.getState().mergePreviewActive).toBe(true);
    expect(useSimulationStore.getState().mergerOutOfScopeSec).toBe(0);
  });

  it('预览自然结束后仅存的"恢复预览前时间"状态非进行中事件，不受离域清除', () => {
    useSimulationStore.setState({ simDays: 1234 });
    useSimulationStore.getState().startMergePreview();
    useSimulationStore.getState().tick(60); // 远超预览时长，自然结束
    expect(useSimulationStore.getState().mergePreviewActive).toBe(false);
    expect(useSimulationStore.getState().mergePreviewReturnSimDays).toBe(1234);
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2 });
    useSimulationStore.getState().tick(1.1);
    expect(useSimulationStore.getState().mergePreviewReturnSimDays).toBe(1234);
  });
});

describe('R3-3 运镜豁免（viewTransitionId / flyToRequestId 变更帧写入负计时）', () => {
  beforeEach(resetStore);

  it('锚点切换代次变更：三类计时器写入 -2 秒豁免并消费代次', () => {
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3, viewTransitionId: 7 });
    useSimulationStore.getState().tick(0.5);
    const s = useSimulationStore.getState();
    expect(s.eventScopeSeenTransitionId).toBe(7);
    // -2 + 0.5 = -1.5（太阳事件在 L3 域外，自豁免起步累加）
    expect(s.solarEventsOutOfScopeSec).toBeCloseTo(
      -VIEW_TRANSITION_DISCARD_EXEMPT_SEC + 0.5,
      10,
    );
  });

  it('飞往请求代次变更：写入 -2.5 秒豁免并消费代次', () => {
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3, flyToRequestId: 4 });
    useSimulationStore.getState().tick(0.5);
    const s = useSimulationStore.getState();
    expect(s.eventScopeSeenFlyToId).toBe(4);
    expect(s.solarEventsOutOfScopeSec).toBeCloseTo(-FLY_TO_DISCARD_EXEMPT_SEC + 0.5, 10);
  });

  it('豁免期间跨越域边界的活跃事件不被丢弃', () => {
    seedSolarEvents();
    useSimulationStore.setState({ viewLevel: 'L4', continuousLevel: 4, viewTransitionId: 1 });
    useSimulationStore.getState().tick(1.5); // -2 + 1.5 = -0.5，未达宽限
    expect(useSimulationStore.getState().activeSolarFlare).not.toBeNull();
  });
});

describe('R5-8 用户场景回归：银河系巡游跟随造父一（viewLevel L3 锁定 + continuousLevel≈2.2）', () => {
  beforeEach(resetStore);

  /** 跟随 L3 特殊天体的锁定态：离散层级锁 L3，连续层级随相机距离 ≈2.2 */
  function enterCepheidFollow(): void {
    useSimulationStore.setState({
      viewLevel: 'L3',
      continuousLevel: 2.2,
      followBodyId: 'cepheid-delta-cephei',
    });
  }

  it('缺陷修复：已活跃太阳事件整链（耀斑/CME/在途抵达/极光/通知）约 1 秒后被丢弃', () => {
    seedSolarEvents();
    enterCepheidFollow();
    // 宽限期内保留
    useSimulationStore.getState().tick(0.5);
    expect(useSimulationStore.getState().activeSolarFlare).not.toBeNull();
    // 累计超 1 秒：整链清空（修复前 continuousLevel 2.2 落入旧窗口 [1, 2.4]
    // 判域内，事件永不丢弃且持续弹通知）
    useSimulationStore.getState().tick(0.6);
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare).toBeNull();
    expect(s.solarFlareNoticeVisible).toBe(false);
    expect(s.activeCme).toBeNull();
    expect(s.cmeNoticeVisible).toBe(false);
    expect(s.cmeArrivalSimDays).toBeNull();
    expect(s.auroraStartedAtSimDays).toBeNull();
    expect(s.cmeArrivalNoticeVisible).toBe(false);
  });

  it('太阳事件离域计时持续累加（新触发同帧起算，不因相机距离 2.2 判域内）', () => {
    enterCepheidFollow();
    useSimulationStore.getState().tick(5);
    expect(useSimulationStore.getState().solarEventsOutOfScopeSec).toBe(
      EVENT_DISCARD_GRACE_SEC,
    );
  });

  it('镜像缺陷修复：活跃超新星域内保留不被误丢弃（修复前 2.2 落在旧窗口 [2.5, 3.5] 外）', () => {
    useSimulationStore.setState({ viewLevel: 'L3', continuousLevel: 3 });
    useSimulationStore.getState().triggerSupernova({ x: 100, y: 0, z: 0 }, 25, 12, 0);
    enterCepheidFollow();
    useSimulationStore.getState().tick(5);
    const s = useSimulationStore.getState();
    expect(s.activeSupernova).not.toBeNull();
    expect(s.supernovaOutOfScopeSec).toBe(0);
  });
});

describe('R3-3 tick 边界', () => {
  beforeEach(resetStore);

  it('负时间增量抛 RangeError（非预览路径同样显式校验）', () => {
    expect(() => useSimulationStore.getState().tick(-1)).toThrow(RangeError);
  });
});
