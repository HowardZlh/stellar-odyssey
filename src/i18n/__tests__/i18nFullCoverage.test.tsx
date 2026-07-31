/**
 * i18n 全站覆盖测试（3D 标签 + 数据层值行 + 动态文案 + P2 页面）
 *
 * 既有 zh 默认态断言零改动（各数据/工具测试不动），本文件另立覆盖：
 * - pickLocalized 收口函数
 * - getBodyInfoById(id, 'en') 英文目录（值行无中文残留的全量扫描）
 * - merger/solarCycle/solarActivity/scale/time 动态文案 locale 化
 * - 3D 标签叶组件（BodyNameText / LabelText）双语切换
 * - 404 页双语
 */

import { act, render, screen } from '@testing-library/react';

import { pickLocalized, t, tf } from '@/i18n';
import { useSimulationStore } from '@/store';
import { getBodyInfoById } from '@/data/catalog';
import { PLANETS, SUN } from '@/data/planets';
import { MOONS } from '@/data/moons';
import { COMETS, DWARF_PLANETS } from '@/data/smallBodies';
import { LOCAL_GROUP_GALAXIES, MILKY_WAY } from '@/data/galaxies';
import { SPECIAL_BODIES } from '@/data/specialBodies';
import {
  mergerNotice,
  mergerStageLabel,
  mergerStageLabelZh,
  MERGER_T0_MYR,
} from '@/utils/galaxyMerger';
import { DAYS_PER_MYR } from '@/utils/galaxy';
import { solarCycleState, solarCycleStatusLine } from '@/utils/solarCycle';
import { sunActivityStatusLines } from '@/utils/solarActivity';
import { formatScaleLabel, formatSceneScaleLabel } from '@/utils/scale';
import { formatSimDate } from '@/utils/time';
import {
  gradationPercentText,
  gradationProgressLabel,
} from '@/utils/galacticMotionCues';
import { BodyNameText, LabelText } from '@/components/Scene/LocalizedLabelText';
import NotFound from '@/app/not-found';

const CJK_RE = /[\u4e00-\u9fff]/;

const initialState = useSimulationStore.getState();

afterEach(() => {
  useSimulationStore.setState(initialState, true);
  window.localStorage.clear();
  document.documentElement.lang = 'zh-CN';
});

describe('pickLocalized（双语字段选择收口）', () => {
  it('zh 态恒返回中文；en 态取英文字段、缺失/空串回退中文', () => {
    expect(pickLocalized('zh', '中文', 'English')).toBe('中文');
    expect(pickLocalized('en', '中文', 'English')).toBe('English');
    expect(pickLocalized('en', '中文', undefined)).toBe('中文');
    expect(pickLocalized('en', '中文', '')).toBe('中文');
  });
});

describe('getBodyInfoById 英文目录（i18n 全站覆盖）', () => {
  it('zh 默认签名不变：既有中文值行逐字节等价', () => {
    const earth = getBodyInfoById('earth')!;
    expect(earth.lines.find((l) => l.label === '公转周期')!.value).toContain('年');
    const venus = getBodyInfoById('venus')!;
    expect(venus.lines.find((l) => l.label === '自转周期')!.value).toContain('（逆向）');
  });

  it('en 目录：行星周期/自转单位与逆向标注为英文', () => {
    const earth = getBodyInfoById('earth', 'en')!;
    expect(earth.lines.find((l) => l.label === '公转周期')!.value).toContain('yr');
    const venus = getBodyInfoById('venus', 'en')!;
    expect(venus.lines.find((l) => l.label === '自转周期')!.value).toContain('(retrograde)');
  });

  it('en 目录：卫星备注/星系描述/特殊天体动态效果取英文字段', () => {
    const tiangong = getBodyInfoById('tiangong', 'en')!;
    const note = tiangong.lines.find((l) => l.label === '备注')!.value;
    expect(CJK_RE.test(note)).toBe(false);

    const m31 = getBodyInfoById('m31', 'en')!;
    const desc = m31.lines.find((l) => l.label === '描述')!.value;
    expect(CJK_RE.test(desc)).toBe(false);
    expect(desc).toMatch(/Milky Way|Local Group/);

    const betelgeuse = getBodyInfoById('betelgeuse', 'en')!;
    const dynamics = betelgeuse.lines.find((l) => l.label === '动态效果')!.value;
    expect(CJK_RE.test(dynamics)).toBe(false);
  });

  it('en 目录：太阳/银河系/旅行者/超新星条目值行为英文', () => {
    const sun = getBodyInfoById('sun', 'en')!;
    expect(sun.lines.find((l) => l.label === '结构分层')!.value).toContain('Core');

    const mw = getBodyInfoById('milky-way', 'en')!;
    expect(mw.lines.find((l) => l.label === '主旋臂')!.value).toContain('Perseus Arm');

    const v1 = getBodyInfoById('voyager-1', 'en')!;
    expect(v1.lines.find((l) => l.label === '发射')!.value).toBe('September 5, 1977');

    const sn = getBodyInfoById('sn-1', 'en')!;
    expect(sn.lines.find((l) => l.label === '阶段')!.value).toContain('Brightening');
  });

  it('en 目录全量扫描：全部条目值行无中文残留（标签列/类型行除外）', () => {
    const ids = [
      SUN.id,
      ...PLANETS.map((p) => p.id),
      ...DWARF_PLANETS.map((d) => d.id),
      ...MOONS.map((m) => m.id),
      ...COMETS.map((c) => c.id),
      ...LOCAL_GROUP_GALAXIES.map((g) => g.id),
      ...SPECIAL_BODIES.map((b) => b.id),
      MILKY_WAY.id,
      'oort-cloud',
      'heliopause',
      'voyager-1',
      'voyager-2',
    ];
    for (const id of ids) {
      const info = getBodyInfoById(id, 'en');
      expect(info).toBeDefined();
      for (const line of info!.lines) {
        expect({ id, label: line.label, hasCjk: CJK_RE.test(line.value) }).toEqual({
          id,
          label: line.label,
          hasCjk: false,
        });
      }
    }
  });
});

describe('动态文案 locale 化（merger / solarCycle / solarActivity / scale / time）', () => {
  const mergedSimDays = (MERGER_T0_MYR + 500) * DAYS_PER_MYR;

  it('mergerStageLabel：zh 与既有 mergerStageLabelZh 等价，en 为英文', () => {
    expect(mergerStageLabel('zh', mergedSimDays)).toBe(mergerStageLabelZh(mergedSimDays));
    expect(mergerStageLabel('en', mergedSimDays)).toContain('Milkomeda');
    expect(mergerStageLabel('en', 0)).toBeNull();
  });

  it('mergerNotice：按 locale 返回 stageText', () => {
    expect(mergerNotice('zh', mergedSimDays)!.stageText).toContain('并合完成');
    expect(mergerNotice('en', mergedSimDays)!.stageText).toContain('Merger complete');
    expect(mergerNotice('en', 0)).toBeNull();
  });

  it('solarCycleStatusLine：label 恒为中文键，value 按 locale', () => {
    const state = solarCycleState(0);
    const zh = solarCycleStatusLine(state);
    const en = solarCycleStatusLine(state, 'en');
    expect(zh.label).toBe('活动周期');
    expect(en.label).toBe('活动周期');
    expect(zh.value).toContain('第');
    expect(en.value).toMatch(/^Cycle \d+/);
    expect(CJK_RE.test(en.value)).toBe(false);
  });

  it('sunActivityStatusLines：耀斑/CME/平静三态英文', () => {
    const flare = sunActivityStatusLines({ class: 'X', magnitude: 2.3 }, null, 'en');
    expect(flare[0].value).toContain('magnetic reconnection');
    const cme = sunActivityStatusLines(null, { speedKmS: 800, earthDirected: true }, 'en');
    expect(cme[0].value).toContain('Earth-directed');
    const quiet = sunActivityStatusLines(null, null, 'en');
    expect(quiet[0].value).toContain('Quiet');
    // zh 默认签名不变
    expect(sunActivityStatusLines(null, null)[0].value).toContain('平静');
  });

  it('formatScaleLabel / formatSceneScaleLabel：光年单位按 locale', () => {
    const lyAu = 63241.07708 * 10; // 10 光年对应 AU
    expect(formatScaleLabel(lyAu)).toContain('光年');
    expect(formatScaleLabel(lyAu, 'en')).toContain('ly');
    expect(formatSceneScaleLabel(1000, 3.0, 'en')).toContain('ly');
  });

  it('formatSimDate：超远期单位按 locale（近期日期语言无关）', () => {
    const farDays = 1e9 * 365.25;
    expect(formatSimDate(farDays)).toContain('百万年');
    expect(formatSimDate(farDays, 'en')).toContain('Myr');
    expect(formatSimDate(0, 'en')).toContain('2000-01-01');
  });

  it('gradationPercentText 与既有 gradationProgressLabel 等价拆分', () => {
    expect(gradationPercentText(6)).toBe('25');
    expect(gradationProgressLabel(6)).toBe('银河年 25%');
    expect(tf('en', 'sceneLabel.galacticYearPercent', { percent: gradationPercentText(6) })).toBe(
      'Galactic year 25%',
    );
  });
});

describe('3D 标签叶组件（BodyNameText / LabelText）', () => {
  it('BodyNameText：zh 取 nameZh、en 取 name、无英文名回退中文', () => {
    const body = { name: 'Earth', nameZh: '地球' };
    const { rerender } = render(<span data-testid="n"><BodyNameText body={body} /></span>);
    expect(screen.getByTestId('n').textContent).toBe('地球');
    useSimulationStore.setState({ locale: 'en' });
    rerender(<span data-testid="n"><BodyNameText body={body} /></span>);
    expect(screen.getByTestId('n').textContent).toBe('Earth');
    rerender(<span data-testid="n"><BodyNameText body={{ nameZh: '仅中文' }} /></span>);
    expect(screen.getByTestId('n').textContent).toBe('仅中文');
  });

  it('LabelText：字典键按 locale 渲染（含参数插值）', () => {
    render(
      <span data-testid="l">
        <LabelText k="sceneLabel.terminationShock" params={{ au: 94 }} />
      </span>,
    );
    expect(screen.getByTestId('l').textContent).toBe(t('zh', 'sceneLabel.terminationShock').replace('{au}', '94'));
    act(() => {
      useSimulationStore.setState({ locale: 'en' });
    });
    expect(screen.getByTestId('l').textContent).toBe('Termination shock (schematic, ~94 AU)');
  });
});

describe('404 页双语（P2）', () => {
  it('en 态标题/正文/按钮为英文（useLocaleInit 按 localStorage 解析）', () => {
    window.localStorage.setItem('stellar-odyssey:locale', 'en');
    render(<NotFound />);
    expect(
      screen.getByText('You have drifted beyond the known universe'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Return to the star map now' }),
    ).toBeInTheDocument();
  });
});
