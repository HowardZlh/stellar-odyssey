/**
 * store 展馆模式接入单测（B5）：uiVisible 显隐 action + kioskEvent
 * 状态机事件入口（副作用消费：UI 显隐 / 域内推进 / 进入域起点 /
 * tour=all 域末切域 / 暂停恢复）。
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_LAUNCH_PARAMS } from '@/utils/launchParams';
import { KIOSK_INACTIVE, KIOSK_RESUME_DEFAULT_SEC } from '@/utils/kiosk';
import { GALAXY_CYCLE_SEQUENCE, UNIVERSE_CYCLE_SEQUENCE } from '@/utils/cycleScopes';
import { SOLAR_CYCLE_SEQUENCE } from '@/utils/bodyCycle';

/** 恢复本套件触达的字段（沿用 storeB4 复位惯例） */
afterEach(() => {
  useSimulationStore.setState({
    launch: DEFAULT_LAUNCH_PARAMS,
    uiVisible: true,
    kiosk: KIOSK_INACTIVE,
    viewLevel: 'L2',
    continuousLevel: 2,
    cycleScope: 'solar',
    followBodyId: null,
    flyToBodyId: null,
    selectedBodyId: null,
    anchorBodyId: 'earth',
    galaxyAnchorBodyId: 'sgr-a-star',
    universeAnchorBodyId: 'm31',
  });
});

describe('uiVisible 显隐状态（B5 §5.1-A）', () => {
  it('默认可见', () => {
    expect(useSimulationStore.getState().uiVisible).toBe(true);
  });

  it('setUiVisible 写入 / toggleUiVisible 翻转', () => {
    useSimulationStore.getState().setUiVisible(false);
    expect(useSimulationStore.getState().uiVisible).toBe(false);
    useSimulationStore.getState().toggleUiVisible();
    expect(useSimulationStore.getState().uiVisible).toBe(true);
    useSimulationStore.getState().toggleUiVisible();
    expect(useSimulationStore.getState().uiVisible).toBe(false);
  });
});

describe('kioskEvent 状态机入口（B5 §5.1-C）', () => {
  it('kiosk 初始未激活', () => {
    expect(useSimulationStore.getState().kiosk).toBe(KIOSK_INACTIVE);
  });

  it('start：进入 touring + 隐 UI + 立即推进（默认 solar 域未跟随 → 飞往域起点地球）', () => {
    const before = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().kioskEvent('start', 100);
    const s = useSimulationStore.getState();
    expect(s.kiosk).toEqual({ phase: 'touring', nextAtSec: 100 + s.launch.dwell });
    expect(s.uiVisible).toBe(false);
    expect(s.flyToRequestId).toBe(before + 1);
    expect(s.followBodyId).toBe('earth');
    expect(s.cycleScope).toBe('solar');
    expect(s.viewLevel).toBe('L2');
  });

  it('touring 到期 tick：域内下一站（cycleScopeBody(1) 全语义——太阳系序列地球 → 下一半长轴天体）', () => {
    useSimulationStore.getState().kioskEvent('start', 100);
    const earthIdx = SOLAR_CYCLE_SEQUENCE.indexOf('earth');
    useSimulationStore.getState().kioskEvent('tick', 130);
    const s = useSimulationStore.getState();
    expect(s.followBodyId).toBe(SOLAR_CYCLE_SEQUENCE[earthIdx + 1]);
    expect(s.selectedBodyId).toBe(SOLAR_CYCLE_SEQUENCE[earthIdx + 1]);
    expect(s.kiosk).toEqual({ phase: 'touring', nextAtSec: 130 + s.launch.dwell });
  });

  it('touring 未到期 tick：零变化（kiosk 引用不变、不推进）', () => {
    useSimulationStore.getState().kioskEvent('start', 100);
    const kiosk = useSimulationStore.getState().kiosk;
    const flyId = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().kioskEvent('tick', 105);
    expect(useSimulationStore.getState().kiosk).toBe(kiosk);
    expect(useSimulationStore.getState().flyToRequestId).toBe(flyId);
  });

  it('touring 输入：暂停 + 显 UI + 恢复计时 = 默认 90 秒', () => {
    useSimulationStore.getState().kioskEvent('start', 100);
    useSimulationStore.getState().kioskEvent('input', 110);
    const s = useSimulationStore.getState();
    expect(s.kiosk).toEqual({ phase: 'paused', nextAtSec: 110 + KIOSK_RESUME_DEFAULT_SEC });
    expect(s.uiVisible).toBe(true);
  });

  it('paused 持续输入重置恢复计时；到期 tick 恢复 touring + 隐 UI + 立即推进', () => {
    useSimulationStore.getState().kioskEvent('start', 100);
    useSimulationStore.getState().kioskEvent('input', 110);
    useSimulationStore.getState().kioskEvent('input', 150);
    expect(useSimulationStore.getState().kiosk.nextAtSec).toBe(150 + KIOSK_RESUME_DEFAULT_SEC);
    const flyId = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().kioskEvent('tick', 150 + KIOSK_RESUME_DEFAULT_SEC);
    const s = useSimulationStore.getState();
    expect(s.kiosk.phase).toBe('touring');
    expect(s.uiVisible).toBe(false);
    expect(s.flyToRequestId).toBe(flyId + 1);
  });

  it('exit：回 inactive + 恢复 UI 可见（不改动相机/跟随状态）', () => {
    useSimulationStore.getState().kioskEvent('start', 100);
    const follow = useSimulationStore.getState().followBodyId;
    useSimulationStore.getState().kioskEvent('exit', 120);
    const s = useSimulationStore.getState();
    expect(s.kiosk).toBe(KIOSK_INACTIVE);
    expect(s.uiVisible).toBe(true);
    expect(s.followBodyId).toBe(follow);
  });

  it('dwell 参数化：launch.dwell 覆盖推进节奏（?dwell=5）', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, dwell: 5 } });
    useSimulationStore.getState().kioskEvent('start', 100);
    expect(useSimulationStore.getState().kiosk.nextAtSec).toBe(105);
  });

  it('tour=galaxy：启动两步进域——先 L3 全景锚点站，再飞往 sgr-a-star（域切换两步登记）', () => {
    useSimulationStore.setState({ launch: { ...DEFAULT_LAUNCH_PARAMS, tour: 'galaxy' } });
    useSimulationStore.getState().kioskEvent('start', 100);
    // 第一步 anchor：setViewLevel(L3) 域全景（cycleScope 同步、未跟随）
    let s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('galaxy');
    expect(s.viewLevel).toBe('L3');
    expect(s.followBodyId).toBeNull();
    // 第二步 enter：dwell 到期飞往域默认天体
    useSimulationStore.getState().kioskEvent('tick', 200);
    s = useSimulationStore.getState();
    expect(s.followBodyId).toBe('sgr-a-star');
    // 第三步 next：域内序列推进
    useSimulationStore.getState().kioskEvent('tick', 300);
    const at = GALAXY_CYCLE_SEQUENCE.indexOf('sgr-a-star');
    expect(useSimulationStore.getState().followBodyId).toBe(GALAXY_CYCLE_SEQUENCE[at + 1]);
  });

  it('tour=all 域末切下一域两步：银河系末站 → L4 全景锚点 → 宇宙域起点 m31（跨域登记）', () => {
    useSimulationStore.setState({
      launch: { ...DEFAULT_LAUNCH_PARAMS, tour: 'all' },
      kiosk: { phase: 'touring', nextAtSec: 100 },
      uiVisible: false,
      cycleScope: 'galaxy',
      viewLevel: 'L3',
      followBodyId: GALAXY_CYCLE_SEQUENCE[GALAXY_CYCLE_SEQUENCE.length - 1],
    });
    useSimulationStore.getState().kioskEvent('tick', 100);
    let s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('universe');
    expect(s.viewLevel).toBe('L4');
    expect(s.followBodyId).toBeNull(); // 全景锚点站（取消跟随）
    useSimulationStore.getState().kioskEvent('tick', 200);
    s = useSimulationStore.getState();
    expect(s.followBodyId).toBe('m31');
    expect(s.viewLevel).toBe('L4');
  });

  it('tour=all universe 域末回绕 system 域：L1 锚点站即飞往并跟随锚定天体（L1 特殊语义登记）', () => {
    useSimulationStore.setState({
      launch: { ...DEFAULT_LAUNCH_PARAMS, tour: 'all' },
      kiosk: { phase: 'touring', nextAtSec: 100 },
      uiVisible: false,
      cycleScope: 'universe',
      viewLevel: 'L4',
      followBodyId: UNIVERSE_CYCLE_SEQUENCE[UNIVERSE_CYCLE_SEQUENCE.length - 1],
    });
    useSimulationStore.getState().kioskEvent('tick', 100);
    const s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('system');
    expect(s.viewLevel).toBe('L1');
    // setViewLevel('L1') 特殊语义：直接飞往并跟随会话锚定天体（earth）
    expect(s.followBodyId).toBe('earth');
  });

  it('暂停期间用户切走域：恢复推进时两步重新对齐 tour 域', () => {
    useSimulationStore.getState().kioskEvent('start', 100); // tour=solar
    useSimulationStore.getState().kioskEvent('input', 110); // 暂停
    // 用户切到宇宙视角随意浏览
    useSimulationStore.getState().setViewLevel('L4');
    expect(useSimulationStore.getState().cycleScope).toBe('universe');
    // 恢复第一步：anchor 回 solar 域全景（L2）
    useSimulationStore.getState().kioskEvent('tick', 110 + KIOSK_RESUME_DEFAULT_SEC);
    let s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('solar');
    expect(s.viewLevel).toBe('L2');
    expect(s.followBodyId).toBeNull();
    // 恢复第二步：enter 域起点地球
    useSimulationStore.getState().kioskEvent('tick', 110 + KIOSK_RESUME_DEFAULT_SEC + 30);
    s = useSimulationStore.getState();
    expect(s.followBodyId).toBe('earth');
  });

  it('未激活时 input/tick 为无操作（kioskEvent 幂等安全）', () => {
    const before = useSimulationStore.getState();
    useSimulationStore.getState().kioskEvent('input', 100);
    useSimulationStore.getState().kioskEvent('tick', 100);
    const after = useSimulationStore.getState();
    expect(after.kiosk).toBe(before.kiosk);
    expect(after.uiVisible).toBe(true);
    expect(after.flyToRequestId).toBe(before.flyToRequestId);
  });
});
