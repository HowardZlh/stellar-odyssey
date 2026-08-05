/**
 * M3 移动布局行为单测（isCompact 分流）：
 * - BottomTabBar：桌面不渲染；紧凑视口四入口渲染 + 面板互斥开合
 * - ControlPanel 抽屉：紧凑视口默认收起（aria-hidden），☰ 开合、✕ 关闭
 * - HelpHint / ContactBadge：紧凑视口默认不渲染，经 mobilePanel 弹层化
 *   （对外链接常量同源呈现）；桌面分支保持原布局
 * - HudStatusPanel：紧凑视口顶部状态条（暂停按钮 + tap 展开详情）
 * - 底部卡区互斥：太阳特征卡 > 剖面分层卡 > 信息面板
 * - BodyInfoPanel：底部半屏卡下滑手势关闭
 * - BodyCycleSwitcher：紧凑视口不渲染（并入标签栏）
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { BodyCycleSwitcher } from '../BodyCycleSwitcher';
import { BottomTabBar } from '../BottomTabBar';
import { ContactBadge, CONTACT_EMAIL } from '../ContactBadge';
import { ControlPanel } from '../ControlPanel';
import { HelpHint } from '../HelpHint';
import { HudInfo } from '../HudInfo';
import { LeftColumn } from '../LeftColumn';
import { SunLayerCard } from '../hud/SunLayerCard';

const initialState = useSimulationStore.getState();

function setCompact(): void {
  useSimulationStore.setState({ isCompact: true, isTouch: true });
}

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
});

describe('BottomTabBar（M3-3 底部标签栏）', () => {
  it('桌面（isCompact=false）不渲染', () => {
    const { container } = render(<BottomTabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('紧凑视口渲染帮助/控制/投喂三入口 + 巡游区', () => {
    setCompact();
    render(<BottomTabBar />);
    expect(screen.getByRole('button', { name: '打开操作引导' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开控制面板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开投喂与合作面板' })).toBeInTheDocument();
    // 巡游区（默认 solar 域多成员序列 → 箭头可见）
    expect(screen.getByRole('button', { name: '上一个天体（快捷键 [）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一个天体（快捷键 ]）' })).toBeInTheDocument();
  });

  it('三入口开合互斥：同钮再点关闭、异钮切换', () => {
    setCompact();
    render(<BottomTabBar />);
    const help = screen.getByRole('button', { name: '打开操作引导' });
    const controls = screen.getByRole('button', { name: '打开控制面板' });
    fireEvent.click(help);
    expect(useSimulationStore.getState().mobilePanel).toBe('help');
    expect(help).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(controls);
    expect(useSimulationStore.getState().mobilePanel).toBe('controls');
    expect(help).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(controls);
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });
});

describe('ControlPanel 抽屉化（M3-1）', () => {
  it('紧凑视口默认收起（aria-hidden），mobilePanel=controls 展开', () => {
    setCompact();
    const { container } = render(<ControlPanel />);
    const drawer = container.firstElementChild;
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    act(() => {
      useSimulationStore.getState().setMobilePanel('controls');
    });
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
    // 抽屉内容完整（视角格示例）
    expect(screen.getByRole('button', { name: '行星视角' })).toBeInTheDocument();
  });

  it('抽屉内 ✕ 关闭（写回 mobilePanel=null）', () => {
    setCompact();
    useSimulationStore.setState({ mobilePanel: 'controls' });
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole('button', { name: '收起控制面板' }));
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });

  it('紧凑视口显示开关仍为 checkbox 语义（toggle switch 视觉层）', () => {
    setCompact();
    useSimulationStore.setState({ mobilePanel: 'controls' });
    render(<ControlPanel />);
    const orbits = screen.getByRole('checkbox', { name: /轨道线（O）/ });
    fireEvent.click(orbits);
    expect(useSimulationStore.getState().showOrbits).toBe(false);
  });

  it('桌面保持左上面板 + 把手（回归，左下角布局收口：定位由 LeftColumn 提供）', () => {
    const { container } = render(<LeftColumn />);
    expect(container.querySelector('.bottom-4.left-4.top-4')).not.toBeNull();
    expect(container.querySelector('.w-64')).not.toBeNull();
    expect(screen.getByRole('button', { name: '收起控制面板' })).toBeInTheDocument();
  });
});

describe('HelpHint 弹层化（M3-3）', () => {
  it('紧凑视口默认不渲染；mobilePanel=help 呈居中弹层并可关闭', () => {
    setCompact();
    const { container } = render(<HelpHint />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      useSimulationStore.getState().setMobilePanel('help');
    });
    // M4-5：isTouch 下首段为触屏口径（setCompact 置 isTouch=true）
    expect(screen.getByText(/点按选中天体/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭引导' }));
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });

  it('桌面首屏悬浮卡照常（回归）', () => {
    render(<HelpHint />);
    expect(screen.getByText(/点击行星查看信息/)).toBeInTheDocument();
  });
});

describe('ContactBadge 弹层化（M3-3，对外入口同源纪律）', () => {
  it('紧凑视口默认不渲染；mobilePanel=contact 呈居中弹层含同源链接', () => {
    setCompact();
    const { container } = render(<ContactBadge />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      useSimulationStore.getState().setMobilePanel('contact');
    });
    // 同源常量呈现：邮箱 + 爱发电 + Issues + 捐赠页
    expect(screen.getByText(new RegExp(CONTACT_EMAIL))).toBeInTheDocument();
    expect(screen.getByText(/爱发电赞助支持/)).toBeInTheDocument();
    expect(screen.getByText(/GitHub Issues/)).toBeInTheDocument();
    expect(screen.getByText(/投喂燃料/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭投喂与合作面板' }));
    expect(useSimulationStore.getState().mobilePanel).toBeNull();
  });

  it('桌面左下角标照常（回归）', () => {
    render(<ContactBadge />);
    expect(screen.getByRole('button', { name: /商业合作/ })).toBeInTheDocument();
  });
});

describe('HudStatusPanel 顶部状态条（M3-2）', () => {
  it('紧凑视口渲染暂停按钮 + tap 展开详情', () => {
    setCompact();
    render(<HudInfo />);
    // 单行状态条：暂停按钮可用
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(useSimulationStore.getState().paused).toBe(true);
    // 展开详情后出现尺度行
    const expand = screen.getByRole('button', { name: '展开状态详情' });
    fireEvent.click(expand);
    expect(screen.getByText(/当前尺度：/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起状态详情' }));
    expect(screen.queryByText(/当前尺度：/)).not.toBeInTheDocument();
  });
});

describe('底部卡区互斥（M3-2：特征卡 > 剖面卡 > 信息面板）', () => {
  const feature = {
    kind: 'sunspot' as const,
    titleZh: '黑子群测试',
    titleEn: 'Sunspot test',
    descZh: '描述',
    descEn: 'desc',
    earthCount: 10,
  };

  // 左下角布局收口：SunLayerCard 挂载点迁至 LeftColumn，互斥逻辑仍在
  // 卡片组件内部——测试同挂 HudInfo + SunLayerCard 还原运行时组合
  it('三者同时触发：仅太阳特征卡可见', () => {
    setCompact();
    useSimulationStore.setState({
      selectedBodyId: 'sun',
      sunCutawayMode: true,
      sunCutawayLayer: 'core',
      selectedSolarFeature: feature,
    });
    render(
      <>
        <HudInfo />
        <SunLayerCard />
      </>,
    );
    expect(screen.getByText('黑子群测试')).toBeInTheDocument();
    // 剖面卡与信息面板让位（范围行/飞往按钮不出现）
    expect(screen.queryByText('范围')).not.toBeInTheDocument();
    expect(screen.queryByText(/飞往（F）/)).not.toBeInTheDocument();
  });

  it('关闭特征卡后剖面卡恢复；关闭剖面后信息面板恢复', () => {
    setCompact();
    useSimulationStore.setState({
      selectedBodyId: 'sun',
      sunCutawayMode: true,
      sunCutawayLayer: 'core',
      selectedSolarFeature: feature,
    });
    render(
      <>
        <HudInfo />
        <SunLayerCard />
      </>,
    );
    act(() => {
      useSimulationStore.getState().setSelectedSolarFeature(null);
    });
    expect(screen.getByText('范围')).toBeInTheDocument();
    expect(screen.queryByText(/飞往（F）/)).not.toBeInTheDocument();
    act(() => {
      useSimulationStore.getState().setSunCutawayLayer(null);
    });
    expect(screen.getByText(/飞往（F）/)).toBeInTheDocument();
  });

  it('桌面三区并存（回归，互斥仅移动布局）', () => {
    useSimulationStore.setState({
      selectedBodyId: 'sun',
      sunCutawayMode: true,
      sunCutawayLayer: 'core',
      selectedSolarFeature: feature,
    });
    render(
      <>
        <HudInfo />
        <SunLayerCard />
      </>,
    );
    expect(screen.getByText('黑子群测试')).toBeInTheDocument();
    expect(screen.getByText('范围')).toBeInTheDocument();
    expect(screen.getByText(/飞往（F）/)).toBeInTheDocument();
  });
});

describe('BodyInfoPanel 底部半屏卡（M3-2）', () => {
  it('下滑手势（位移 > 阈值）关闭面板', () => {
    setCompact();
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    render(<HudInfo />);
    const handle = screen.getByRole('button', { name: '下滑关闭面板' });
    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(handle, { changedTouches: [{ clientY: 200 }] });
    expect(useSimulationStore.getState().selectedBodyId).toBeNull();
  });

  it('下滑位移不足阈值不关闭', () => {
    setCompact();
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    render(<HudInfo />);
    const handle = screen.getByRole('button', { name: '下滑关闭面板' });
    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(handle, { changedTouches: [{ clientY: 130 }] });
    expect(useSimulationStore.getState().selectedBodyId).toBe('earth');
  });
});

describe('BodyCycleSwitcher（M3-3：并入标签栏）', () => {
  it('紧凑视口不渲染', () => {
    setCompact();
    const { container } = render(<BodyCycleSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('桌面照常渲染（回归）', () => {
    render(<BodyCycleSwitcher />);
    expect(screen.getByRole('button', { name: '上一个天体（快捷键 [）' })).toBeInTheDocument();
  });
});
