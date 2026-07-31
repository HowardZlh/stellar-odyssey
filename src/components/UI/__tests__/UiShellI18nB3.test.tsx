/**
 * B3 UI 壳层迁移组件单测：六组件双语切换 + ControlPanel 语言切换入口。
 * 既有 zh 默认态断言（各组件既有测试）零改动，另立本文件覆盖 en 态
 * 与切换行为（与 ContactBadgeI18nB2.test.tsx 同模式）。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { useSimulationStore } from '@/store';

import { HelpHint } from '../HelpHint';
import { ControlPanel } from '../ControlPanel';
import { HudInfo } from '../HudInfo';
import { BodyCycleSwitcher } from '../BodyCycleSwitcher';
import { PerformanceMonitor } from '../PerformanceMonitor';
import { LoadingProgress } from '../LoadingProgress';

// LoadingProgress 依赖纹理管理器单例：mock 为"1 项任务加载中"固定进度，
// 使进度条可见（不触发真实纹理加载）
jest.mock('@/components/CelestialBody/textureManager', () => ({
  getTextureManager: () => ({
    getProgress: () => ({ active: true, total: 1, done: 0, percent01: 0.4 }),
    subscribe: () => () => undefined,
  }),
}));

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
  document.documentElement.lang = 'zh-CN';
});

describe('HelpHint 双语（B3 打样件）', () => {
  it('zh 默认态渲染原引导文案 + 新增语言切换说明行', () => {
    render(<HelpHint />);
    expect(screen.getByText(/拖动旋转 · 滚轮缩放 · 右键平移/)).toBeInTheDocument();
    expect(screen.getByText(/恒星闪烁仅行星视角呈现/)).toBeInTheDocument();
    expect(screen.getByText(/语言 Language：左上角面板 zh\/EN/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭引导' })).toBeInTheDocument();
  });

  it('locale=en 时全部文案（含科学说明段）呈英文', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<HelpHint />);
    expect(screen.getByText(/Drag to rotate · Scroll to zoom/)).toBeInTheDocument();
    expect(screen.getByText(/Star twinkling appears only in the planet view/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss the guide' })).toBeInTheDocument();
    expect(screen.queryByText(/拖动旋转/)).not.toBeInTheDocument();
  });
});

describe('ControlPanel 双语 + 语言切换入口（B3-D）', () => {
  it('zh 默认态：标题/分区/开关文案为中文，zh 钮为按下态', () => {
    render(<ControlPanel />);
    expect(screen.getByText('星海奥德赛')).toBeInTheDocument();
    expect(screen.getByText('视角（快捷键 1-4）')).toBeInTheDocument();
    expect(screen.getByText('轨道线（O）')).toBeInTheDocument();
    const zhBtn = screen.getByRole('button', { name: 'zh' });
    expect(zhBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('点击 EN 即时切换（store.setLocale 生效，无需刷新）', () => {
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(useSimulationStore.getState().locale).toBe('en');
    expect(screen.getByText('Stellar Odyssey')).toBeInTheDocument();
    expect(screen.getByText('View (keys 1-4)')).toBeInTheDocument();
    expect(screen.getByText('Orbit lines (O)')).toBeInTheDocument();
    expect(screen.getByText('Display')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    // 切回 zh 双向可逆
    fireEvent.click(screen.getByRole('button', { name: 'zh' }));
    expect(screen.getByText('视角（快捷键 1-4）')).toBeInTheDocument();
  });

  it('en 态视角锚点按钮用英文视角名', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<ControlPanel />);
    expect(screen.getByRole('button', { name: 'Planet View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solar System View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Galaxy View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Universe View' })).toBeInTheDocument();
  });

  it('en 态豁免段（显示开关来源/科学说明）保持中文（登记口径）', () => {
    useSimulationStore.setState({ locale: 'en' });
    useSimulationStore.setState({ realScaleMode: true });
    render(<ControlPanel />);
    // 真实比例开关标签为英文、其下科学说明段留中文
    expect(screen.getByText('Real-scale mode (true body sizes)')).toBeInTheDocument();
    expect(screen.getByText(/真实比例下行星\/矮行星极小/)).toBeInTheDocument();
  });
});

describe('BodyCycleSwitcher 双语（B3-C displayBodyName）', () => {
  it('zh 默认态：域名 + 中文天体名 + 上/下一个', () => {
    render(<BodyCycleSwitcher />);
    expect(screen.getByText('太阳系巡游')).toBeInTheDocument();
    expect(screen.getByText('地球')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一个天体（快捷键 [）' })).toBeInTheDocument();
  });

  it('en 态：域名与天体显示名切英文', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<BodyCycleSwitcher />);
    expect(screen.getByText('Solar System tour')).toBeInTheDocument();
    expect(screen.getByText('Earth')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next body (key ])' })).toBeInTheDocument();
    expect(screen.queryByText('地球')).not.toBeInTheDocument();
  });
});

describe('HudInfo 双语（框架文案 + 事件通知 + 信息面板标签，B3）', () => {
  it('zh 默认态：HUD 框架文案为中文', () => {
    render(<HudInfo />);
    expect(screen.getByText('太阳系视角')).toBeInTheDocument();
    expect(screen.getByText(/^模拟时间：/)).toBeInTheDocument();
    expect(screen.getByText(/^当前尺度：/)).toBeInTheDocument();
    expect(screen.getByText('参考系：日心系（黄道坐标）')).toBeInTheDocument();
  });

  it('en 态：HUD 框架文案切英文', () => {
    useSimulationStore.setState({ locale: 'en' });
    render(<HudInfo />);
    expect(screen.getByText('Solar System View')).toBeInTheDocument();
    expect(screen.getByText(/^Sim time: /)).toBeInTheDocument();
    expect(screen.getByText(/^Scale: /)).toBeInTheDocument();
    expect(screen.getByText('Frame: heliocentric (ecliptic coordinates)')).toBeInTheDocument();
  });

  it('en 态信息面板：标题为英文名、标签列英文、值行留中文（登记口径）', () => {
    useSimulationStore.setState({ locale: 'en', selectedBodyId: 'earth' });
    render(<HudInfo />);
    // 标题：en 仅英文名（hud.bodyTitle 实现差异登记）
    expect(screen.getByText('Earth')).toBeInTheDocument();
    expect(screen.queryByText(/地球（Earth）/)).not.toBeInTheDocument();
    // 类型行与标签列映射
    expect(screen.getByText('Planet')).toBeInTheDocument();
    expect(screen.getByText('Mass')).toBeInTheDocument();
    expect(screen.getByText('Orbital period')).toBeInTheDocument();
    // 值行留中文/原样（如公转周期 "1 年"）
    expect(screen.getByText(/^Data source: /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close info panel' })).toBeInTheDocument();
    expect(screen.getByText(/Fly to \(F\)/)).toBeInTheDocument();
  });

  it('zh 信息面板与迁移前等价：标题中英并列 + 中文标签', () => {
    useSimulationStore.setState({ selectedBodyId: 'earth' });
    render(<HudInfo />);
    expect(screen.getByText('地球（Earth）')).toBeInTheDocument();
    expect(screen.getByText('行星')).toBeInTheDocument();
    expect(screen.getByText('质量')).toBeInTheDocument();
    expect(screen.getByText(/^数据来源：/)).toBeInTheDocument();
  });

  it('超新星事件通知双语（en 态标题/正文/按钮切英文，*_ZH 注记留中文）', () => {
    act(() => {
      useSimulationStore.setState({ locale: 'en', viewLevel: 'L3' });
      useSimulationStore
        .getState()
        .triggerSupernova({ x: 1000, y: 0, z: 1000 }, 20, 30);
    });
    render(<HudInfo />);
    expect(screen.getByText(/Supernova!/)).toBeInTheDocument();
    expect(screen.getByText(/Core-collapse supernova detected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fly to watch/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('超新星事件通知 zh 态与迁移前等价', () => {
    act(() => {
      useSimulationStore.setState({ viewLevel: 'L3' });
      useSimulationStore
        .getState()
        .triggerSupernova({ x: 1000, y: 0, z: 1000 }, 20, 30);
    });
    render(<HudInfo />);
    expect(screen.getByText(/超新星爆发！/)).toBeInTheDocument();
    expect(
      screen.getByText(/银河系旋臂内探测到核坍缩超新星（前身星约 20 倍太阳质量）/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /飞往观看/ })).toBeInTheDocument();
  });
});

describe('PerformanceMonitor 双语', () => {
  it('zh 默认态：性能监控/统计中/不可用', () => {
    useSimulationStore.setState({ showPerformance: true });
    render(<PerformanceMonitor />);
    expect(screen.getByText('性能监控')).toBeInTheDocument();
    expect(screen.getByText('帧率：统计中…')).toBeInTheDocument();
    expect(screen.getByText('内存：不可用')).toBeInTheDocument();
  });

  it('en 态：Performance/Measuring/N-A', () => {
    useSimulationStore.setState({ showPerformance: true, locale: 'en' });
    render(<PerformanceMonitor />);
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('FPS: Measuring…')).toBeInTheDocument();
    expect(screen.getByText('Memory: N/A')).toBeInTheDocument();
  });
});

describe('LoadingProgress 双语', () => {
  it('加载进行中 zh 标题 + 百分比', () => {
    render(<LoadingProgress />);
    expect(screen.getByText('加载纹理资源')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('切换 en 即时更新标题', () => {
    render(<LoadingProgress />);
    act(() => {
      useSimulationStore.getState().setLocale('en');
    });
    expect(screen.getByText('Loading textures')).toBeInTheDocument();
    expect(screen.queryByText('加载纹理资源')).not.toBeInTheDocument();
  });
});
