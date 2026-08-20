/**
 * 文化史折叠卡单测（LE-M6-1，需求 §3.3 + B10）：
 * - 分区标注常显（「历史记载与神话（非科学解释）」——与物理解释明确分区）；
 * - 默认收起、展开后各文明条目齐备（天狗食月为中文受众首条）；
 * - 钟声按钮为**一次性单发音**：每次点击调用一次 playLunarCultureBell，
 *   且**不触碰声景包络接口**（B10：文化演绎与科学声景分离的机器保证）；
 * - 静音（audioEnabled=false）时钟声钮禁用并给出提示（不越过用户静音意图）；
 * - 触控目标 ≥44pt（max-md:min-h-11）。
 */

import { fireEvent, render, screen } from "@testing-library/react";

import { LunarCultureCard } from "../LunarCultureCard";
import { useSimulationStore } from "@/store";

const playLunarCultureBell = jest.fn();
const setLunarSoundscapeGains = jest.fn();
const playLunarContactChime = jest.fn();

jest.mock("@/components/Audio/audioEngine", () => ({
  getSharedAudioEngine: () => ({
    init: jest.fn(),
    resume: jest.fn().mockResolvedValue(true),
    playLunarCultureBell: (...args: unknown[]) =>
      playLunarCultureBell(...args),
    setLunarSoundscapeGains: (...args: unknown[]) =>
      setLunarSoundscapeGains(...args),
    playLunarContactChime: (...args: unknown[]) =>
      playLunarContactChime(...args),
  }),
}));

beforeEach(() => {
  playLunarCultureBell.mockClear();
  setLunarSoundscapeGains.mockClear();
  playLunarContactChime.mockClear();
  useSimulationStore.setState({ audioEnabled: true, audioVolume: 0.8 });
});

afterAll(() => {
  useSimulationStore.setState({ audioEnabled: false, audioVolume: 0.8 });
});

describe("LunarCultureCard 文化史折叠卡", () => {
  it("分区标注常显（与科学内容明确分区，§3.3）", () => {
    render(<LunarCultureCard />);
    expect(
      screen.getByText("历史记载与神话（非科学解释）"),
    ).toBeInTheDocument();
  });

  it("默认收起；展开后五条文明记载齐备且天狗食月在首", () => {
    render(<LunarCultureCard />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(screen.queryByText(/天狗食月/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toMatch(/天狗食月/);
    expect(screen.getByText(/罗睺/)).toBeInTheDocument();
    expect(screen.getByText(/美洲豹/)).toBeInTheDocument();
    expect(screen.getByText(/替身王/)).toBeInTheDocument();
    expect(screen.getByText(/Hati/)).toBeInTheDocument();
  });

  it("钟声为一次性单发音，且不触碰声景包络接口（B10 分离）", () => {
    render(<LunarCultureCard />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const bell = screen.getByRole("button", {
      name: "播放一声文化演绎钟声",
    });
    fireEvent.click(bell);
    expect(playLunarCultureBell).toHaveBeenCalledTimes(1);
    expect(playLunarCultureBell).toHaveBeenCalledWith(0.8);
    fireEvent.click(bell);
    expect(playLunarCultureBell).toHaveBeenCalledTimes(2);
    // 科学声景链零调用（文化演绎不进包络、不随时间轴出声）
    expect(setLunarSoundscapeGains).not.toHaveBeenCalled();
    expect(playLunarContactChime).not.toHaveBeenCalled();
  });

  it("卡内注明钟声为文化演绎（B10 用户可见登记）", () => {
    render(<LunarCultureCard />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/钟声为文化演绎（B10 登记）/)).toBeInTheDocument();
  });

  it("静音态：钟声钮禁用 + 引导先开声音，点击不出声", () => {
    useSimulationStore.setState({ audioEnabled: false });
    render(<LunarCultureCard />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const bell = screen.getByRole("button", {
      name: "播放一声文化演绎钟声",
    });
    expect(bell).toBeDisabled();
    fireEvent.click(bell);
    expect(playLunarCultureBell).not.toHaveBeenCalled();
    expect(screen.getByText(/先在面板「声景」区打开声音/)).toBeInTheDocument();
  });

  it("音量随全局 store（静音链同一事实源）", () => {
    useSimulationStore.setState({ audioVolume: 0.35 });
    render(<LunarCultureCard />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(
      screen.getByRole("button", { name: "播放一声文化演绎钟声" }),
    );
    expect(playLunarCultureBell).toHaveBeenCalledWith(0.35);
  });

  it("折叠钮与钟声钮均为 ≥44pt 触控目标（max-md:min-h-11）", () => {
    render(<LunarCultureCard />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.className).toContain("max-md:min-h-11");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "播放一声文化演绎钟声" }).className,
    ).toContain("max-md:min-h-11");
  });
});
