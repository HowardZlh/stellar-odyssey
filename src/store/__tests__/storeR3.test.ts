/**
 * Store R3 测试：视角域切换重构
 * 1) 巡游期间离散层级锁定（R3 需求 2：跟随行星域天体不再随相机-原点
 *    距离自动跳级；银河系/宇宙巡游同理锁定各自层级）
 * 2) requestFlyTo 按目标域归类切换巡游域并锁定对应层级
 * 3) 用户按 1-4/层级按钮显式切换或取消跟随后恢复距离驱动
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_ANCHOR_BODY_ID } from '@/utils/bodyCycle';
import { SCOPE_DEFAULT_BODY } from '@/utils/cycleScopes';

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L2',
    continuousLevel: 2,
    cameraDistanceUnits: 100,
    cycleScope: 'solar',
    viewTransitionId: 0,
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    anchorBodyId: DEFAULT_ANCHOR_BODY_ID,
    galaxyAnchorBodyId: SCOPE_DEFAULT_BODY.galaxy,
    universeAnchorBodyId: SCOPE_DEFAULT_BODY.universe,
    selectedBodyId: null,
    realScaleMode: false,
    // U2 巡游 gate 回归 setup：注入远期权益态，保证 L3/L4 巡游语义
    // 断言与 gate 引入前逐项一致（免费态 gate 行为由 storeU2.test.ts 覆盖）
    entitlement: { tier: 'year', expSec: Number.MAX_SAFE_INTEGER },
    lockedHint: null,
  });
}

describe('R3 需求 2：跟随期间离散层级锁定（syncCameraDistance）', () => {
  beforeEach(resetStore);

  it('跟随阋神星（67.9 AU ≈ 679 单位）层级不再跳 L3，固定行星视角', () => {
    useSimulationStore.setState({ cycleScope: 'system', viewLevel: 'L1' });
    useSimulationStore.getState().requestFlyTo('eris');
    expect(useSimulationStore.getState().viewLevel).toBe('L1');
    // 相机随目标飞至 679 单位（自由镜头下对应连续层级 ~2.59 = L3）
    useSimulationStore.getState().syncCameraDistance(679);
    const s = useSimulationStore.getState();
    expect(s.viewLevel).toBe('L1');
    expect(s.cycleScope).toBe('system');
    // 连续层级仍按距离同步（LOD/音景平滑行为不变）
    expect(s.continuousLevel).toBeGreaterThan(2.5);
  });

  it('银河系巡游跟随猎户座星云（距原点 ~300 单位）层级锁定 L3 不跌回 L2', () => {
    useSimulationStore.setState({ cycleScope: 'galaxy', viewLevel: 'L3' });
    useSimulationStore.getState().requestFlyTo('orion-nebula');
    useSimulationStore.getState().syncCameraDistance(300);
    const s = useSimulationStore.getState();
    expect(s.viewLevel).toBe('L3');
    expect(s.cycleScope).toBe('galaxy');
  });

  it('宇宙巡游跟随星系时层级锁定 L4', () => {
    useSimulationStore.setState({ cycleScope: 'universe', viewLevel: 'L4', continuousLevel: 4 });
    useSimulationStore.getState().requestFlyTo('m31');
    useSimulationStore.getState().syncCameraDistance(2000);
    expect(useSimulationStore.getState().viewLevel).toBe('L4');
    expect(useSimulationStore.getState().cycleScope).toBe('universe');
  });

  it('太阳系巡游跟随行星时层级锁定 L2（近观地球不改写层级）', () => {
    useSimulationStore.getState().requestFlyTo('earth');
    useSimulationStore.getState().syncCameraDistance(10);
    expect(useSimulationStore.getState().viewLevel).toBe('L2');
    expect(useSimulationStore.getState().cycleScope).toBe('solar');
  });

  it('取消跟随（Esc）后恢复距离驱动层级/巡游域', () => {
    useSimulationStore.setState({ cycleScope: 'system', viewLevel: 'L1' });
    useSimulationStore.getState().requestFlyTo('eris');
    useSimulationStore.setState({ flyToBodyId: null });
    useSimulationStore.getState().setFollowBody(null);
    useSimulationStore.getState().syncCameraDistance(679);
    const s = useSimulationStore.getState();
    expect(s.viewLevel).toBe('L3');
    expect(s.cycleScope).toBe('galaxy');
  });

  it('未跟随的自由缩放跨级正常更新层级与巡游域（现状不回退）', () => {
    useSimulationStore.getState().syncCameraDistance(2600);
    expect(useSimulationStore.getState().viewLevel).toBe('L3');
    expect(useSimulationStore.getState().cycleScope).toBe('galaxy');
    useSimulationStore.getState().syncCameraDistance(10);
    expect(useSimulationStore.getState().viewLevel).toBe('L1');
    expect(useSimulationStore.getState().cycleScope).toBe('system');
  });

  it('锚点过渡期间（updateViewLevel=false）沿用现状不回写层级', () => {
    useSimulationStore.getState().syncCameraDistance(2600, false);
    expect(useSimulationStore.getState().viewLevel).toBe('L2');
    expect(useSimulationStore.getState().cycleScope).toBe('solar');
  });

  it('syncZoomLevel 跟随期间同样锁定离散层级', () => {
    useSimulationStore.getState().requestFlyTo('eris');
    useSimulationStore.getState().syncZoomLevel(3.2);
    expect(useSimulationStore.getState().viewLevel).toBe('L2');
    expect(useSimulationStore.getState().continuousLevel).toBe(3.2);
  });
});

describe('R3：requestFlyTo 按目标域归类切换巡游域并锁定对应层级', () => {
  beforeEach(resetStore);

  it('L2 点选卫星飞往 → system 域 + L1 行星视角', () => {
    useSimulationStore.getState().requestFlyTo('moon');
    const s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('system');
    expect(s.viewLevel).toBe('L1');
    expect(s.anchorBodyId).toBe('moon');
  });

  it('L2 点选行星/矮行星飞往 → 保持 solar 域 + L2（太阳系巡游不中断）', () => {
    useSimulationStore.getState().requestFlyTo('eris');
    const s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('solar');
    expect(s.viewLevel).toBe('L2');
  });

  it('L2 点选日球层顶飞往 → galaxy 域 + L3', () => {
    useSimulationStore.getState().requestFlyTo('heliopause');
    const s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('galaxy');
    expect(s.viewLevel).toBe('L3');
    expect(s.galaxyAnchorBodyId).toBe('heliopause');
  });

  it('点选星系飞往 → universe 域 + L4', () => {
    useSimulationStore.getState().requestFlyTo('m31');
    const s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('universe');
    expect(s.viewLevel).toBe('L4');
    expect(s.universeAnchorBodyId).toBe('m31');
  });

  it('飞往太阳保持当前域与层级（耀斑通知入口不改写巡游域）', () => {
    useSimulationStore.getState().requestFlyTo('sun');
    const s = useSimulationStore.getState();
    expect(s.cycleScope).toBe('solar');
    expect(s.viewLevel).toBe('L2');
  });
});

describe('R3-2：天体简介面板跟随当前巡游天体（selectedBodyId 联动）', () => {
  beforeEach(resetStore);

  it('行星系统巡游（L1）切换：面板跟随新天体', () => {
    useSimulationStore.setState({ cycleScope: 'system', viewLevel: 'L1' });
    useSimulationStore.getState().requestFlyTo('earth');
    useSimulationStore.getState().cycleScopeBody(1); // → tiangong
    expect(useSimulationStore.getState().selectedBodyId).toBe('tiangong');
    useSimulationStore.getState().cycleScopeBody(1); // → iss
    expect(useSimulationStore.getState().selectedBodyId).toBe('iss');
  });

  it('太阳系巡游（L2）切换：面板跟随新天体', () => {
    useSimulationStore.setState({ followBodyId: 'earth', anchorBodyId: 'earth' });
    useSimulationStore.getState().cycleScopeBody(1); // → mars
    expect(useSimulationStore.getState().selectedBodyId).toBe('mars');
  });

  it('银河系巡游（L3）切换：面板跟随新天体', () => {
    useSimulationStore.setState({
      cycleScope: 'galaxy',
      viewLevel: 'L3',
      continuousLevel: 3,
      followBodyId: 'sgr-a-star',
    });
    useSimulationStore.getState().cycleScopeBody(1); // → betelgeuse
    expect(useSimulationStore.getState().selectedBodyId).toBe('betelgeuse');
  });

  it('宇宙巡游（L4）切换：面板跟随新天体', () => {
    useSimulationStore.setState({
      cycleScope: 'universe',
      viewLevel: 'L4',
      continuousLevel: 4,
      followBodyId: 'm31',
    });
    useSimulationStore.getState().cycleScopeBody(1); // → m33
    expect(useSimulationStore.getState().selectedBodyId).toBe('m33');
  });

  it('未跟随时首次按下一个（起始锚定）同样显示面板（确认项 3）', () => {
    useSimulationStore.setState({ cycleScope: 'galaxy', viewLevel: 'L3', continuousLevel: 3 });
    useSimulationStore.getState().cycleScopeBody(1); // 起始锚定 → sgr-a-star
    expect(useSimulationStore.getState().selectedBodyId).toBe('sgr-a-star');
  });

  it('手动关闭面板后跟随期间保持关闭，下一次切换才再次显示', () => {
    useSimulationStore.setState({ followBodyId: 'earth', anchorBodyId: 'earth' });
    useSimulationStore.getState().cycleScopeBody(1); // → mars，面板显示
    useSimulationStore.getState().selectBody(null); // 用户 ✕ 关闭
    expect(useSimulationStore.getState().selectedBodyId).toBeNull();
    useSimulationStore.getState().cycleScopeBody(1); // → encke，面板重新显示
    expect(useSimulationStore.getState().selectedBodyId).toBe('encke');
  });

  it('巡游切换清空黑子/日珥特征卡片（避免两张卡片叠显）', () => {
    useSimulationStore.setState({
      followBodyId: 'earth',
      anchorBodyId: 'earth',
      selectedSolarFeature: {
        kind: 'sunspot',
        titleZh: '黑子群',
        descZh: '样例',
        earthCount: 3,
      },
    });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().selectedSolarFeature).toBeNull();
  });

  it('飞往任意天体（确认项 2）：面板跟随目标（含通知入口"飞往太阳"）', () => {
    useSimulationStore.getState().requestFlyTo('sun');
    expect(useSimulationStore.getState().selectedBodyId).toBe('sun');
    useSimulationStore.getState().requestFlyTo('heliopause');
    expect(useSimulationStore.getState().selectedBodyId).toBe('heliopause');
  });

  it('飞往超新星事件（无目录条目）：维持现状不改写选中', () => {
    useSimulationStore.getState().selectBody('earth');
    useSimulationStore
      .getState()
      .triggerSupernova({ x: 100, y: 0, z: 200 }, 20, 30, 1_000_000);
    const eventId = useSimulationStore.getState().activeSupernova!.id;
    useSimulationStore.getState().requestFlyTo(eventId);
    expect(useSimulationStore.getState().followBodyId).toBe(eventId);
    expect(useSimulationStore.getState().selectedBodyId).toBe('earth');
  });

  it('单成员系统（无卫星行星）切换 no-op：不改写选中', () => {
    useSimulationStore.getState().requestFlyTo('mercury');
    useSimulationStore.setState({ cycleScope: 'system', viewLevel: 'L1' });
    useSimulationStore.getState().selectBody(null);
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().selectedBodyId).toBeNull();
  });
});

describe('R3：cycleScopeBody 巡游切换锁定域主层级', () => {
  beforeEach(resetStore);

  it('银河系巡游切换后层级为 L3（此前自由缩放读数偏离亦纠正）', () => {
    useSimulationStore.setState({
      cycleScope: 'galaxy',
      viewLevel: 'L3',
      continuousLevel: 2.6,
      followBodyId: 'orion-nebula',
    });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('ring-nebula');
    expect(useSimulationStore.getState().viewLevel).toBe('L3');
  });

  it('太阳系巡游切换后层级为 L2', () => {
    useSimulationStore.setState({ followBodyId: 'earth', anchorBodyId: 'earth' });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('mars');
    expect(useSimulationStore.getState().viewLevel).toBe('L2');
  });
});
