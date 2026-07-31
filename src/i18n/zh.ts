/**
 * 中文字典（默认 locale，B2 i18n 基建 + B3 UI 壳层文案批量收口）
 *
 * 键命名约定（登记）：按组件/域分组的嵌套对象，叶子为文案字符串，
 * 消费侧以点分路径引用（如 `contactBadge.title`）；带 `{param}` 占位符的
 * 条目经 `tf(locale, key, params)` 插值（B3 登记：`\{(\w+)\}` 简单替换，
 * 未提供的占位符原样保留）。emoji 一律由组件层持有（B2 约定沿用）。
 *
 * B3 迁移边界（方案 K3，豁免登记）：
 * - 描述性科学长文案、dataSource 署名（`*_ZH` 常量族）、显示开关下方
 *   来源说明段留中文不迁（英文态混排为已知可接受）；
 * - `catalogText` 组为「中文原文 → 键」直映射（键=中文原文，zh 侧值=键
 *   本身）：覆盖信息面板标签列与天体类型行的有限集合，消费侧经
 *   `localizeCatalogText(locale, zhText)` 查找，zh 态零开销直返、
 *   未收录条目回退中文原文（登记）。
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
  helpHint: {
    /**
     * 操作引导正文（迁移自 HelpHint JSX：空格/\u00a0 与原 JSX 空白折叠
     * 结果逐字符一致——中文态逐像素等价前提，勿改动空白）
     */
    controls:
      '🖱 拖动旋转 · 滚轮缩放 · 右键平移 \u00a0|\u00a0 ⌨ 1-4 切换视角 · [ / ] 巡游上一个/下一个天体（按视角域：行星系统/太阳系/银河系/宇宙序列）· G 银心固定视角（银河系视角下俯瞰太阳系沿波浪轨道绕银心公转，再按返回跟随太阳系）· V 垂直展开（银河系视角下生效；银河系整体 morph 为扁旋转椭球体：银盘/超新星/特殊天体随增益展开，含高度指示线）· 空格暂停 · M 音效 · O 轨道线 \u00a0|\u00a0 点击行星查看信息',
    /** 科学性/艺术化说明段（行间空格为原 JSX 折叠结果，勿改动） */
    disclaimer:
      '恒星闪烁仅行星视角呈现（真空中恒星不闪烁，闪烁源于大气湍流，此为艺术化处理）； 音效为艺术化设计（真空无声），行星环境音按各行星大气特征区分（水星/矮行星近真空几乎静音）； 默认模式下矮行星与人造卫星尺寸经放大以保证可辨识，真实比例模式下过小不可见属科学事实； 银河系视角下太阳垂直振荡的波浪起伏经 ×10 视觉放大（真实振幅仅 ±300 光年，真实比例模式不放大）； 特殊天体高度方向按真实银纬（SIMBAD）推算、水平距离为示意，垂直展开（V）为观察辅助的视觉夸大（指示线标注为未放大的推算高度）—— 开启后整个银盘 morph 为扁旋转椭球体（正面/俯视轮廓仍为圆形、旋臂俯视可辨，侧视旋臂图案被垂直弥散属预期权衡），超新星随盘抬升、银晕增亮、尘埃带渐隐； 太阳观察：飞往太阳近观可见米粒组织/黑子/日珥，选中太阳可开启内部剖面—— 黑子/日珥尺寸与活动频率经演示化放大、耀斑时长减速呈现（均已登记），色球厚度夸大至 +1.5%； 宇宙视角：卫星星系沿细线轨道运动（轨道线随 O 开关），麦哲伦星流/人马座潮汐流为 历史路径上剥离的气体与恒星（弥散粒子带，非轨道线），宇宙网除哈勃膨胀缩放外静止属预期； 大尺度背景为 2MASS 红移巡天（2MRS）约 4.3 万个真实星系点云（椭圆偏黄/旋涡偏蓝白， 室女座团聚集与银道空带为真实数据；红移距离系哈勃流近似有指状效应、近距误差与 银道遮挡带三项失真，银道空带是尘埃遮挡的观测限制非真实空洞），程序化宇宙网降为氛围底层； 银河系侧视可见外盘 S 形 HI 翘曲（Levine et al. 2006，盘缘振幅经艺术化放大以侧视可辨）与 银心上下费米气泡弥散双泡（Su et al. 2010，伽马射线辉光以淡紫/品红艺术化呈现，可在显示选项关闭）',
    /** B3-D 语言切换说明（新增行，实现差异登记） */
    langNote:
      '语言 Language：左上角面板 zh/EN 按钮即时切换界面语言（仅界面文案；科学说明与数据值暂为中文）',
    closeAria: '关闭引导',
  },
  /** 四视角锚点名（cameraViews.nameZh 迁移，ControlPanel 按钮 + HUD 标题共用） */
  viewLevel: {
    L1: '行星视角',
    L2: '太阳系视角',
    L3: '银河系视角',
    L4: '宇宙视角',
  },
  /** 巡游域名（utils/cycleScopes SCOPE_NAME_ZH 迁移，常量保留供纯逻辑测试） */
  scopeName: {
    system: '行星巡游',
    solar: '太阳系巡游',
    galaxy: '银河系巡游',
    universe: '宇宙巡游',
  },
  controlPanel: {
    title: '星海奥德赛',
    subtitle: 'Stellar Odyssey',
    langAria: '界面语言切换',
    viewSection: '视角（快捷键 1-4）',
    galacticFrameSection: '银河系视角参考系（G 切换）',
    galacticFrameTitle: '银心固定：银心居中不动，俯瞰太阳系沿波浪轨道绕银心公转',
    galacticFrameOn: '银心固定中（点按回到跟随太阳系）',
    galacticFrameOff: '切换银心固定视角（观察太阳系公转）',
    speedSection: '模拟速度（空格暂停）',
    resume: '继续',
    pause: '暂停',
    speedAria: '模拟速度倍率',
    audioSection: '音效（M 静音；真空无声，音效为艺术化设计）',
    audioOn: '开',
    audioOff: '关',
    volumeAria: '音量',
    displaySection: '显示',
    orbits: '轨道线（O）',
    bodyLabels: '天体标签（L）',
    satelliteOrbits: '卫星轨道线',
    youAreHere: 'You are here 标记',
    velocityVectors: '速度矢量箭头',
    galaxyCatalog: '真实巡天背景（2MRS）',
    fermiBubbles: '费米气泡',
    verticalExpand: '垂直展开（V）',
    expandGain: '增益',
    expandGainAria: '垂直展开增益（1–6）',
    realScale: '真实比例模式（天体按真实大小）',
    sunCutaway: '太阳内部剖面（1/4 切除视图）',
    bloom: '泛光效果（Bloom，低性能设备可关闭）',
    performance: '性能监控（FPS/内存）',
    demoSection: '动态事件演示',
    supernovaActive: '超新星爆发进行中…',
    supernovaTrigger: '触发超新星演示（旋臂内随机）',
    flareActive: '耀斑进行中（{cls}{mag} 级）…',
    flareCutawayDisabled: '触发太阳耀斑演示（剖面模式下不可用）',
    flareTrigger: '触发太阳耀斑演示（活动区随机）',
    cmeActive: 'CME 进行中（{speed} km/s）…',
    cmeCutawayDisabled: '触发 CME 演示（剖面模式下不可用）',
    cmeTrigger: '触发日冕物质抛射（CME）演示',
    mergerActive: '合并预览进行中…',
    mergerTrigger: '预览银河系—仙女座碰撞合并',
    mergerRestore: '恢复预览前时间',
  },
  hud: {
    simTime: '模拟时间：{value}',
    scale: '当前尺度：{value}',
    frameL1: '参考系：日心系（行星/卫星运动）',
    frameL2: '参考系：日心系（黄道坐标）',
    frameL3: '参考系：银心系（太阳系绕银心）',
    frameL4: '参考系：本星系群质心系（本动以矢量指示）',
    frameHudCenter: '参考系：银心系（银心固定）',
    frameHudFollow: '参考系：银心系（跟随太阳系）',
    galacticYear:
      '银河年进度：第 {orbit} 圈 {percent}%（绕行 {deg}°）｜银盘面高度 {sign}{height} ly',
    frameToggle: '参考系：{mode}（G 切换）',
    frameModeCenter: '银心固定',
    frameModeFollow: '跟随太阳系',
    rateClampSatellite: '快周期卫星运动已减速显示（防闪烁）',
    rateClampPlanet: '行星运动已减速显示（防闪烁）',
    followMode: '跟随模式：{name}',
    followCancel: '取消（Esc）',
    gTipPrefix: '按',
    gTipMiddle: '切换',
    gTipHighlight: '银心固定视角',
    gTipSuffix: '，俯瞰太阳系沿波浪轨道绕银心公转',
    gTipCloseAria: '关闭银心固定视角引导',
    gTipNow: '立即切换（G）',
    mergerTitle: '银河系—仙女座合并演化',
    mergerCloseAria: '关闭合并演化卡片',
    /** zh 用 {yi}（亿年）、en 用 {myr}（Myr）——两参数同时传入，按 locale 取用 */
    mergerTau: '（合并时刻后约 {yi} 亿年）',
    snTitle: '超新星爆发！',
    snCloseAria: '关闭超新星通知',
    snBody: '银河系旋臂内探测到核坍缩超新星（前身星约 {mass} 倍太阳质量）',
    flyBtn: '飞往观看',
    detailBtn: '查看详情',
    flareTitle: '太阳耀斑爆发（{cls}{mag} 级）！',
    flareCloseAria: '关闭耀斑通知',
    flareBody: '活动区（黑子群附近）发生磁重联能量释放',
    flareCmeLinked: '，预计伴随日冕物质抛射（CME）',
    cmeTitle: '日冕物质抛射（CME）！约 {speed} km/s',
    cmeCloseAria: '关闭 CME 通知',
    cmeBody: '大团等离子体从日冕喷出，呈扩张壳层飞离太阳',
    cmeEarthDirected: '——本次抛射朝向地球！',
    cmeArrivalTitle: 'CME 已抵达地球！',
    cmeArrivalCloseAria: '关闭 CME 抵达通知',
    cmeArrivalBody:
      '等离子体云抵达地球磁层，扰动引发地磁暴——极区高层大气激发出增强极光 （示意）。',
    flyEarthBtn: '飞往地球观看',
    featureCloseAria: '关闭特征卡片',
    sunspotEarthsPre: '该黑子约可容纳',
    sunspotEarthsPost: '个地球（按放大前真实尺寸换算）',
    layerCloseAria: '关闭分层卡片',
    layerRange: '范围',
    layerTemp: '温度',
    /** 信息面板/剖面分层标题：zh 中英并列、en 仅英文（实现差异登记） */
    bodyTitle: '{nameZh}（{nameEn}）',
    dataSource: '数据来源：{value}',
    infoCloseAria: '关闭信息面板',
    cutawayOn: '关闭内部结构剖面',
    cutawayOff: '查看内部结构（1/4 剖面）',
    flyShort: '飞往（F）',
    follow: '跟随',
    unfollow: '取消跟随',
    prevAria: '序列上一个天体（快捷键 [）',
    prevTitle: '上一个（[）',
    nextAria: '序列下一个天体（快捷键 ]）',
    nextTitle: '下一个（]）',
  },
  bodyCycle: {
    prev: '上一个',
    next: '下一个',
    prevAria: '上一个天体（快捷键 [）',
    nextAria: '下一个天体（快捷键 ]）',
  },
  perfMonitor: {
    title: '性能监控',
    fpsLabel: '帧率：{value}',
    memoryLabel: '内存：{value}',
    measuring: '统计中…',
    unavailable: '不可用',
    /** 健康度后缀与 utils/performance formatFpsLabel 同源阈值（fpsHealth） */
    fpsFair: '{fps} FPS（一般）',
    fpsLow: '{fps} FPS（偏低）',
  },
  loading: {
    textures: '加载纹理资源',
  },
  /**
   * 信息面板标签列/类型行直映射（键=中文原文；catalog.ts、specialBodies
   * factsZh、solarActivity/solarCycle/m87Environment 状态行标签的有限集合）。
   * 值行/描述行留中文（档位 3 边界，登记）；未收录标签回退中文原文。
   */
  catalogText: {
    // ── 信息面板标签列 ──────────────────────────────────────────────
    主旋臂: '主旋臂',
    事件视界: '事件视界',
    伴星: '伴星',
    位置: '位置',
    光变周期: '光变周期',
    光度: '光度',
    光弧: '光弧',
    公转周期: '公转周期',
    共振: '共振',
    内缘: '内缘',
    内部: '内部',
    冲击波: '冲击波',
    前身星: '前身星',
    剪影: '剪影',
    动态效果: '动态效果',
    半径: '半径',
    历史: '历史',
    原型: '原型',
    原理: '原理',
    反射星云: '反射星云',
    发射: '发射',
    吸积盘: '吸积盘',
    周围星云: '周围星云',
    喷流: '喷流',
    备注: '备注',
    外缘: '外缘',
    天狼星A: '天狼星A',
    天狼星B: '天狼星B',
    太阳风: '太阳风',
    定义: '定义',
    室女座团: '室女座团',
    尺度: '尺度',
    尺度对比: '尺度对比',
    年龄: '年龄',
    '当前 CME': '当前 CME',
    当前活动: '当前活动',
    当前耀斑: '当前耀斑',
    形态: '形态',
    形状: '形状',
    成员: '成员',
    探测: '探测',
    描述: '描述',
    携带: '携带',
    日冕洞: '日冕洞',
    日冕温度: '日冕温度',
    星暴: '星暴',
    星风速度: '星风速度',
    本质: '本质',
    标志结构: '标志结构',
    活动周期: '活动周期',
    演示说明: '演示说明',
    潮汐锁定: '潮汐锁定',
    球状星团: '球状星团',
    盘厚度: '盘厚度',
    直径: '直径',
    真实特征尺寸: '真实特征尺寸',
    真实距离: '真实距离',
    示意说明: '示意说明',
    离心率: '离心率',
    科学性说明: '科学性说明',
    穿越日球层顶: '穿越日球层顶',
    组成: '组成',
    结局: '结局',
    结构: '结构',
    结构分层: '结构分层',
    膨胀速度: '膨胀速度',
    自转周期: '自转周期',
    表面温度: '表面温度',
    视向速度: '视向速度',
    视星等变化: '视星等变化',
    触须: '触须',
    质量: '质量',
    距离: '距离',
    轨道倾角: '轨道倾角',
    轨道半长轴: '轨道半长轴',
    轨道周期: '轨道周期',
    轴倾角: '轴倾角',
    较差自转: '较差自转',
    '运动（模拟）': '运动（模拟）',
    近日点距离: '近日点距离',
    进程: '进程',
    远日点距离: '远日点距离',
    遗迹: '遗迹',
    量天尺: '量天尺',
    银心: '银心',
    阶段: '阶段',
    颜色: '颜色',
    黑子: '黑子',
    // ── 天体类型行（typeZh 有限集合） ────────────────────────────────
    恒星: '恒星',
    行星: '行星',
    矮行星: '矮行星',
    卫星: '卫星',
    人造卫星: '人造卫星',
    彗星: '彗星',
    太阳系外围结构: '太阳系外围结构',
    '星际探测器（日球层顶穿越标记）': '星际探测器（日球层顶穿越标记）',
    旋涡星系: '旋涡星系',
    棒旋星系: '棒旋星系',
    椭圆星系: '椭圆星系',
    不规则星系: '不规则星系',
    '动态事件（核坍缩超新星）': '动态事件（核坍缩超新星）',
    '红巨星（红超巨星）': '红巨星（红超巨星）',
    蓝超巨星: '蓝超巨星',
    '双星系统（主序星 + 白矮星）': '双星系统（主序星 + 白矮星）',
    '中子星/脉冲星（超新星遗迹中心）': '中子星/脉冲星（超新星遗迹中心）',
    '超大质量黑洞（银心）': '超大质量黑洞（银心）',
    发射星云: '发射星云',
    行星状星云: '行星状星云',
    '球状星团（银晕）': '球状星团（银晕）',
    '恒星级黑洞（X射线双星）': '恒星级黑洞（X射线双星）',
    '沃尔夫-拉叶星（大质量恒星晚期）': '沃尔夫-拉叶星（大质量恒星晚期）',
    '造父变星（脉动变星）': '造父变星（脉动变星）',
    疏散星团: '疏散星团',
    '暗星云（分子云剪影）': '暗星云（分子云剪影）',
    '类星体（活动星系核）': '类星体（活动星系核）',
    '星系碰撞现场（并合中的旋涡星系对）': '星系碰撞现场（并合中的旋涡星系对）',
    '星系团引力透镜（背景星系光弧）': '星系团引力透镜（背景星系光弧）',
    '伽马射线暴（长暴）': '伽马射线暴（长暴）',
  },
} as const;

/** 递归将字典叶子放宽为 string（保持嵌套结构与键集合不变） */
type DictShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : DictShape<T[K]>;
};

/** 字典结构类型：以 zh 为单一事实来源，en 必须与其键集合完全一致 */
export type I18nDict = DictShape<typeof zh>;
