/**
 * 中文字典（默认 locale，B2 i18n 基建）
 *
 * 键命名约定（登记）：按组件/域分组的嵌套对象，叶子为文案字符串，
 * 消费侧以点分路径引用（如 `contactBadge.title`）。
 *
 * B2 阶段仅收口打样件 ContactBadge 的文案；六大 UI 组件与事件通知等
 * 约 300 条壳层文案的批量迁移属 B3 范围（届时逐组件补键）。
 *
 * en/zh 键集合一致性由 `I18nDict` 类型强制（en.ts 以该类型标注：
 * 缺键报 TS2741 缺属性、多键报 TS2353 对象字面量多余属性，均编译期报错）。
 */
export const zh = {
  contactBadge: {
    /** 左下角角标按钮文字（emoji 由组件层持有） */
    badgeLabel: '商业合作',
    /** 展开卡片的无障碍名称 */
    dialogAriaLabel: '商业合作联系方式',
    /** 卡片标题 */
    title: '商业合作',
    /** 卡片说明（README「商业合作」小节同源语义，§0.4 中性文案） */
    description:
      '欢迎教育机构、科技馆与展陈集成商联系：展馆大屏部署、定制开发、课程内容。',
    /** GitHub Issues 链接文字 */
    githubIssues: 'GitHub Issues',
  },
} as const;

/** 递归将字典叶子放宽为 string（保持嵌套结构与键集合不变） */
type DictShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : DictShape<T[K]>;
};

/** 字典结构类型：以 zh 为单一事实来源，en 必须与其键集合完全一致 */
export type I18nDict = DictShape<typeof zh>;
