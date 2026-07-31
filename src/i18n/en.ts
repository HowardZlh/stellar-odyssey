/**
 * 英文字典（B2 i18n 基建）
 *
 * 键集合与 zh.ts 由 `I18nDict` 类型强制一致（缺键/多键均编译报错）。
 * 文案遵守 §0.4 对外文案约束：仅中性商业合作表述
 * （"commercial licensing / partnership inquiries"）。
 */
import type { I18nDict } from './zh';

export const en: I18nDict = {
  contactBadge: {
    badgeLabel: 'Partnership',
    dialogAriaLabel: 'Commercial partnership contact',
    title: 'Commercial Partnership',
    description:
      'Educational institutions, science museums, and exhibition integrators are welcome to reach out: large-screen exhibit deployment, custom development, and course content.',
    githubIssues: 'GitHub Issues',
  },
};
