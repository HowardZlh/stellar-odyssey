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
    /** 卡片说明（README「商业合作」小节同源语义，中性文案口径） */
    description:
      '欢迎教育机构、科技馆与展陈集成商联系：展馆大屏部署、定制开发、课程内容。',
    /** GitHub Issues 链接文字 */
    githubIssues: 'GitHub Issues',
    /** 爱发电赞助链接文字（emoji 由组件层持有） */
    sponsor: '爱发电赞助支持',
    /** 捐赠入口按钮文字（emoji ☄️ 由组件层持有；跳转 /donate 新页面） */
    donateLabel: '投喂燃料',
    donateAria: '打开捐赠页（新标签页）',
    /** M3 移动弹层关闭按钮（居中弹层化，桌面不使用） */
    closeAria: '关闭投喂与合作面板',
  },
  /** 捐赠页（/donate，零回报承诺口径——不承诺任何回报或更新义务） */
  donate: {
    title: '投喂燃料',
    subtitle: '为星海奥德赛添一把燃料',
    intro:
      '如果这片宇宙曾让你停下滚轮多看一会儿，欢迎投喂一份燃料。所有捐赠均为无偿支持，不构成任何回报或更新义务的承诺——项目的全部功能与源代码对所有人平等开放，你的支持将用于持续开发与域名维护，让它保持免费、无广告、开源。',
    platformsSection: '捐赠通道',
    platformAvailable: '前往捐赠',
    platformComingSoon: '预留位 · 即将开通',
    platformShowQr: '查看赞赏码',
    platformHideQr: '收起赞赏码',
    wechatQrAlt: '微信赞赏码',
    wechatQrHint: '微信内长按识别，或用手机微信扫码',
    donorsSection: '燃料补给名单',
    donorsNote: '按累计捐赠金额降序排列（人工登记，可能存在延迟）',
    donorsEmpty: '虚位以待——成为第一颗点亮航程的星。',
    donorAmount: '¥{amount}',
    /** 名单区贡献者宇宙入口（C4-1；emoji ✨ 由组件层持有；陈述口径，无回报承诺） */
    contributorsEntry: '进入贡献者宇宙',
    backToApp: '返回星图',
  },
  /**
   * 贡献者宇宙页（/contributors，C2）。文案红线（REQUIREMENTS_CONTRIBUTORS §0.5）：
   * 一律陈述口径（"这里陈列了每一位支持者"），禁止"捐赠即点亮专属星"类承诺式表述。
   */
  contributors: {
    title: '贡献者宇宙',
    subtitle: '这里陈列了每一位支持者——每颗星对应一位已登记的燃料补给者',
    intro:
      '星的大小与亮度按累计捐赠金额的对数映射呈现，位置由昵称与平台确定性生成，与登记顺序无关。',
    sortNote: '按累计捐赠金额降序排列（人工登记，可能存在延迟）',
    empty: '虚位以待——成为第一颗点亮航程的星。',
    goDonate: '前往捐赠页',
    backToApp: '返回星图',
    /** 桌面操作提示 */
    hintDesktop: '拖动环视 · 滚轮缩放 · 点击星星查看详情',
    /** 触屏操作提示（C3-1，isTouch 分流） */
    hintTouch: '单指拖动环视 · 双指缩放 · 点按聚焦贡献者',
    /** 画布下方常驻文字名单（兼作屏幕阅读器/降级形态，实现裁决登记于需求文档） */
    listSection: '文字名单',
    webglFallback: '当前环境不支持 3D 渲染，已切换为文字名单。',
    preparing: '正在点亮星空…',
    detailAmount: '金额',
    detailDate: '登记日期',
    detailPlatform: '平台',
    detailMessage: '留言',
    detailCloseAria: '关闭详情卡',
    /** M2 动态名单（D-z4）：空昵称展示名 + 支付宝渠道展示名（注册表外平台） */
    anonymous: '匿名用户',
    platformAlipay: '支付宝',
  },
  /**
   * 解锁页（/unlock，U3）。口径红线（REQUIREMENTS_UNLOCK §0.4）：
   * 本页为明码标价对价口径（允许"支付 ¥X 解锁 Y 天"承诺式表述），
   * 与 /donate 赞助（零回报）双轨隔离——禁止出现"捐赠/赞助即解锁"表述。
   */
  unlock: {
    title: '支持者解锁',
    subtitle: '解锁近观细节层与巡游序列的限时访问',
    intro:
      '以下为明码标价的限时访问对价：按档位金额支付后凭凭证兑换，到期自动恢复免费体验。本页与"投喂燃料"自愿赞助相互独立，互不构成条件。项目源代码保持开源。',
    backToApp: '返回星图',
    /** 权益状态区 */
    statusSection: '我的权益',
    statusFree: '当前为免费体验——近观细节层、L3/L4 巡游与不限次演示未解锁。',
    statusActive: '权益已激活',
    statusTierLabel: '档位',
    statusExpiryLabel: '到期日',
    statusRemainingLabel: '剩余',
    statusRemainingDays: '{days} 天',
    tierWeek: '周卡',
    tierMonth: '月卡',
    tierYear: '年卡',
    copyToken: '复制我的 token',
    copyTokenDone: '已复制到剪贴板',
    copyTokenFail: '自动复制失败，请手动选择下方文本复制',
    copyTokenAria: '复制解锁 token（换设备时粘贴激活）',
    clearEntitlement: '清除权益',
    clearConfirmHint: '清除后需重新粘贴 token 才能恢复，请先妥存 token。',
    clearConfirmYes: '确认清除',
    clearConfirmNo: '取消',
    /** 档位价格表 */
    tiersSection: '解锁档位',
    tierColumnTier: '档位',
    tierColumnPriceCny: '价格（¥）',
    tierColumnPriceUsd: '参考价（$）',
    tierColumnDays: '时长',
    tierPriceCny: '¥{price}',
    tierPriceUsd: '${price}',
    tierDays: '{days} 天',
    benefitsTitle: '解锁内容（三档相同，仅时长不同）',
    benefitDetail:
      '全部近观细节层：恒星表面、体积星云、黑洞引力透镜、星团/星系与河外天体近观（共 24 处）',
    benefitTour: 'L3/L4 巡游序列：银河系与宇宙视角下的天体巡游切换',
    benefitDemo: '事件演示不限次：耀斑 / CME / 超新星 / 星系合并预览',
    refundTitle: '退款与说明',
    refundPolicy:
      '未兑换的订单可全额退款；已兑换订单如发生退款，对应解锁凭证将同步失效。不提供发票；到期后不自动续费。',
    /** 三通道兑换区 */
    channelsSection: '购买与兑换',
    afdianTitle: '爱发电（自动兑换）',
    afdianGuide:
      '前往爱发电按档位金额购买（周卡/年卡为商品，月卡为订阅方案），支付完成后在下方粘贴订单号即可自动兑换。',
    afdianLink: '前往爱发电购买',
    orderInputLabel: '爱发电订单号',
    orderInputPlaceholder: '粘贴订单号（14-40 位数字）',
    orderInvalid: '订单号应为 14-40 位数字，请在爱发电「我的订单」中复制',
    redeemButton: '兑换',
    redeemPending: '兑换中…',
    redeemSuccess: '兑换成功，权益已激活！',
    errInvalidOrder: '订单号无效，请核对后重试',
    errOrderNotPaid: '订单未完成支付，请支付后再兑换',
    errAmountTooLow: '订单金额不足最低档位（¥6），无法兑换',
    errAlreadyRedeemed: '该订单已被兑换过（如系本人换设备，请用原 token 激活）',
    errUpstream: '订单查询服务暂时不可用，请稍后重试',
    errNotConfigured: '兑换服务尚未开通，请稍后再来或邮件联系',
    errPlanNotEligible: '该订单对应的商品不支持解锁兑换，请核对购买的是解锁档位商品',
    errUnknown: '兑换失败（未知错误），请稍后重试或邮件联系',
    errNetwork: '网络请求失败，请检查网络后重试',
    wechatTitle: '微信赞赏码（人工兑换）',
    wechatGuide:
      '按所选档位金额通过微信赞赏码支付，然后发送兑换邮件至 {email}，附支付截图与交易时间，我们将回信发送解锁 token（通常 48 小时内）。',
    wechatShowQr: '展开赞赏码',
    wechatHideQr: '收起赞赏码',
    wechatQrAlt: '微信赞赏码',
    wechatQrHint: '微信内长按识别，或用手机微信扫码；金额请按档位价格支付',
    kofiTitle: 'Ko-fi（人工兑换）',
    kofiGuide:
      '按档位对应的 $ 金额通过 Ko-fi 支付，然后发送兑换邮件至 {email}，附支付凭证与交易时间，我们将回信发送解锁 token（通常 48 小时内）。',
    kofiLink: '前往 Ko-fi 支付',
    emailCta: '发送兑换邮件',
    emailSubject: '星海奥德赛解锁兑换',
    /** token 粘贴区 */
    tokenSection: '已有 token？在此激活',
    tokenIntro:
      '人工通道回信、换设备迁移或 B2B 交付的 token 都在这里粘贴激活。',
    tokenInputLabel: '解锁 token',
    tokenInputPlaceholder: '粘贴 SO1. 开头的完整 token',
    tokenActivate: '激活',
    tokenErrFormat: 'token 格式不正确，请确认完整复制（SO1. 开头共三段）',
    tokenErrSignature: 'token 签名校验失败，请勿改动 token 内容后重试',
    tokenErrExpired: 'token 已过期，可重新购买任意档位续期',
    tokenActivated: '权益已激活！',
    /**
     * A6-3 吊销链路提示（裁决 ⑤⑥ 原文照录，勿改写；双轨红线：零
     * "捐赠/赞助"字样，链接仅指 /unlock——组件层按钮复用 lockedGoUnlock）
     */
    revokedNotice:
      '这枚凭证已随退款静静熄灭。星海别来无恙，四万个星系仍在原处等你——愿意再度启程时，解锁页的门始终为你亮着。',
    revokeCheckFailed: '未能核验凭证状态，请检查网络连接后重试。',
    /**
     * U2 主应用门控（锁定提示 HUD / ControlPanel 入口 / 巡游控件）。
     * panelStatusFree/panelStatusActive 为面板紧凑态状态行（与上方
     * 解锁页 statusFree/statusActive 语义不同，勿合并）。
     */
    lockedTitle: '支持者专属内容',
    lockedDetailBody: '该近观细节为支持者专属，解锁后即可贴近观赏。',
    lockedCycleBody: '银河系/宇宙巡游序列为支持者专属，解锁后可逐站巡游。',
    lockedQuotaBody: '今日免费演示次数已用完，解锁后不限次，或明天再来。',
    lockedGoUnlock: '前往解锁',
    lockedGoUnlockAria: '打开解锁页（新标签页）',
    lockedCloseAria: '关闭锁定提示',
    panelSection: '支持者解锁',
    panelStatusFree: '免费体验中',
    panelStatusActive: '{tier} · 剩余 {days} 天',
    panelGo: '查看解锁方案',
    panelGoAria: '打开解锁页（新标签页）',
    demoQuotaRemaining: '今日免费演示剩余 {count} 次',
    demoQuotaExhausted: '今日免费演示次数已用完，解锁后不限次',
    cycleLockedTooltip: '银河系/宇宙巡游为支持者专属',
    /**
     * Z 迭代 M2 支付宝当面付付款 modal（REQUIREMENTS_ALIPAY_UNLOCK §5.1；
     * 对价口径同本组红线——支付后自动发码即时解锁为明码标价承诺，允许）。
     */
    alipay: {
      tierCta: '支付宝扫码支付',
      tierCtaAria: '选择{tier}，打开支付宝扫码付款窗口',
      modalTitle: '支付宝扫码支付',
      closeAria: '关闭付款窗口',
      tierLine: '{tier} · ¥{price} / {days} 天',
      nicknameLabel: '昵称（可选）',
      nicknamePlaceholder: '将记入贡献者名单，留空显示「匿名用户」',
      messageLabel: '留言（可选）',
      messagePlaceholder: '随昵称一起展示，最多 50 字',
      publicNote: '昵称与留言将公开展示在贡献者名单与贡献者宇宙。',
      createButton: '生成付款码',
      creating: '正在生成付款码…',
      qrTitle: '打开支付宝「扫一扫」完成支付',
      qrAlt: '支付宝付款二维码',
      amountLine: '应付金额 ¥{amount}',
      expireHint: '二维码 30 分钟内有效；支付成功后本页自动激活权益。',
      openInAlipay: '在手机上打开支付宝付款',
      waiting: '等待支付确认…',
      paidTitle: '支付成功，权益已激活！',
      paidTokenHint:
        '以下为你的解锁 token，请妥善保存——换设备时在解锁页粘贴激活即可找回权益：',
      expiredNotice: '二维码已过期（超过 30 分钟未支付），请重新生成。',
      regenerate: '重新生成付款码',
      backToEdit: '返回修改',
      errNicknameTooLong: '昵称过长，请控制在 20 个字符以内',
      errNicknameBlocked: '昵称包含不适宜公开展示的内容，请修改后重试',
      errMessageTooLong: '留言过长，请控制在 50 个字符以内',
      errMessageBlocked: '留言包含不适宜公开展示的内容，请修改后重试',
      errNotConfigured: '支付宝支付尚未开通，请改用爱发电或其他渠道',
      errGateway: '支付宝预下单失败，请稍后重试',
      errOrderLost: '订单状态查询异常，请重新生成付款码',
      errUnknown: '操作失败（未知错误），请稍后重试或邮件联系',
      errNetwork: '网络请求失败，请检查网络后重试',
      errTokenVerify: '服务端返回的凭证校验失败，请邮件联系作者处理',
    },
  },
  /**
   * 天文实验室（M2 骨架：/lab 首页 + /lab/meteor-shower 场景页 + 主界面入口）。
   * 条目标题/描述键由 utils/lab.ts 注册表以 MessageKey 类型引用（契约 C4）。
   */
  lab: {
    /** 主界面控制面板入口（emoji 🔭 由组件层持有） */
    entrySection: '天文实验室',
    entryLabel: '进入天文实验室',
    entryAria: '打开天文实验室（新标签页）',
    /** /lab 首页 */
    title: '天文实验室',
    subtitle: '基于真实星表与物理模型的可交互天象实验',
    backToApp: '返回星图',
    backToLab: '返回实验室',
    open: '进入实验',
    dataSourceLabel: '数据来源',
    /** 场景页加载态（next/dynamic 场景 chunk + 亮星 JSON 两级提示） */
    loadingScene: '正在加载实验室场景…',
    loadingStars: '正在加载亮星星表…',
    starsFailed: '亮星星表加载失败，星穹暂不可用——请刷新页面重试',
    /** 未注册条目占位（/lab/<id> 直达无效 id 时） */
    unknownEntry: '未注册的实验条目',
    /** 场景操作提示（方案 A：双指滚动环顾 / 捏合缩放视野） */
    hintLookAround: '拖动或双指滚动环顾夜空 · 双指捏合缩放视野',
    /** 流星雨条目（utils/lab.ts 注册表引用） */
    meteorShowerTitle: '盛夏双重流星雨',
    meteorShowerDescription:
      '英仙座与天鹅座κ双流星雨的物理仿真观测场：耶鲁亮星目录真实星穹（8,404 颗，视星等 ≤ 6.5）按地平坐标投影，可环顾仰望的北纬夜空；另附 1966 狮子座流星暴历史场景重现。',
    /** M3 控件面板/科普卡片/HUD/辐射点标注（单位记号 ×/h/°/m/s/mag 由组件层持有） */
    panelTitle: '观测控制台',
    showerTabAria: '切换流星雨',
    showerPerseids: '英仙座',
    showerKappaCygnids: '天鹅座κ',
    /** M3.7 流星暴页签（1966 狮子座历史事件重现）+ 延时摄影档 */
    showerLeonids1966: '狮子座暴 1966',
    cardRadiant: '辐射点',
    cardSpeed: '入速',
    cardZhr: 'ZHR',
    cardParent: '母体',
    parentPerseids: '109P/Swift–Tuttle 彗星',
    parentKappaCygnids: '未确定（候选体尚存争议）',
    parentLeonids: '55P/Tempel–Tuttle 彗星',
    stormNote1966: '历史重现：1966-11-17 狮子座流星暴，按保守文献值 ZHR 40,000 仿真（峰值估计一度达约 40 颗/秒）',
    ctrlTimeScale: '时间流速',
    ctrlTimeLapse: '延时摄影',
    ctrlHourOffset: '地方时偏移',
    ctrlLimitingMag: '光害（极限星等）',
    ctrlObserverLat: '观测纬度',
    ctrlAdvanced: '高级控件',
    ctrlFireballRate: '火流星概率增益',
    ctrlWindSpeed: '高空风速',
    ctrlRadiantMarker: '辐射点标注',
    hudLocalTime: '地方时',
    hudRadiantAlt: '辐射点高度角',
    /** 辐射点标注星座名（3D 场景经 LabelText 叶组件消费） */
    radiantLabelPerseids: '英仙座',
    radiantLabelKappaCygnids: '天鹅座',
    radiantLabelLeonids: '狮子座',
    /**
     * M3.5 目验辅助：视角切换/倒计时/快进/演示/跟随/燃烧层参考。
     * demoDisclaimer 为时间真实性红线常显标注（演示 = 时间轴外注入）；
     * vaporizedToast 为烧尽点科普收尾（落地成坑禁止实现，科学红线）。
     */
    viewModeAria: '切换观测视角',
    viewGround: '地面',
    viewSpace: '太空',
    hudNextMeteor: '下一颗流星',
    hudNextFireball: '下一颗火流星',
    ffMeteor: '快进到下一颗流星',
    ffFireball: '快进到下一颗火流星',
    demoMeteor: '演示流星',
    demoFireball: '演示火流星',
    demoDisclaimer: '演示为时间轴外注入，非当前时刻真实流量调度',
    ctrlFollowOnDemo: '触发时跟随',
    followExit: '退出跟随 (ESC)',
    vaporizedToast: '流星体已完全汽化，未及地面——彗星质地流星体在 80–115 km 高空烧尽，不会落到地面',
    ctrlBurnLayer: '燃烧层参考盘（80/115 km）',
    hintSpace: '拖动环绕俯瞰燃烧层 · 滚轮缩放距离',
    /**
     * M4 音频可听化（§5）+ 移动端底部抽屉 + 帮助提示（§3 辅助 UI）。
     * sonificationNote 为科学口径红线常显说明（真实流星无声；射电回波为
     * 无线电观测手段、静电传声为有争议的罕见现象），双语不可省略。
     */
    audioEnable: '流星音效（可听化）',
    audioVolumeAria: '音效音量',
    sonificationNote:
      '可听化（sonification）说明：真实流星本身无声。哨鸣模拟射电回波——流星电离尾对无线电信号的前向散射，属无线电观测手段；火流星爆裂声对应"静电传声"，为尚存争议的罕见现象。',
    helpTips:
      '拖动或双指滚动环顾夜空；打开辐射点标注找到标记——流星都从那里向四方飞出；用快进/演示按钮可立即看到一颗。',
    panelExpandAria: '展开观测控制台',
    panelCollapseAria: '收起观测控制台',
    /**
     * O1 天体观察站（/lab/observatory）：画廊/门控/观察工位文案。
     * 门控口径红线：锁定与解锁提示为对价口径（unlock 组同轨），
     * 禁止与赞助（零回报）口径交叉。
     */
    observatoryTitle: '天体观察站',
    observatoryDescription:
      '开放全部近观细节工位：恒星表面、体积星云、星系近观、黑洞引力透镜等 23 个观察对象，附实时调参滑杆、性能读数与预设视角。',
    observatoryPickBody: '选择观察对象',
    observatoryEnter: '进入观察',
    observatoryBackToGallery: '返回天体列表',
    observatoryPremiumBadge: '支持者专属 · 每日限量试玩',
    observatoryFreeWindowNote: '限时免费开放中：{date} 前全部天体不限次',
    observatoryEntitledNote: '支持者权益已激活：全部天体不限次',
    observatoryQuotaLine: '今日剩余观察 {count} 次',
    observatoryPremiumQuotaLine: '专属天体今日试玩剩余 {count} 次',
    observatoryLockedTitle: '观察受限',
    observatoryLockedDaily: '今日免费观察次数已用完，解锁后不限次，或明天再来。',
    observatoryLockedPremium:
      '支持者专属天体的今日试玩次数已用完，解锁后不限次，或明天再来。',
    observatoryUnknownBody: '未注册的观察对象',
    /** 观察工位 HUD/面板（帧率读数复用 perfMonitor.* 键组） */
    obsHudFps: '帧率',
    obsHudHeap: 'JS 堆',
    obsHudClock: '虚拟时钟',
    obsHudQuality: '体积质量档',
    obsHudSource: '来源',
    obsPanelBloom: '辉光 Bloom',
    obsPanelGrid: '参考网格',
    obsPanelExposure: '曝光',
    obsPanelPresets: '预设视角',
    obsPanelParams: '观察参数',
    /** 观察对象标题（devPreview 注册表 titleKey 引用，23 条） */
    obsBodyBetelgeuse: '参宿四 · 红超巨星',
    obsBodyRigel: '参宿七 · 蓝超巨星',
    obsBodySirius: '天狼星 A · 主序星',
    obsBodySiriusB: '天狼星 B · 白矮星',
    obsBodyDeltaCephei: '造父一 · 黄超巨星',
    obsBodyWr124: 'WR 124 · 沃尔夫-拉叶星与抛射壳',
    obsBodyVolumeTest: '体积云测试体（技术演示）',
    obsBodyOrionNebula: '猎户座星云 M42',
    obsBodyRingNebula: '环状星云 M57',
    obsBodyHorsehead: '马头星云 Barnard 33',
    obsBodyCrabPulsar: '蟹状星云 M1',
    obsBodyM31: '仙女座星系 M31',
    obsBodyM33: '三角座星系 M33',
    obsBodyLmc: '大麦哲伦云 LMC',
    obsBodySmc: '小麦哲伦云 SMC',
    obsBodyM87: '室女座 A M87 · 星系团中心',
    obsBodyBlackholeTest: '黑洞引力透镜（技术演示）',
    obsBodyPleiades: '昴星团 M45',
    obsBodyM13: '武仙座球状星团 M13',
    obsBodyQuasar3c273: '类星体 3C 273',
    obsBodyAntennae: '触须星系 NGC 4038/4039',
    obsBodyClusterLensing: '星系团引力透镜（技术演示）',
    obsBodyGrb: '伽马射线暴 GRB 221009A',
    /** 观察参数滑杆标签（devPreview 注册表 labelKey 引用，同语义键跨条目复用） */
    obsParamTeff: '有效温度 Teff（K）',
    obsParamCellScale: '对流噪声频率',
    obsParamTimeScale: '时间流速',
    obsParamShAmplitude: '球谐斑块幅度',
    obsParamShSpeed: '球谐演化速度',
    obsParamEjectaDensity: '抛射壳密度倍率',
    obsParamExpandAmp: '径向膨胀幅度',
    obsParamSteps: '基准步进数',
    obsParamRaySteps: '步进数',
    obsParamDensity: '密度倍率',
    obsParamCurtainDensity: '发射幕密度倍率',
    obsParamAbsorption: '吸收系数',
    obsParamHueA: '色相 A（Hα 红）',
    obsParamHueB: '色相 B（OIII 青绿）',
    obsParamIntensity: '亮度',
    obsParamQuality: '质量档（0自动 1低 2中 3高）',
    obsParamJitter: '蓝噪声抖动（0关 1开）',
    obsParamWeightBias: '双色权重（−OIII/+Hα）',
    obsParamDust: '尘埃吸收倍率',
    obsParamImageDriven: '影像驱动（0 参数化对照/1 影像）',
    obsParamDustStrength: '尘埃带强度',
    obsParamDustStrengthNoop: '尘埃带强度（此天体不适用）',
    obsParamHiiDensity: 'HII 区密度',
    obsParamHiiDensityNoop: 'HII 区密度（此天体不适用）',
    obsParamInclination: '倾角覆写（°）',
    obsParamVolExtinction: '体积尘埃消光强度（0 = 关闭）',
    obsParamVolThickness: '尘埃盘厚（光年）',
    obsParamDor30Boost: '30 Dor 亮度（0 关闭）',
    obsParamDor30Scale: '30 Dor 尺度放大',
    obsParamGcCount: '球状星团数量',
    obsParamMembers: '室女座成员点缀（0 关/1 开）',
    obsParamIcmOpacity: 'ICM 弥散辉光强度',
    obsParamMassScale: '质量尺度',
    obsParamCameraDistance: '相机距离',
    obsParamDiskIncl: '盘倾角（°，0=正视/90=侧视）',
    obsParamDiskInner: '盘内缘（r_s）',
    obsParamDiskOuter: '盘外缘（r_s）',
    obsParamBeamStrength: '束流强度',
    obsParamSizeGain: '粒径增益',
    obsParamSpikeGain: '星芒尺寸',
    obsParamNebulaStrength: '反射星云强度',
    obsParamBrightnessGain: '亮度增益',
    obsParamDiskGain: '盘亮度',
    obsParamTorusGain: '尘埃环面亮度',
    obsParamJetAngle: '喷流全开角（°）',
    obsParamJetGain: '喷流亮度',
    obsParamShellGain: '余辉强度',
    obsParamEinsteinRadius: '爱因斯坦半径（场景单位）',
    obsParamLensStrength: '透镜强度',
    obsParamSourceGain: '背景源亮度',
    /** 预设视角按钮标签（devPreview 注册表 viewPresets.labelKey 引用） */
    obsPresetOverview: '全景语境',
    obsPresetCore: '核心推近（EHT 光子环）',
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
    /** B3-D 语言切换说明（i18n 全站覆盖后更新：数据/标签/说明均随语言切换） */
    langNote:
      '语言 Language：左上角面板 zh/EN 按钮即时切换界面语言（界面、天体标签与说明均切换；数据来源署名保持原文）',
    /** B5 展馆模式与 H 键说明（新增行） */
    kioskNote:
      'H 隐藏/显示界面 · 展馆模式：左上角面板启动（全屏自动巡游，任意操作暂停、片刻无操作自动恢复）或以 ?mode=kiosk 链接启动',
    /** M4-5 触屏版引导（isTouch 分流：替换键鼠口径首段；快捷键段落隐藏） */
    controlsTouch: '单指拖动旋转 · 双指缩放/平移 · 点按选中天体',
    closeAria: '关闭引导',
    /** 关闭后底部中央"?"重开按钮（UI 布局优化：引导 5 秒自动关闭后可重开） */
    reopenAria: '重新打开操作引导',
  },
  /** M3 移动布局底部标签栏（仅 isCompact 渲染；emoji/符号由组件层持有） */
  tabBar: {
    help: '帮助',
    helpAria: '打开操作引导',
    controls: '控制',
    controlsAria: '打开控制面板',
    contact: '投喂',
    contactAria: '打开投喂与合作面板',
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
  /** B5 展馆模式（kiosk）暂停角标 */
  kiosk: {
    /** 暂停角标正文（{sec} = 自动恢复倒计时秒数） */
    pausedBadge: '展馆模式（暂停中，{sec} 秒后恢复）',
    /** 退出按钮 */
    exit: '退出',
    exitAria: '退出展馆模式',
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
    colorBoost: '星系色彩增强',
    colorBoostNote:
      '增强红黄/蓝白色彩对比便于分辨恒星与星系类型；关闭后为真实观测色调（对比较弱，偏黄白）',
    bloom: '泛光效果（Bloom，低性能设备可关闭）',
    performance: '性能监控（FPS/内存）',
    kioskSection: '展馆模式',
    kioskStart: '启动展馆模式（全屏自动巡游）',
    kioskNote: '按当前巡游域自动逐站飞往；任意操作暂停，片刻无操作自动恢复',
    demoSection: '动态事件演示',
    /** 面板收起/展开把手（UI 布局优化） */
    collapseAria: '收起控制面板',
    expandAria: '展开控制面板',
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
    /**
     * 显示开关下方来源/科学说明段（i18n 全站覆盖：原 B3 方案 K3 豁免解除）。
     * zh 值与原 JSX 空白折叠结果逐字符一致（中文态逐像素等价，勿改空白）。
     */
    catalogNote:
      '{source}；失真登记：{distortions}。 关闭或数据缺失时回落程序化宇宙网示意',
    expandNote:
      '银河系整体随增益 morph 为扁旋转椭球体（银盘粒子/超新星随盘 抬升、特殊天体垂直高度按增益展开；观察辅助的视觉夸大， 指示线标注为未放大的银纬推算高度）',
    realScaleNote:
      '真实比例下行星/矮行星极小（矮行星过小不可见属科学事实）， 可飞往/跟随后近距离观察',
    cutawayNote: '剖面下核心/辐射区/对流区可点选查看科普；外部活动特效已暂时淡出',
  },
  hud: {
    simTime: '模拟时间：{value}',
    /** 大时间尺度专业历元副行（主行为"距今约 …"通俗表示，UI 布局优化） */
    simEpoch: '（天文历元 {value}）',
    /** 沉浸模式（页面最大化）按钮（emoji 由组件层持有） */
    immersiveEnter: '最大化（收起面板）',
    immersiveExit: '退出最大化',
    /** M3-5：全屏 API 不可用（iPhone Safari）时的降级文案（仅收起 UI） */
    immersiveEnterNoFullscreen: '收起面板（此浏览器不支持全屏）',
    /** M4-3：H 键 UI 显隐的触屏等价入口（沉浸按钮旁"隐藏界面"+ 恢复角标） */
    uiHide: '隐藏界面',
    uiShow: '显示界面',
    /** M3 移动版顶部状态条：tap 展开/收起详情 */
    statusExpandAria: '展开状态详情',
    statusCollapseAria: '收起状态详情',
    /** M3 移动版信息面板底部半屏卡：顶部拖拽把手（下滑关闭） */
    sheetDragAria: '下滑关闭面板',
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
    infoCollapseAria: '收起信息面板内容',
    infoExpandAria: '展开信息面板内容',
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
    scene: '正在加载星系场景…',
  },
  /** 音频提示（M5-1：AudioContext.resume 失败从静默改为用户可见） */
  audioNotice: {
    resumeFailed: '音效未能启动：浏览器拦截了音频播放，请再点一次「音效」开关重试。',
    dismissAria: '关闭音效提示',
  },
  /** 404 页（app/not-found.tsx） */
  notFound: {
    title: '你已漂流到已知宇宙之外',
    body: '这片坐标上观测不到任何天体——页面不存在，或已被引力弹弓抛向了别处。',
    /** 倒计时行模板（渲染侧按 {sec} 拆分，秒数 span 样式由组件持有） */
    autoReturn: '{sec} 秒后自动返回星图',
    returnNow: '立即返回星图',
  },
  /**
   * 3D 场景标签（天体名之外的说明性标签；天体名经 displayBodyName 收口）。
   * 消费侧为 Scene/LocalizedLabelText 叶组件（订阅 locale，重渲染
   * 限制在 Html 标签 DOM 层，不触发 3D 场景重建——附录 A 性能纪律）。
   */
  sceneLabel: {
    siriusA: '天狼星A · 主序星',
    siriusB: '天狼星B · 白矮星',
    youAreHere: '你在这里（太阳系）',
    galacticYearPercent: '银河年 {percent}%',
    oortCloud: '奥尔特云外边界（示意，实际 2,000–100,000 AU）',
    terminationShock: '终端激波（示意，约 {au} AU）',
    heliosheath: '日鞘（渐变区）',
    heliopause: '日球层顶（示意，实际约 120 AU）',
    /** 旅行者标记名后缀（前接 displayBodyName） */
    voyagerCrossedSuffix: '（{year} 穿越）',
    /** 类星体 3C 273 标签后缀（前接 displayBodyName） */
    quasarSuffix: '（约 24 亿光年）',
    /** 触须星系标签后缀 */
    antennaeSuffix: '（星系碰撞现场，约 4500 万光年）',
    lensingArcs: '星系团引力透镜弧（示意，原型 Abell 370）',
    /** 伽马射线暴标签后缀 */
    grbSuffix: '（演示重放，约 20 亿光年）',
    localGroupMotion: '本星系群本动 ~{v} km/s（朝巨引源/沙普利方向，相对 CMB）',
    observableEdge: '可观测宇宙边界示意（半径约 465 亿光年）',
    laniakeaBoundary: '拉尼亚凯亚超星系团边界示意（直径约 5.2 亿光年）',
    greatAttractor: '巨引源',
    mergerCountdown:
      '银河系—仙女座相互接近（~110 km/s），约 {gyr} 十亿年后碰撞合并',
    mergerStage: '银河系—仙女座合并演化：{stage}',
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
