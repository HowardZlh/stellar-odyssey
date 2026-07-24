/**
 * 特殊天体数据完整性测试（需求 3.1.5 / 6 数据准确性）
 */

import type { SpecialBodyKind } from "@/types";
import {
  PULSAR_VISUAL_SPIN_PERIOD_SEC,
  SIRIUS_MASS_RATIO,
  SIRIUS_VISUAL_ORBIT_PERIOD_SEC,
  SPECIAL_BODIES,
  getSpecialBodyById,
  isGalaxyAnchoredFocusId,
} from "@/data/specialBodies";

describe("特殊天体数据完整性", () => {
  it("id 全局唯一", () => {
    const ids = SPECIAL_BODIES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("覆盖需求 3.1.5 的全部类别（恒星类/星云类/星团/黑洞/河外）", () => {
    const kinds = new Set(SPECIAL_BODIES.map((b) => b.kind));
    const required: SpecialBodyKind[] = [
      "red-giant",
      "blue-giant",
      "binary-white-dwarf",
      "pulsar-remnant",
      "black-hole",
      "emission-nebula",
      "planetary-nebula",
      "globular-cluster",
      "quasar",
    ];
    for (const kind of required) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("每个天体基于真实原型：有英文名、中文名、类型、数据来源", () => {
    for (const b of SPECIAL_BODIES) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.nameZh.length).toBeGreaterThan(0);
      expect(b.typeZh.length).toBeGreaterThan(0);
      expect(b.dataSource.length).toBeGreaterThan(0);
    }
  });

  it("静态形态 + 动态效果：关键参数与动态科学解释齐备（通用要求）", () => {
    for (const b of SPECIAL_BODIES) {
      expect(b.factsZh.length).toBeGreaterThan(0);
      for (const fact of b.factsZh) {
        expect(fact.label.length).toBeGreaterThan(0);
        expect(fact.value.length).toBeGreaterThan(0);
      }
      expect(b.dynamicsZh.length).toBeGreaterThan(0);
    }
  });

  it("真实距离为正数", () => {
    for (const b of SPECIAL_BODIES) {
      expect(b.realDistanceLy).toBeGreaterThan(0);
    }
  });

  it("L3 天体（sun-relative）必须有视觉偏移与可视尺寸", () => {
    for (const b of SPECIAL_BODIES.filter(
      (x) => x.level === "L3" && x.positionMode === "sun-relative",
    )) {
      expect(b.offsetLy).toBeDefined();
      expect(b.visualRadiusLy).toBeGreaterThan(0);
    }
  });

  it("银心黑洞使用 galactic-center 定位", () => {
    const sgr = getSpecialBodyById("sgr-a-star")!;
    expect(sgr.positionMode).toBe("galactic-center");
    expect(sgr.kind).toBe("black-hole");
    expect(sgr.level).toBe("L3");
  });

  it("河外对象（L4）方向矢量已归一化", () => {
    for (const b of SPECIAL_BODIES.filter(
      (x) => x.positionMode === "extragalactic",
    )) {
      expect(b.direction).toBeDefined();
      const d = b.direction!;
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 2);
      expect(b.level).toBe("L4");
    }
  });

  it("类星体 3C 273 距离约 24 亿光年（NED）", () => {
    const quasar = getSpecialBodyById("quasar-3c273")!;
    expect(quasar.realDistanceLy).toBeCloseTo(2.4e9, -8);
    expect(quasar.kind).toBe("quasar");
  });

  it("参宿四为红巨星（约 640 光年）、参宿七为蓝巨星（约 860 光年）", () => {
    expect(getSpecialBodyById("betelgeuse")!.realDistanceLy).toBe(640);
    expect(getSpecialBodyById("rigel")!.realDistanceLy).toBe(860);
  });

  it("天狼星距离 8.6 光年，质量比约 2:1", () => {
    expect(getSpecialBodyById("sirius")!.realDistanceLy).toBeCloseTo(8.6, 6);
    expect(SIRIUS_MASS_RATIO).toBeCloseTo(2.06 / 1.02, 9);
  });

  it("蟹状脉冲星距离约 6,500 光年，遗迹与脉冲星为同一对象", () => {
    const crab = getSpecialBodyById("crab-pulsar")!;
    expect(crab.realDistanceLy).toBe(6500);
    expect(crab.kind).toBe("pulsar-remnant");
  });

  it("可视化降速周期为正（速率钳制策略登记）", () => {
    expect(SIRIUS_VISUAL_ORBIT_PERIOD_SEC).toBeGreaterThan(0);
    expect(PULSAR_VISUAL_SPIN_PERIOD_SEC).toBeGreaterThan(0);
  });

  it("getSpecialBodyById：未知 id 返回 undefined", () => {
    expect(getSpecialBodyById("unknown")).toBeUndefined();
  });
});

describe("isGalaxyAnchoredFocusId（跟随/飞往时银河系组聚焦提升判定，bug 修复）", () => {
  it("L3 银河系内特殊天体（sun-relative / galactic-center）为锚定目标", () => {
    for (const id of [
      "betelgeuse",
      "rigel",
      "sirius",
      "crab-pulsar",
      "sgr-a-star",
    ]) {
      expect(isGalaxyAnchoredFocusId(id)).toBe(true);
    }
  });

  it("超新星事件 id（sn- 前缀）为锚定目标", () => {
    expect(isGalaxyAnchoredFocusId("sn-1")).toBe(true);
    expect(isGalaxyAnchoredFocusId("sn-42")).toBe(true);
  });

  it("河外特殊天体 / 太阳系天体 / 星系 / 未知 id 不属于银河系组锚定目标", () => {
    for (const id of ["quasar-3c273", "sun", "earth", "m31", "not-a-body"]) {
      expect(isGalaxyAnchoredFocusId(id)).toBe(false);
    }
  });

  it("全部 L3 非河外特殊天体均判定为锚定目标（与 SpecialBodies 渲染集合一致）", () => {
    for (const body of SPECIAL_BODIES) {
      const expected =
        body.level === "L3" && body.positionMode !== "extragalactic";
      expect(isGalaxyAnchoredFocusId(body.id)).toBe(expected);
    }
  });
});
