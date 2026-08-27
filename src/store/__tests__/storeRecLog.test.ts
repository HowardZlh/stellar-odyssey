/**
 * store 录制诊断埋点 spy 单测（dev 录制调参 + 诊断日志需求）：
 * sim.speed / camera.flyTo / ui.toggle（信息面板、通知卡）/
 * gate.demoQuota / gate.restore(fail) / cme.arrival / aurora.window。
 *
 * 门控自证：未启用（configureRecLog(false)）时同一批 action 零输出。
 */

import { useSimulationStore } from '@/store';
import { configureRecLog } from '@/utils/devRecLog';
import { DEFAULT_LAUNCH_PARAMS } from '@/utils/launchParams';
import { DEFAULT_RECORDING_TUNING } from '@/utils/recordingTuning';

const DIR = { x: 1, y: 0, z: 0 };

/** 输出中指定 tag 的全部（tag, payload）对 */
function recCalls(spy: jest.SpyInstance, tag: string): unknown[] {
  return spy.mock.calls
    .filter((call) => call[0] === '[rec]' && call[1] === tag)
    .map((call) => JSON.parse(call[2] as string));
}

function resetStore(): void {
  useSimulationStore.setState({
    launch: DEFAULT_LAUNCH_PARAMS,
    speedMultiplier: 1,
    simDays: 0,
    continuousLevel: 1,
    viewLevel: 'L1',
    selectedBodyId: null,
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
    cmeArrivalSimDays: null,
    auroraStartedAtSimDays: null,
    cmeArrivalNoticeVisible: false,
    cmeArrivalNoticeAgeSec: 0,
    entitlement: null,
    demoQuota: null,
    revocationListReady: false,
    revocationCheckPending: false,
    revocationCheckFailed: false,
  });
}

describe('store 录制诊断埋点', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    resetStore();
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    configureRecLog(true, false);
  });

  afterEach(() => {
    configureRecLog(false);
    infoSpy.mockRestore();
    resetStore();
  });

  it('未启用日志 → 同批 action 零输出（门控自证）', () => {
    configureRecLog(false);
    const store = useSimulationStore.getState();
    store.setSpeedMultiplier(5);
    store.selectBody('earth');
    store.requestFlyTo('earth');
    store.requestDemoEvent(Date.now());
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('sim.speed：旧→新 + simDays（值未变不输出）', () => {
    useSimulationStore.setState({ simDays: 42 });
    useSimulationStore.getState().setSpeedMultiplier(5);
    expect(recCalls(infoSpy, 'sim.speed')).toEqual([{ from: 1, to: 5, simDays: 42 }]);
    infoSpy.mockClear();
    useSimulationStore.getState().setSpeedMultiplier(5);
    expect(recCalls(infoSpy, 'sim.speed')).toEqual([]);
  });

  it('camera.flyTo：目标 id（解析失败的假目标不输出）', () => {
    useSimulationStore.getState().requestFlyTo('earth');
    expect(recCalls(infoSpy, 'camera.flyTo')).toEqual([{ target: 'earth' }]);
    infoSpy.mockClear();
    useSimulationStore.getState().requestFlyTo('not-a-body');
    expect(recCalls(infoSpy, 'camera.flyTo')).toEqual([]);
  });

  it('ui.toggle：信息面板开合', () => {
    useSimulationStore.getState().selectBody('mars');
    useSimulationStore.getState().selectBody(null);
    expect(recCalls(infoSpy, 'ui.toggle')).toEqual([
      { control: 'infoPanel', open: true, bodyId: 'mars' },
      { control: 'infoPanel', open: false, bodyId: null },
    ]);
  });

  it('ui.toggle：耀斑/CME 通知卡出现与关闭', () => {
    const store = useSimulationStore.getState();
    store.triggerSolarFlare({
      flareClass: 'X',
      magnitude: 9,
      sourceDir: DIR,
      startedAtSimDays: 0,
      cmeLinked: true,
    });
    store.dismissSolarFlareNotice();
    store.triggerCme({
      direction: DIR,
      speedKmS: 500,
      startedAtSimDays: 0,
      earthDirected: true,
    });
    store.dismissCmeNotice();
    expect(recCalls(infoSpy, 'ui.toggle')).toEqual([
      { control: 'notice', kind: 'flare', visible: true },
      { control: 'notice', kind: 'flare', visible: false },
      { control: 'notice', kind: 'cme', visible: true },
      { control: 'notice', kind: 'cme', visible: false },
    ]);
  });

  it('cme.arrival + aurora.window：抵达时长/峰值按 launch.rec 调参', () => {
    useSimulationStore.setState({
      launch: {
        ...DEFAULT_LAUNCH_PARAMS,
        rec: {
          ...DEFAULT_RECORDING_TUNING,
          active: true,
          auroraDays: 8,
          auroraBoost: 1.5,
        },
      },
      continuousLevel: 1, // L1 压缩比 14400（1 秒 = 4 模拟时）
      speedMultiplier: 1,
    });
    useSimulationStore.getState().triggerCmeArrival(100);
    // 8 模拟天 × 86400 / 14400 = 48 真实秒
    expect(recCalls(infoSpy, 'cme.arrival')).toEqual([
      { simDays: 100, auroraStartDays: 100, auroraEndDays: 108, windowRealSec: 48 },
    ]);
    // 峰值 opacity = min(1, 0.5 × 1.5) = 0.75
    expect(recCalls(infoSpy, 'aurora.window')).toEqual([
      { startDays: 100, endDays: 108, peakOpacity: 0.75 },
    ]);
    expect(recCalls(infoSpy, 'ui.toggle')).toEqual([
      { control: 'notice', kind: 'cmeArrival', visible: true },
    ]);
    infoSpy.mockClear();
    useSimulationStore.getState().dismissCmeArrivalNotice();
    expect(recCalls(infoSpy, 'ui.toggle')).toEqual([
      { control: 'notice', kind: 'cmeArrival', visible: false },
    ]);
  });

  it('cme.arrival：暂停（零倍速）时 windowRealSec 如实为 null', () => {
    useSimulationStore.setState({ speedMultiplier: 0 });
    useSimulationStore.getState().triggerCmeArrival(10);
    const calls = recCalls(infoSpy, 'cme.arrival') as Array<{ windowRealSec: number | null }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].windowRealSec).toBeNull();
  });

  it('gate.demoQuota：免费态计次 used/remaining/allowed', () => {
    useSimulationStore.getState().requestDemoEvent(Date.now());
    const calls = recCalls(infoSpy, 'gate.demoQuota') as Array<Record<string, unknown>>;
    expect(calls).toHaveLength(1);
    expect(calls[0].used).toBe(1);
    expect(calls[0].allowed).toBe(true);
    expect(typeof calls[0].remaining).toBe('number');
  });

  it('gate.demoQuota：权益直通', () => {
    useSimulationStore.setState({
      entitlement: { tier: 'year', expSec: Date.now() / 1000 + 86400 },
    });
    useSimulationStore.getState().requestDemoEvent(Date.now());
    expect(recCalls(infoSpy, 'gate.demoQuota')).toEqual([{ entitled: true, allowed: true }]);
  });

  it('gate.restore：吊销名单拉取失败且无缓存 → 来源 fail', () => {
    useSimulationStore.getState().revocationFetchFailed();
    expect(recCalls(infoSpy, 'gate.restore')).toEqual([
      { tier: null, remainingDays: null, revocationSource: 'fail' },
    ]);
  });

  it('gate.restore：有缓存名单时拉取失败静默（无输出）', () => {
    useSimulationStore.setState({ revocationListReady: true });
    useSimulationStore.getState().revocationFetchFailed();
    expect(recCalls(infoSpy, 'gate.restore')).toEqual([]);
  });
});
