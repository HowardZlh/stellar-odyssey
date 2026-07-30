/**
 * store 太阳活动状态单测（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3/§4.1/§6）：
 * 耀斑/CME 触发-完成-通知、剖面模式开关与分层选中
 */

import { useSimulationStore } from '@/store';
import { EVENT_NOTICE_MIN_VISIBLE_REAL_SEC } from '@/utils/eventScopes';
import { FLARE_DURATION_DAYS } from '@/utils/solarActivity';

const DIR = { x: 1, y: 0, z: 0 };

function resetStore(): void {
  useSimulationStore.setState({
    activeSolarFlare: null,
    solarFlareCounter: 0,
    solarFlareNoticeVisible: false,
    solarFlareNoticeInfo: null,
    solarFlareNoticeAgeSec: 0,
    activeCme: null,
    cmeCounter: 0,
    cmeNoticeVisible: false,
    cmeNoticeInfo: null,
    cmeNoticeAgeSec: 0,
    sunCutawayMode: false,
    sunCutawayLayer: null,
    // 通知计时/离域计时依赖 tick：确保处于太阳系视角域且无运镜豁免干扰
    // （R5-8：域判定基于离散 viewLevel，双写保持状态自洽）
    viewLevel: 'L2',
    continuousLevel: 2,
    solarEventsOutOfScopeSec: 0,
  });
}

beforeEach(resetStore);

describe('triggerSolarFlare / completeSolarFlare', () => {
  it('触发生成事件（id 递增、默认时长、通知可见）', () => {
    useSimulationStore.getState().triggerSolarFlare({
      flareClass: 'X',
      magnitude: 2.3,
      sourceDir: DIR,
      startedAtSimDays: 100,
      cmeLinked: true,
    });
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare?.id).toBe('flare-1');
    expect(s.activeSolarFlare?.flareClass).toBe('X');
    expect(s.activeSolarFlare?.durationDays).toBe(FLARE_DURATION_DAYS);
    expect(s.activeSolarFlare?.cmeLinked).toBe(true);
    expect(s.solarFlareNoticeVisible).toBe(true);
  });

  it('已有活跃耀斑时忽略新触发', () => {
    const trigger = useSimulationStore.getState().triggerSolarFlare;
    trigger({ flareClass: 'C', magnitude: 1, sourceDir: DIR, startedAtSimDays: 0, cmeLinked: false });
    trigger({ flareClass: 'M', magnitude: 5, sourceDir: DIR, startedAtSimDays: 1, cmeLinked: false });
    const s = useSimulationStore.getState();
    expect(s.activeSolarFlare?.flareClass).toBe('C');
    expect(s.solarFlareCounter).toBe(1);
  });

  it('非法参数忽略（量级非正/时间非有限）', () => {
    const trigger = useSimulationStore.getState().triggerSolarFlare;
    trigger({ flareClass: 'C', magnitude: 0, sourceDir: DIR, startedAtSimDays: 0, cmeLinked: false });
    trigger({
      flareClass: 'C',
      magnitude: 1,
      sourceDir: DIR,
      startedAtSimDays: Number.NaN,
      cmeLinked: false,
    });
    expect(useSimulationStore.getState().activeSolarFlare).toBeNull();
  });

  it('完成清除事件；通知驻留到最短展示时长后由 tick 自动收起', () => {
    const store = useSimulationStore.getState();
    store.completeSolarFlare();
    expect(useSimulationStore.getState().activeSolarFlare).toBeNull();
    store.triggerSolarFlare({
      flareClass: 'M',
      magnitude: 4,
      sourceDir: DIR,
      startedAtSimDays: 0,
      cmeLinked: false,
    });
    expect(useSimulationStore.getState().solarFlareNoticeInfo).toEqual({
      flareClass: 'M',
      magnitude: 4,
      cmeLinked: false,
    });
    useSimulationStore.getState().completeSolarFlare();
    let s = useSimulationStore.getState();
    // 事件先于最短展示时长完成：通知与快照驻留（用户来得及点击）
    expect(s.activeSolarFlare).toBeNull();
    expect(s.solarFlareNoticeVisible).toBe(true);
    expect(s.solarFlareNoticeInfo).not.toBeNull();
    // 未满最短展示时长：仍然可见
    useSimulationStore.getState().tick(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC - 0.5);
    expect(useSimulationStore.getState().solarFlareNoticeVisible).toBe(true);
    // 满最短展示时长：自动收起并清空快照
    useSimulationStore.getState().tick(0.5);
    s = useSimulationStore.getState();
    expect(s.solarFlareNoticeVisible).toBe(false);
    expect(s.solarFlareNoticeInfo).toBeNull();
    expect(s.solarFlareNoticeAgeSec).toBe(0);
  });

  it('事件持续超过最短展示时长：通知随事件完成收起（原语义保留）', () => {
    useSimulationStore.getState().triggerSolarFlare({
      flareClass: 'X',
      magnitude: 1.5,
      sourceDir: DIR,
      startedAtSimDays: 0,
      cmeLinked: false,
    });
    // 事件进行中通知始终保留（即便已超最短展示时长）
    useSimulationStore.getState().tick(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC + 5);
    expect(useSimulationStore.getState().solarFlareNoticeVisible).toBe(true);
    useSimulationStore.getState().completeSolarFlare();
    // 完成后下一帧 tick 判定收起
    useSimulationStore.getState().tick(0.016);
    expect(useSimulationStore.getState().solarFlareNoticeVisible).toBe(false);
  });

  it('通知可单独关闭（手动关闭不受最短展示时长约束）', () => {
    useSimulationStore.getState().triggerSolarFlare({
      flareClass: 'C',
      magnitude: 3,
      sourceDir: DIR,
      startedAtSimDays: 0,
      cmeLinked: false,
    });
    useSimulationStore.getState().dismissSolarFlareNotice();
    const s = useSimulationStore.getState();
    expect(s.solarFlareNoticeVisible).toBe(false);
    expect(s.solarFlareNoticeInfo).toBeNull();
    expect(s.solarFlareNoticeAgeSec).toBe(0);
    expect(s.activeSolarFlare).not.toBeNull();
  });
});

describe('triggerCme / completeCme', () => {
  it('触发生成事件并钳制速度到 250–3,000 km/s', () => {
    useSimulationStore
      .getState()
      .triggerCme({ direction: DIR, speedKmS: 99999, startedAtSimDays: 5, earthDirected: true });
    const s = useSimulationStore.getState();
    expect(s.activeCme?.id).toBe('cme-1');
    expect(s.activeCme?.speedKmS).toBe(3000);
    expect(s.activeCme?.earthDirected).toBe(true);
    expect(s.cmeNoticeVisible).toBe(true);
    useSimulationStore.getState().completeCme();
    useSimulationStore
      .getState()
      .triggerCme({ direction: DIR, speedKmS: 1, startedAtSimDays: 5, earthDirected: false });
    expect(useSimulationStore.getState().activeCme?.speedKmS).toBe(250);
  });

  it('已有活跃 CME 时忽略新触发（粒子缓冲复用）', () => {
    const trigger = useSimulationStore.getState().triggerCme;
    trigger({ direction: DIR, speedKmS: 800, startedAtSimDays: 0, earthDirected: false });
    trigger({ direction: DIR, speedKmS: 1500, startedAtSimDays: 1, earthDirected: true });
    const s = useSimulationStore.getState();
    expect(s.activeCme?.speedKmS).toBe(800);
    expect(s.cmeCounter).toBe(1);
  });

  it('非法时间忽略；完成清除；通知可单独关闭', () => {
    const store = useSimulationStore.getState();
    store.triggerCme({ direction: DIR, speedKmS: 800, startedAtSimDays: Number.NaN, earthDirected: false });
    expect(useSimulationStore.getState().activeCme).toBeNull();
    store.completeCme();
    expect(useSimulationStore.getState().activeCme).toBeNull();
    store.triggerCme({ direction: DIR, speedKmS: 800, startedAtSimDays: 0, earthDirected: false });
    useSimulationStore.getState().dismissCmeNotice();
    expect(useSimulationStore.getState().cmeNoticeVisible).toBe(false);
    expect(useSimulationStore.getState().cmeNoticeInfo).toBeNull();
    expect(useSimulationStore.getState().activeCme).not.toBeNull();
    useSimulationStore.getState().completeCme();
    expect(useSimulationStore.getState().activeCme).toBeNull();
  });

  it('通知快照与最短展示时长驻留（事件先于时长完成）', () => {
    useSimulationStore
      .getState()
      .triggerCme({ direction: DIR, speedKmS: 800, startedAtSimDays: 0, earthDirected: true });
    expect(useSimulationStore.getState().cmeNoticeInfo).toEqual({
      speedKmS: 800,
      earthDirected: true,
    });
    useSimulationStore.getState().completeCme();
    // 事件已清空但通知驻留（快照支撑卡片渲染）
    let s = useSimulationStore.getState();
    expect(s.activeCme).toBeNull();
    expect(s.cmeNoticeVisible).toBe(true);
    expect(s.cmeNoticeInfo).not.toBeNull();
    useSimulationStore.getState().tick(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC);
    s = useSimulationStore.getState();
    expect(s.cmeNoticeVisible).toBe(false);
    expect(s.cmeNoticeInfo).toBeNull();
  });
});

describe('CME 抵达通知最短展示时长', () => {
  it('极光结束后通知驻留到最短展示时长再自动收起', () => {
    useSimulationStore.setState({
      cmeArrivalNoticeVisible: false,
      cmeArrivalNoticeAgeSec: 0,
      auroraStartedAtSimDays: null,
      viewLevel: 'L2',
      continuousLevel: 2,
      solarEventsOutOfScopeSec: 0,
    });
    useSimulationStore.getState().triggerCmeArrival(100);
    expect(useSimulationStore.getState().cmeArrivalNoticeVisible).toBe(true);
    // 极光进行中：超过最短展示时长也不收起
    useSimulationStore.getState().tick(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC + 1);
    expect(useSimulationStore.getState().cmeArrivalNoticeVisible).toBe(true);
    // 极光结束：下一帧 tick 判定收起（展示计时已满）
    useSimulationStore.getState().completeAurora();
    useSimulationStore.getState().tick(0.016);
    const s = useSimulationStore.getState();
    expect(s.cmeArrivalNoticeVisible).toBe(false);
    expect(s.cmeArrivalNoticeAgeSec).toBe(0);
  });
});

describe('剖面模式（§4.1）', () => {
  it('开关切换；关闭时清除分层选中', () => {
    const store = useSimulationStore.getState();
    store.setSunCutawayMode(true);
    useSimulationStore.getState().setSunCutawayLayer('radiative');
    expect(useSimulationStore.getState().sunCutawayLayer).toBe('radiative');
    useSimulationStore.getState().setSunCutawayMode(false);
    const s = useSimulationStore.getState();
    expect(s.sunCutawayMode).toBe(false);
    expect(s.sunCutawayLayer).toBeNull();
  });

  it('重复设置同值为空操作（引用不变）', () => {
    const before = useSimulationStore.getState();
    before.setSunCutawayMode(false);
    expect(useSimulationStore.getState().sunCutawayMode).toBe(false);
  });

  it('分层点选与取消', () => {
    useSimulationStore.getState().setSunCutawayLayer('core');
    expect(useSimulationStore.getState().sunCutawayLayer).toBe('core');
    useSimulationStore.getState().setSunCutawayLayer(null);
    expect(useSimulationStore.getState().sunCutawayLayer).toBeNull();
  });
});
