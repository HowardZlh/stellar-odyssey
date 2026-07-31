/**
 * B3 UI 壳层迁移新增纯函数单测：tf 插值 / localizeCatalogText 标签映射 /
 * displayBodyName 取名收口 / catalogText 映射完备性（zh/en 键集合一致性
 * 已由 i18nB2.test.ts 拍平核对覆盖，新增键自动纳入）。
 */

import {
  SCOPE_NAME_KEYS,
  VIEW_LEVEL_NAME_KEYS,
  displayBodyName,
  localizeCatalogText,
  t,
  tf,
  zh,
} from '@/i18n';
import { getBodyInfoById } from '@/data/catalog';
import { SCOPE_NAME_ZH } from '@/utils/cycleScopes';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { VIEW_LEVELS } from '@/types';

describe('tf 参数插值（B3）', () => {
  it('替换全部占位符（字符串与数字参数）', () => {
    expect(tf('zh', 'hud.simTime', { value: '2026-01-01' })).toBe('模拟时间：2026-01-01');
    expect(tf('en', 'controlPanel.cmeActive', { speed: 850 })).toBe(
      'CME in progress (850 km/s)…',
    );
  });

  it('同一键 zh/en 可用不同占位符子集（mergerTau 的 {yi}/{myr}）', () => {
    const params = { yi: '3.0', myr: 300 };
    expect(tf('zh', 'hud.mergerTau', params)).toBe('（合并时刻后约 3.0 亿年）');
    expect(tf('en', 'hud.mergerTau', params)).toBe(' (~300 Myr after the merger moment)');
  });

  it('未提供的占位符原样保留（防御性，便于发现漏传）', () => {
    expect(tf('zh', 'hud.followMode', {})).toBe('跟随模式：{name}');
  });

  it('多占位符逐一替换（galacticYear 五参数）', () => {
    const text = tf('zh', 'hud.galacticYear', {
      orbit: 2,
      percent: '15.0',
      deg: '414',
      sign: '+',
      height: '120',
    });
    expect(text).toBe('银河年进度：第 2 圈 15.0%（绕行 414°）｜银盘面高度 +120 ly');
  });
});

describe('localizeCatalogText 标签/类型映射（B3 方案 K3）', () => {
  it('zh 态零开销直返原文（含未收录条目）', () => {
    expect(localizeCatalogText('zh', '质量')).toBe('质量');
    expect(localizeCatalogText('zh', '未收录标签')).toBe('未收录标签');
  });

  it('en 态映射常用标签与类型', () => {
    expect(localizeCatalogText('en', '质量')).toBe('Mass');
    expect(localizeCatalogText('en', '半径')).toBe('Radius');
    expect(localizeCatalogText('en', '公转周期')).toBe('Orbital period');
    expect(localizeCatalogText('en', '行星')).toBe('Planet');
    expect(localizeCatalogText('en', '棒旋星系')).toBe('Barred spiral galaxy');
  });

  it('en 态未收录条目回退中文原文（豁免登记口径）', () => {
    expect(localizeCatalogText('en', '未收录标签')).toBe('未收录标签');
  });

  it('全量目录标签列与类型行均有 en 映射（纯 ASCII 标签豁免）', () => {
    // 遍历目录代表性条目（行星/矮行星/卫星/彗星/星系/特殊天体/结构/太阳）
    const ids = [
      'sun',
      'earth',
      'pluto',
      'moon',
      'halley',
      'm31',
      'milky-way',
      'sgr-a-star',
      'crab-pulsar',
      'oort-cloud',
      'heliopause',
      'voyager-1',
    ];
    const hasCjk = (s: string): boolean => /[\u4e00-\u9fff]/.test(s);
    for (const id of ids) {
      const info = getBodyInfoById(id);
      expect(info).toBeDefined();
      if (!info) continue;
      if (hasCjk(info.typeZh)) {
        expect(localizeCatalogText('en', info.typeZh)).not.toBe(info.typeZh);
      }
      for (const line of info.lines) {
        if (!hasCjk(line.label)) continue; // 纯 ASCII 标签（如 M87*）无需映射
        expect(`${line.label}→${localizeCatalogText('en', line.label)}`).not.toBe(
          `${line.label}→${line.label}`,
        );
      }
    }
  });
});

describe('displayBodyName 取名收口（B3-C）', () => {
  it('zh 取 nameZh、en 取 name', () => {
    const earth = getBodyInfoById('earth');
    expect(displayBodyName('zh', earth)).toBe('地球');
    expect(displayBodyName('en', earth)).toBe('Earth');
  });

  it('行星/卫星/星系/特殊天体双语正确（en 为既有 name 英文字段）', () => {
    const ids = ['mercury', 'moon', 'm31', 'lmc', 'sgr-a-star', 'orion-nebula'];
    for (const id of ids) {
      const info = getBodyInfoById(id);
      expect(info).toBeDefined();
      if (!info) continue;
      expect(displayBodyName('zh', info)).toBe(info.nameZh);
      expect(displayBodyName('en', info)).toBe(info.name);
      // en 显示名不含 CJK（name 字段为英文的前提核对）
      expect(displayBodyName('en', info)).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('无英文名回退中文；body 缺失回退 fallback（默认空串）', () => {
    expect(displayBodyName('en', { nameZh: '仅中文' })).toBe('仅中文');
    expect(displayBodyName('en', { name: '', nameZh: '空英文名' })).toBe('空英文名');
    expect(displayBodyName('en', undefined, 'fallback-id')).toBe('fallback-id');
    expect(displayBodyName('zh', null)).toBe('');
  });
});

describe('共享键映射表与既有中文常量同源（B3 零回退核对）', () => {
  it('VIEW_LEVEL_NAME_KEYS 的 zh 值与 CAMERA_VIEWS.nameZh 一致', () => {
    for (const level of VIEW_LEVELS) {
      expect(t('zh', VIEW_LEVEL_NAME_KEYS[level])).toBe(CAMERA_VIEWS[level].nameZh);
    }
  });

  it('SCOPE_NAME_KEYS 的 zh 值与 SCOPE_NAME_ZH 一致', () => {
    for (const scope of ['system', 'solar', 'galaxy', 'universe'] as const) {
      expect(t('zh', SCOPE_NAME_KEYS[scope])).toBe(SCOPE_NAME_ZH[scope]);
    }
  });

  it('catalogText 组 zh 侧为恒等映射（键=中文原文）', () => {
    for (const [key, value] of Object.entries(zh.catalogText)) {
      expect(value).toBe(key);
    }
  });
});
