/**
 * 贡献者宇宙纯逻辑单测（C1，REQUIREMENTS_CONTRIBUTORS.md §C1）：
 * - amountToVisual：对数映射端点/clamp/防御、同额同输出、单调性
 * - resolveRefMaxCny：空名单基准、¥1000 下限
 * - hashStringFnv1a / donorSeedKey：确定性、区分度
 * - layoutContributorStars：同输入逐位相等、追加记录不挪既有星、
 *   顺序无关、碰撞微扰确定性（含重试耗尽路径）、属性区间
 */

import type { DonorRecord } from '@/utils/donors';
import {
  CLUSTER_RADIUS_MAX,
  CLUSTER_RADIUS_SIGMA,
  CONTRIBUTOR_STAR_COLORS,
  MAX_PERTURB_ATTEMPTS,
  MIN_STAR_DISTANCE,
  REF_MAX_CNY_FLOOR,
  STAR_BRIGHTNESS_MAX,
  STAR_BRIGHTNESS_MIN,
  STAR_SCALE_MAX,
  STAR_SCALE_MIN,
  amountToVisual,
  donorSeedKey,
  hashStringFnv1a,
  layoutContributorStars,
  resolveRefMaxCny,
} from '@/utils/contributorUniverse';
import {
  TWINKLE_AMP_MAX,
  TWINKLE_AMP_MIN,
  TWINKLE_FREQ_MAX_HZ,
  TWINKLE_FREQ_MIN_HZ,
} from '@/utils/starTwinkle';

function makeDonor(overrides: Partial<DonorRecord> & { name: string }): DonorRecord {
  return {
    amountCny: 50,
    platform: 'afdian',
    date: '2026-08-01',
    ...overrides,
  };
}

const DONORS_FIXTURE: readonly DonorRecord[] = [
  makeDonor({ name: '彗星', amountCny: 10, platform: 'wechat' }),
  makeDonor({ name: '流星', amountCny: 66, platform: 'kofi', message: '加油' }),
  makeDonor({ name: 'Nova', amountCny: 500 }),
  makeDonor({ name: '超新星', amountCny: 1000 }),
  makeDonor({ name: 'Pulsar', amountCny: 5, platform: 'github-sponsors' }),
];

describe('amountToVisual', () => {
  it('amount=0 → 区间下限端点', () => {
    const v = amountToVisual(0, REF_MAX_CNY_FLOOR);
    expect(v.scale).toBe(STAR_SCALE_MIN);
    expect(v.brightness).toBe(STAR_BRIGHTNESS_MIN);
  });

  it('amount=refMax → 区间上限端点', () => {
    const v = amountToVisual(REF_MAX_CNY_FLOOR, REF_MAX_CNY_FLOOR);
    expect(v.scale).toBeCloseTo(STAR_SCALE_MAX, 10);
    expect(v.brightness).toBeCloseTo(STAR_BRIGHTNESS_MAX, 10);
  });

  it('amount>refMax → clamp 到上限', () => {
    const v = amountToVisual(99999, REF_MAX_CNY_FLOOR);
    expect(v.scale).toBe(STAR_SCALE_MAX);
    expect(v.brightness).toBe(STAR_BRIGHTNESS_MAX);
  });

  it('负数金额防御性 clamp 到下限', () => {
    const v = amountToVisual(-50, REF_MAX_CNY_FLOOR);
    expect(v.scale).toBe(STAR_SCALE_MIN);
    expect(v.brightness).toBe(STAR_BRIGHTNESS_MIN);
  });

  it('refMax 非法（0/负）时防御不产生 NaN', () => {
    const v = amountToVisual(10, 0);
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(v.scale).toBe(STAR_SCALE_MAX); // amount > safeRefMax=1 → clamp 上限
    const v2 = amountToVisual(0, -5);
    expect(v2.scale).toBe(STAR_SCALE_MIN);
  });

  it('同额同输出（纯函数稳定性）', () => {
    expect(amountToVisual(66, 1000)).toEqual(amountToVisual(66, 1000));
  });

  it('对数映射单调：¥10 < ¥1000，且最低档仍可见（brightness ≥ 下限 > 0）', () => {
    const small = amountToVisual(10, 1000);
    const big = amountToVisual(1000, 1000);
    expect(small.scale).toBeLessThan(big.scale);
    expect(small.brightness).toBeLessThan(big.brightness);
    expect(amountToVisual(5, 10000).brightness).toBeGreaterThanOrEqual(STAR_BRIGHTNESS_MIN);
    expect(STAR_BRIGHTNESS_MIN).toBeGreaterThan(0);
  });
});

describe('resolveRefMaxCny', () => {
  it('空名单取 ¥1000 基准', () => {
    expect(resolveRefMaxCny([])).toBe(REF_MAX_CNY_FLOOR);
  });

  it('名单最大金额低于基准时取基准（只有一笔 ¥5 不出满档巨星）', () => {
    expect(resolveRefMaxCny([makeDonor({ name: 'a', amountCny: 5 })])).toBe(REF_MAX_CNY_FLOOR);
  });

  it('名单最大金额高于基准时取名单最大值', () => {
    expect(resolveRefMaxCny(DONORS_FIXTURE)).toBe(REF_MAX_CNY_FLOOR);
    const withBig = [...DONORS_FIXTURE, makeDonor({ name: 'whale', amountCny: 8000 })];
    expect(resolveRefMaxCny(withBig)).toBe(8000);
  });
});

describe('hashStringFnv1a / donorSeedKey', () => {
  it('同串恒定同值、异串区分', () => {
    expect(hashStringFnv1a('彗星|wechat')).toBe(hashStringFnv1a('彗星|wechat'));
    expect(hashStringFnv1a('彗星|wechat')).not.toBe(hashStringFnv1a('彗星|afdian'));
    expect(hashStringFnv1a('')).toBe(0x811c9dc5); // FNV-1a 空串 = offset basis
  });

  it('donorSeedKey = name|platform', () => {
    expect(donorSeedKey({ name: '彗星', platform: 'wechat' })).toBe('彗星|wechat');
  });
});

describe('layoutContributorStars：确定性', () => {
  it('同输入两次调用逐位相等', () => {
    const a = layoutContributorStars(DONORS_FIXTURE);
    const b = layoutContributorStars(DONORS_FIXTURE);
    expect(a).toEqual(b);
    a.forEach((star, i) => {
      expect(star.position[0]).toBe(b[i].position[0]);
      expect(star.position[1]).toBe(b[i].position[1]);
      expect(star.position[2]).toBe(b[i].position[2]);
    });
  });

  it('追加记录后既有星坐标/属性逐位不变', () => {
    const before = layoutContributorStars(DONORS_FIXTURE);
    const after = layoutContributorStars([
      ...DONORS_FIXTURE,
      makeDonor({ name: '新来的旅人', amountCny: 300, platform: 'buymeacoffee' }),
    ]);
    before.forEach((star, i) => {
      expect(after[i].position).toEqual(star.position);
      expect(after[i].color).toBe(star.color);
      expect(after[i].twinklePhase).toBe(star.twinklePhase);
      expect(after[i].twinkleFreq).toBe(star.twinkleFreq);
      expect(after[i].twinkleAmp).toBe(star.twinkleAmp);
    });
  });

  it('与名单顺序无关：倒序输入产出同一颗星', () => {
    const forward = layoutContributorStars(DONORS_FIXTURE);
    const reversed = layoutContributorStars([...DONORS_FIXTURE].reverse());
    for (const star of forward) {
      const match = reversed.find((s) => s.donor.name === star.donor.name);
      expect(match?.position).toEqual(star.position);
      expect(match?.color).toBe(star.color);
    }
  });

  it('纯函数：不修改入参、donor 引用透传、返回保持入参顺序', () => {
    const input = [...DONORS_FIXTURE];
    const stars = layoutContributorStars(input);
    expect(input).toEqual(DONORS_FIXTURE);
    stars.forEach((star, i) => expect(star.donor).toBe(input[i]));
  });

  it('空名单返回空数组', () => {
    expect(layoutContributorStars([])).toEqual([]);
  });
});

describe('layoutContributorStars：属性区间与色板', () => {
  const stars = layoutContributorStars(DONORS_FIXTURE);

  it('位置在星团最大半径内（径向 3σ 截断）', () => {
    expect(CLUSTER_RADIUS_MAX).toBe(CLUSTER_RADIUS_SIGMA * 3);
    for (const star of stars) {
      const [x, y, z] = star.position;
      expect(Math.sqrt(x * x + y * y + z * z)).toBeLessThanOrEqual(CLUSTER_RADIUS_MAX + 1e-9);
    }
  });

  it('scale/brightness 落在映射区间', () => {
    for (const star of stars) {
      expect(star.scale).toBeGreaterThanOrEqual(STAR_SCALE_MIN);
      expect(star.scale).toBeLessThanOrEqual(STAR_SCALE_MAX);
      expect(star.brightness).toBeGreaterThanOrEqual(STAR_BRIGHTNESS_MIN);
      expect(star.brightness).toBeLessThanOrEqual(STAR_BRIGHTNESS_MAX);
    }
  });

  it('颜色取自恒星色板，金额不参与颜色（同名同平台异额同色）', () => {
    for (const star of stars) {
      expect(CONTRIBUTOR_STAR_COLORS).toContain(star.color);
    }
    const cheap = layoutContributorStars([makeDonor({ name: 'x', amountCny: 5 })]);
    const rich = layoutContributorStars([makeDonor({ name: 'x', amountCny: 9999 })]);
    expect(cheap[0].color).toBe(rich[0].color);
    expect(cheap[0].position).toEqual(rich[0].position);
  });

  it('闪烁参数在 starTwinkle 约定区间', () => {
    for (const star of stars) {
      expect(star.twinklePhase).toBeGreaterThanOrEqual(0);
      expect(star.twinklePhase).toBeLessThan(1);
      expect(star.twinkleFreq).toBeGreaterThanOrEqual(TWINKLE_FREQ_MIN_HZ);
      expect(star.twinkleFreq).toBeLessThanOrEqual(TWINKLE_FREQ_MAX_HZ);
      expect(star.twinkleAmp).toBeGreaterThanOrEqual(TWINKLE_AMP_MIN);
      expect(star.twinkleAmp).toBeLessThanOrEqual(TWINKLE_AMP_MAX);
    }
  });
});

describe('layoutContributorStars：碰撞微扰', () => {
  // 同名同平台记录种子相同 → 基准位重合，必然触发微扰路径
  const twins: readonly DonorRecord[] = [
    makeDonor({ name: 'twin', amountCny: 10 }),
    makeDonor({ name: 'twin', amountCny: 200 }),
  ];

  it('两星过近时确定性微扰：结果分离且满足最小间距', () => {
    const stars = layoutContributorStars(twins);
    const [a, b] = stars;
    const dist = Math.hypot(
      a.position[0] - b.position[0],
      a.position[1] - b.position[1],
      a.position[2] - b.position[2],
    );
    expect(dist).toBeGreaterThanOrEqual(MIN_STAR_DISTANCE);
  });

  it('微扰结果确定：两次调用逐位相等', () => {
    expect(layoutContributorStars(twins)).toEqual(layoutContributorStars(twins));
  });

  it('重试耗尽路径：大量同种子记录不抛错、结果确定', () => {
    // 同种子记录共享随机流：第 k 条的前 k 个候选位恰为前 k 颗星所在位，
    // 超过 MAX_PERTURB_ATTEMPTS+1 条后必然耗尽重试、接受最后候选位
    const crowd = Array.from({ length: MAX_PERTURB_ATTEMPTS + 4 }, (_, i) =>
      makeDonor({ name: 'crowd', amountCny: i + 1 }),
    );
    const a = layoutContributorStars(crowd);
    const b = layoutContributorStars(crowd);
    expect(a).toHaveLength(crowd.length);
    expect(a).toEqual(b);
    for (const star of a) {
      expect(star.position.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
