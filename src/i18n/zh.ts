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
    badgeLabel: "商业合作",
    /** 展开卡片的无障碍名称 */
    dialogAriaLabel: "商业合作联系方式",
    /** 卡片标题 */
    title: "商业合作",
    /** 卡片说明（README「商业合作」小节同源语义，中性文案口径） */
    description:
      "欢迎教育机构、科技馆与展陈集成商联系：展馆大屏部署、定制开发、课程内容。",
    /** GitHub Issues 链接文字 */
    githubIssues: "GitHub Issues",
    /** 爱发电赞助链接文字（emoji 由组件层持有） */
    sponsor: "爱发电赞助支持",
    /** 捐赠入口按钮文字（emoji ☄️ 由组件层持有；跳转 /donate 新页面） */
    donateLabel: "投喂燃料",
    donateAria: "打开捐赠页（新标签页）",
    /** 支持者解锁入口（Z 迭代 M3 统一口径后允许；emoji 🔓 由组件层持有） */
    unlockLabel: "支持者解锁",
    unlockAria: "打开解锁页（新标签页）",
    /** M3 移动弹层关闭按钮（居中弹层化，桌面不使用） */
    closeAria: "关闭投喂与合作面板",
  },
  /**
   * 捐赠页（/donate，Z 迭代 M3 起统一"支持即解锁"口径——渠道顺序
   * 支付宝→微信→爱发电→Ko-fi→预留位，支付宝为引导面板跳 /unlock）。
   * 边界：不承诺更新义务；解锁承诺仅限"付 ¥X 得 Y 天"的既有对价事实。
   */
  donate: {
    title: "投喂燃料",
    subtitle: "支持项目，即刻解锁高级内容",
    intro:
      "支持项目即可解锁高级内容：推荐支付宝扫码支付——支付成功后自动发放解锁凭证、即时解锁近观细节层与巡游演示，昵称与留言（均可选）将记入贡献者名单与贡献者宇宙。项目的全部源代码保持开源，你的支持将用于持续开发与域名维护，让它保持免费、无广告、开源。",
    platformsSection: "支持通道",
    platformAvailable: "前往支持",
    platformComingSoon: "预留位 · 即将开通",
    /** 支付宝引导面板（付款 modal 只在 /unlock，本页仅引导跳转） */
    alipayGuide:
      "推荐渠道：在解锁页点击档位卡片生成付款码，支付成功后自动发放解锁 token 并即时解锁，无需注册账号；昵称自动记入贡献者名单。",
    alipayCta: "前往解锁页扫码支付",
    /** 微信独立 panel（人工核验口径 + 邮件模板，模板与解锁页同源键） */
    wechatGuide:
      "备选渠道：微信打赏无法自动核验，需人工处理，解锁 token 只经 Email 发送（非即时，通常 48 小时内）；急用请走上方支付宝扫码。按档位金额支付后，按下方邮件模板发送邮件，附支付截图与交易时间。",
    /** 备选通道卡片说明行 */
    mbdNote: "备选 · 扫码即付无需注册，支付后凭订单号在解锁页自动兑换",
    afdianNote: "备选 · 支付后凭订单号在解锁页自动兑换（需注册爱发电账号）",
    kofiNote: "海外备选 · 人工核验，解锁 token 经 Email 发送",
    wechatQrAlt: "微信赞赏码",
    wechatQrHint: "微信内长按识别，或用手机微信扫码；金额请按档位价格支付",
    donorsSection: "燃料补给名单",
    donorsNote: "按累计捐赠金额降序排列（人工登记，可能存在延迟）",
    donorsEmpty: "虚位以待——成为第一颗点亮航程的星。",
    donorAmount: "¥{amount}",
    /** 名单区贡献者宇宙入口（C4-1；emoji ✨ 由组件层持有；陈述口径，无回报承诺） */
    contributorsEntry: "进入贡献者宇宙",
    backToApp: "返回星图",
  },
  /**
   * 贡献者宇宙页（/contributors，C2）。文案红线（REQUIREMENTS_CONTRIBUTORS §0.5）：
   * 一律陈述口径（"这里陈列了每一位支持者"），禁止"捐赠即点亮专属星"类承诺式表述。
   */
  contributors: {
    title: "贡献者宇宙",
    subtitle: "这里陈列了每一位支持者——每颗星对应一位已登记的燃料补给者",
    intro:
      "星的大小与亮度按累计捐赠金额的对数映射呈现，位置由昵称与平台确定性生成，与登记顺序无关。",
    sortNote: "按累计捐赠金额降序排列（人工登记，可能存在延迟）",
    empty: "虚位以待——成为第一颗点亮航程的星。",
    goDonate: "前往捐赠页",
    backToApp: "返回星图",
    /** 桌面操作提示 */
    hintDesktop: "拖动环视 · 滚轮缩放 · 点击星星查看详情",
    /** 触屏操作提示（C3-1，isTouch 分流） */
    hintTouch: "单指拖动环视 · 双指缩放 · 点按聚焦贡献者",
    /** 画布下方常驻文字名单（兼作屏幕阅读器/降级形态，实现裁决登记于需求文档） */
    listSection: "文字名单",
    webglFallback: "当前环境不支持 3D 渲染，已切换为文字名单。",
    preparing: "正在点亮星空…",
    detailAmount: "金额",
    detailDate: "登记日期",
    detailPlatform: "平台",
    detailMessage: "留言",
    detailCloseAria: "关闭详情卡",
    /** M2 动态名单（D-z4）：空昵称展示名 + 支付宝渠道展示名（注册表外平台） */
    anonymous: "匿名用户",
    platformAlipay: "支付宝",
  },
  /**
   * 解锁页（/unlock，U3；Z 迭代 M3 起统一"支持即解锁"口径）。
   * 本页为明码标价对价口径（允许"支付 ¥X 解锁 Y 天"承诺式表述）；
   * 渠道顺序：支付宝（推荐）→ 微信 → 爱发电（备选）→ Ko-fi（海外备选）。
   */
  unlock: {
    title: "支持者解锁",
    subtitle: "解锁近观细节层与巡游序列的限时访问",
    intro:
      "以下为明码标价的限时访问：按档位金额支付后自动或凭凭证兑换解锁，到期自动恢复免费体验；支持者昵称与留言（均可选）将记入贡献者名单与贡献者宇宙。项目源代码保持开源。",
    backToApp: "返回星图",
    /** 权益状态区 */
    statusSection: "我的权益",
    statusFree: "当前为免费体验——近观细节层、L3/L4 巡游与不限次演示未解锁。",
    statusActive: "权益已激活",
    statusTierLabel: "档位",
    statusExpiryLabel: "到期日",
    statusRemainingLabel: "剩余",
    statusRemainingDays: "{days} 天",
    tierWeek: "周卡",
    tierMonth: "月卡",
    tierYear: "年卡",
    copyToken: "复制我的 token",
    copyTokenDone: "已复制到剪贴板",
    copyTokenFail: "自动复制失败，请手动选择下方文本复制",
    copyTokenAria: "复制解锁 token（换设备时粘贴激活）",
    clearEntitlement: "清除权益",
    clearConfirmHint: "清除后需重新粘贴 token 才能恢复，请先妥存 token。",
    clearConfirmYes: "确认清除",
    clearConfirmNo: "取消",
    /** 档位价格表 */
    tiersSection: "解锁档位",
    tierColumnTier: "档位",
    tierColumnPriceCny: "价格（¥）",
    tierColumnPriceUsd: "参考价（$）",
    tierColumnDays: "时长",
    tierPriceCny: "¥{price}",
    tierPriceUsd: "${price}",
    tierDays: "{days} 天",
    benefitsTitle: "解锁内容（三档相同，仅时长不同）",
    benefitDetail:
      "全部近观细节层：恒星表面、体积星云、黑洞引力透镜、星团/星系与河外天体近观（共 24 处）",
    benefitTour: "L3/L4 巡游序列：银河系与宇宙视角下的天体巡游切换",
    benefitDemo: "事件演示不限次：耀斑 / CME / 超新星 / 星系合并预览",
    refundTitle: "退款与说明",
    refundPolicy:
      "未兑换的订单可全额退款；已兑换订单如发生退款，对应解锁凭证将同步失效。不提供发票；到期后不自动续费。",
    /** 四通道购买与兑换区（M3 渠道重排：支付宝→微信→爱发电→Ko-fi） */
    channelsSection: "购买与兑换",
    alipayChannelTitle: "支付宝扫码支付（推荐 · 支付后自动发码即时解锁）",
    alipayChannelGuide:
      "点击上方档位卡片即可扫码支付：支付成功后自动发放解锁 token 并即时激活权益，无需注册账号；昵称与留言（均可选）将记入贡献者名单。",
    alipayChannelCta: "选择档位扫码支付",
    mbdTitle: "面包多（备选 · 订单号自动兑换）",
    mbdGuide:
      "扫码即付，无需注册账号。前往面包多按档位购买对应商品，支付完成后订单号会显示在商品页下方，粘贴到下方即可自动兑换。",
    mbdLink: "前往面包多购买",
    mbdOrderInputLabel: "面包多订单号",
    mbdOrderInputPlaceholder: "粘贴订单号（32 位字母数字）",
    mbdOrderInvalid: "订单号应为 32 位字母数字，请在面包多商品页下方复制",
    afdianTitle: "爱发电（备选 · 订单号自动兑换）",
    afdianGuide:
      "需注册爱发电账号。前往爱发电按档位金额购买（周卡/年卡为商品，月卡为订阅方案），支付完成后在下方粘贴订单号即可自动兑换。",
    afdianLink: "前往爱发电购买",
    orderInputLabel: "爱发电订单号",
    orderInputPlaceholder: "粘贴订单号（14-40 位数字）",
    orderInvalid: "订单号应为 14-40 位数字，请在爱发电「我的订单」中复制",
    redeemButton: "兑换",
    redeemPending: "兑换中…",
    redeemSuccess: "兑换成功，权益已激活！",
    errInvalidOrder: "订单号无效，请核对后重试",
    errOrderNotPaid: "订单未完成支付，请支付后再兑换",
    errAmountTooLow: "订单金额不足最低档位（¥6），无法兑换",
    errAlreadyRedeemed: "该订单已被兑换过（如系本人换设备，请用原 token 激活）",
    errUpstream: "订单查询服务暂时不可用，请稍后重试",
    errNotConfigured: "兑换服务尚未开通，请稍后再来或邮件联系",
    errPlanNotEligible:
      "该订单对应的商品不支持解锁兑换，请核对购买的是解锁档位商品",
    errUnknown: "兑换失败（未知错误），请稍后重试或邮件联系",
    errNetwork: "网络请求失败，请检查网络后重试",
    wechatTitle: "微信赞赏码（人工核验 · token 经 Email 发送）",
    /** 常显短句（微信小节默认收起——引导优先走支付宝，M4 后续微调） */
    wechatGuide:
      "需人工处理，解锁 token 只经 Email 发送（非即时，通常 48 小时内）——推荐优先使用上方支付宝扫码，自动发码、即时解锁。",
    /** 展开区支付步骤（含兑换邮箱插值） */
    wechatSteps:
      "按所选档位金额扫码支付后，按下方邮件模板发送兑换邮件至 {email}，附支付截图与交易时间。",
    wechatExpand: "展开微信支付步骤（赞赏码 + 邮件模板）",
    wechatCollapse: "收起微信支付步骤",
    wechatQrAlt: "微信赞赏码",
    wechatQrHint: "微信内长按识别，或用手机微信扫码；金额请按档位价格支付",
    kofiTitle: "Ko-fi（海外备选 · 人工核验）",
    kofiGuide:
      "按档位对应的 $ 金额通过 Ko-fi 支付，然后发送兑换邮件至 {email}，附支付凭证与交易时间，我们将回信发送解锁 token（通常 48 小时内）。",
    kofiLink: "前往 Ko-fi 支付",
    emailCta: "发送兑换邮件",
    emailSubject: "星海奥德赛解锁兑换",
    /**
     * 人工渠道兑换邮件模板（/unlock 与 /donate 两页同源消费，M3）：
     * 主题复用 emailSubject；正文 {email} 插值 CONTACT_EMAIL 同源常量。
     * 不写价格（价格同源纪律：档位价只在 unlockPricing.ts 及登记同源点）。
     */
    mailTplHint: "邮件模板（可一键复制，或直接打开邮件客户端自动填好）：",
    mailTplToLabel: "收件人",
    mailTplSubjectLabel: "主题",
    mailTplBody:
      "昵称（可选，将记入贡献者名单）:\n所购档位（周卡/月卡/年卡）与支付渠道:\n支付截图: 见附件\n交易时间:\n留言（可选，将展示在名单）:\n\n说明: 解锁 token 将回复至本邮件的发件邮箱，请确保能正常收信；若长时间未收到，请检查垃圾邮件文件夹，并将 {email} 加入通讯录。",
    mailTplCopy: "复制邮件模板",
    mailTplCopied: "已复制",
    mailTplOpen: "打开邮件客户端",
    /** token 粘贴区 */
    tokenSection: "已有 token？在此激活",
    tokenIntro:
      "人工通道回信、换设备迁移或 B2B 交付的 token 都在这里粘贴激活。",
    tokenInputLabel: "解锁 token",
    tokenInputPlaceholder: "粘贴 SO1. 开头的完整 token",
    tokenActivate: "激活",
    tokenErrFormat: "token 格式不正确，请确认完整复制（SO1. 开头共三段）",
    tokenErrSignature: "token 签名校验失败，请勿改动 token 内容后重试",
    tokenErrExpired: "token 已过期，可重新购买任意档位续期",
    tokenActivated: "权益已激活！",
    /**
     * A6-3 吊销链路提示（裁决 ⑤⑥ 原文照录，勿改写；双轨红线：零
     * "捐赠/赞助"字样，链接仅指 /unlock——组件层按钮复用 lockedGoUnlock）
     */
    revokedNotice:
      "这枚凭证已随退款静静熄灭。星海别来无恙，四万个星系仍在原处等你——愿意再度启程时，解锁页的门始终为你亮着。",
    revokeCheckFailed: "未能核验凭证状态，请检查网络连接后重试。",
    /**
     * U2 主应用门控（锁定提示 HUD / ControlPanel 入口 / 巡游控件）。
     * panelStatusFree/panelStatusActive 为面板紧凑态状态行（与上方
     * 解锁页 statusFree/statusActive 语义不同，勿合并）。
     */
    lockedTitle: "支持者专属内容",
    lockedDetailBody: "该近观细节为支持者专属，解锁后即可贴近观赏。",
    lockedCycleBody: "银河系/宇宙巡游序列为支持者专属，解锁后可逐站巡游。",
    lockedQuotaBody: "今日免费演示次数已用完，解锁后不限次，或明天再来。",
    lockedGoUnlock: "前往解锁",
    lockedGoUnlockAria: "打开解锁页（新标签页）",
    lockedCloseAria: "关闭锁定提示",
    panelSection: "支持者解锁",
    panelStatusFree: "免费体验中",
    panelStatusActive: "{tier} · 剩余 {days} 天",
    panelGo: "查看解锁方案",
    panelGoAria: "打开解锁页（新标签页）",
    demoQuotaRemaining: "今日免费演示剩余 {count} 次",
    demoQuotaExhausted: "今日免费演示次数已用完，解锁后不限次",
    cycleLockedTooltip: "银河系/宇宙巡游为支持者专属",
    /**
     * Z 迭代 M2 支付宝当面付付款 modal（REQUIREMENTS_ALIPAY_UNLOCK §5.1；
     * 对价口径同本组红线——支付后自动发码即时解锁为明码标价承诺，允许）。
     */
    alipay: {
      tierCta: "支付宝扫码支付",
      tierCtaAria: "选择{tier}，打开支付宝扫码付款窗口",
      modalTitle: "支付宝扫码支付",
      closeAria: "关闭付款窗口",
      tierLine: "{tier} · ¥{price} / {days} 天",
      nicknameLabel: "昵称（可选）",
      nicknamePlaceholder: "将记入贡献者名单，留空显示「匿名用户」",
      messageLabel: "留言（可选）",
      messagePlaceholder: "随昵称一起展示，最多 50 字",
      publicNote: "昵称与留言将公开展示在贡献者名单与贡献者宇宙。",
      createButton: "生成付款码",
      creating: "正在生成付款码…",
      qrTitle: "打开支付宝「扫一扫」完成支付",
      qrAlt: "支付宝付款二维码",
      amountLine: "应付金额 ¥{amount}",
      expireHint: "二维码 30 分钟内有效；支付成功后本页自动激活权益。",
      openInAlipay: "在手机上打开支付宝付款",
      waiting: "等待支付确认…",
      paidTitle: "支付成功，权益已激活！",
      paidTokenHint:
        "以下为你的解锁 token，请妥善保存——换设备时在解锁页粘贴激活即可找回权益：",
      expiredNotice: "二维码已过期（超过 30 分钟未支付），请重新生成。",
      regenerate: "重新生成付款码",
      backToEdit: "返回修改",
      errNicknameTooLong: "昵称过长，请控制在 20 个字符以内",
      errNicknameBlocked: "昵称包含不适宜公开展示的内容，请修改后重试",
      errMessageTooLong: "留言过长，请控制在 50 个字符以内",
      errMessageBlocked: "留言包含不适宜公开展示的内容，请修改后重试",
      errNotConfigured: "支付宝支付尚未开通，请改用爱发电或其他渠道",
      errGateway: "支付宝预下单失败，请稍后重试",
      errOrderLost: "订单状态查询异常，请重新生成付款码",
      errUnknown: "操作失败（未知错误），请稍后重试或邮件联系",
      errNetwork: "网络请求失败，请检查网络后重试",
      errTokenVerify: "服务端返回的凭证校验失败，请邮件联系作者处理",
    },
  },
  /**
   * 天文实验室（M2 骨架：/lab 首页 + /lab/meteor-shower 场景页 + 主界面入口）。
   * 条目标题/描述键由 utils/lab.ts 注册表以 MessageKey 类型引用（契约 C4）。
   */
  lab: {
    /** 主界面控制面板入口（emoji 🔭 由组件层持有） */
    entrySection: "天文实验室",
    entryLabel: "进入天文实验室",
    entryAria: "打开天文实验室（新标签页）",
    /** /lab 首页 */
    title: "天文实验室",
    subtitle: "基于真实星表与物理模型的可交互天象实验",
    backToApp: "返回星图",
    backToLab: "返回实验室",
    open: "进入实验",
    dataSourceLabel: "数据来源",
    /** 场景页加载态（next/dynamic 场景 chunk + 亮星 JSON 两级提示） */
    loadingScene: "正在加载实验室场景…",
    loadingStars: "正在加载亮星星表…",
    starsFailed: "亮星星表加载失败，星穹暂不可用——请刷新页面重试",
    /** 未注册条目占位（/lab/<id> 直达无效 id 时） */
    unknownEntry: "未注册的实验条目",
    /** 场景操作提示（方案 A：双指滚动环顾 / 捏合缩放视野） */
    hintLookAround: "拖动或双指滚动环顾夜空 · 双指捏合缩放视野",
    /** 流星雨条目（utils/lab.ts 注册表引用） */
    meteorShowerTitle: "盛夏双重流星雨",
    meteorShowerDescription:
      "英仙座与天鹅座κ双流星雨的物理仿真观测场：耶鲁亮星目录真实星穹（8,404 颗，视星等 ≤ 6.5）按地平坐标投影，可环顾仰望的北纬夜空；另附 1966 狮子座流星暴历史场景重现。",
    /** M3 控件面板/科普卡片/HUD/辐射点标注（单位记号 ×/h/°/m/s/mag 由组件层持有） */
    panelTitle: "观测控制台",
    showerTabAria: "切换流星雨",
    showerPerseids: "英仙座",
    showerKappaCygnids: "天鹅座κ",
    /** M3.7 流星暴页签（1966 狮子座历史事件重现）+ 延时摄影档 */
    showerLeonids1966: "狮子座暴 1966",
    cardRadiant: "辐射点",
    cardSpeed: "入速",
    cardZhr: "ZHR",
    cardParent: "母体",
    parentPerseids: "109P/Swift–Tuttle 彗星",
    parentKappaCygnids: "未确定（候选体尚存争议）",
    parentLeonids: "55P/Tempel–Tuttle 彗星",
    stormNote1966:
      "历史重现：1966-11-17 狮子座流星暴，按保守文献值 ZHR 40,000 仿真（峰值估计一度达约 40 颗/秒）",
    ctrlTimeScale: "时间流速",
    ctrlTimeLapse: "延时摄影",
    ctrlHourOffset: "地方时偏移",
    ctrlLimitingMag: "光害（极限星等）",
    ctrlObserverLat: "观测纬度",
    ctrlAdvanced: "高级控件",
    ctrlFireballRate: "火流星概率增益",
    ctrlWindSpeed: "高空风速",
    ctrlRadiantMarker: "辐射点标注",
    hudLocalTime: "地方时",
    hudRadiantAlt: "辐射点高度角",
    /** 辐射点标注星座名（3D 场景经 LabelText 叶组件消费） */
    radiantLabelPerseids: "英仙座",
    radiantLabelKappaCygnids: "天鹅座",
    radiantLabelLeonids: "狮子座",
    /**
     * M3.5 目验辅助：视角切换/倒计时/快进/演示/跟随/燃烧层参考。
     * demoDisclaimer 为时间真实性红线常显标注（演示 = 时间轴外注入）；
     * vaporizedToast 为烧尽点科普收尾（落地成坑禁止实现，科学红线）。
     */
    viewModeAria: "切换观测视角",
    viewGround: "地面",
    viewSpace: "太空",
    hudNextMeteor: "下一颗流星",
    hudNextFireball: "下一颗火流星",
    ffMeteor: "快进到下一颗流星",
    ffFireball: "快进到下一颗火流星",
    demoMeteor: "演示流星",
    demoFireball: "演示火流星",
    demoDisclaimer: "演示为时间轴外注入，非当前时刻真实流量调度",
    ctrlFollowOnDemo: "触发时跟随",
    followExit: "退出跟随 (ESC)",
    vaporizedToast:
      "流星体已完全汽化，未及地面——彗星质地流星体在 80–115 km 高空烧尽，不会落到地面",
    ctrlBurnLayer: "燃烧层参考盘（80/115 km）",
    hintSpace: "拖动环绕俯瞰燃烧层 · 滚轮缩放距离",
    /**
     * M4 音频可听化（§5）+ 移动端底部抽屉 + 帮助提示（§3 辅助 UI）。
     * sonificationNote 为科学口径红线常显说明（真实流星无声；射电回波为
     * 无线电观测手段、静电传声为有争议的罕见现象），双语不可省略。
     */
    audioEnable: "流星音效（可听化）",
    audioVolumeAria: "音效音量",
    sonificationNote:
      '可听化（sonification）说明：真实流星本身无声。哨鸣模拟射电回波——流星电离尾对无线电信号的前向散射，属无线电观测手段；火流星爆裂声对应"静电传声"，为尚存争议的罕见现象。',
    helpTips:
      "拖动或双指滚动环顾夜空；打开辐射点标注找到标记——流星都从那里向四方飞出；用快进/演示按钮可立即看到一颗。",
    panelExpandAria: "展开观测控制台",
    panelCollapseAria: "收起观测控制台",
    /**
     * O1 天体观察站（/lab/observatory）：画廊/门控/观察工位文案。
     * 门控口径红线：锁定与解锁提示为对价口径（unlock 组同轨），
     * 禁止与赞助（零回报）口径交叉。
     */
    observatoryTitle: "天体观察站",
    observatoryDescription:
      "开放全部近观细节工位：恒星表面、体积星云、星系近观、黑洞引力透镜等 23 个观察对象，附实时调参滑杆、性能读数与预设视角。",
    observatoryPickBody: "选择观察对象",
    observatoryEnter: "进入观察",
    observatoryBackToGallery: "返回天体列表",
    observatoryPremiumBadge: "支持者专属 · 每日限量试玩",
    observatoryFreeWindowNote: "限时免费开放中：{date} 前全部天体不限次",
    observatoryEntitledNote: "支持者权益已激活：全部天体不限次",
    observatoryQuotaLine: "今日剩余观察 {count} 次",
    observatoryPremiumQuotaLine: "专属天体今日试玩剩余 {count} 次",
    observatoryLockedTitle: "观察受限",
    observatoryLockedDaily:
      "今日免费观察次数已用完，解锁后不限次，或明天再来。",
    observatoryLockedPremium:
      "支持者专属天体的今日试玩次数已用完，解锁后不限次，或明天再来。",
    observatoryUnknownBody: "未注册的观察对象",
    /** 观察工位 HUD/面板（帧率读数复用 perfMonitor.* 键组） */
    obsHudFps: "帧率",
    obsHudHeap: "JS 堆",
    obsHudClock: "虚拟时钟",
    obsHudQuality: "体积质量档",
    obsHudSource: "来源",
    obsPanelBloom: "辉光 Bloom",
    obsPanelGrid: "参考网格",
    obsPanelExposure: "曝光",
    obsPanelPresets: "预设视角",
    obsPanelParams: "观察参数",
    /** 观察对象标题（devPreview 注册表 titleKey 引用，23 条） */
    obsBodyBetelgeuse: "参宿四 · 红超巨星",
    obsBodyRigel: "参宿七 · 蓝超巨星",
    obsBodySirius: "天狼星 A · 主序星",
    obsBodySiriusB: "天狼星 B · 白矮星",
    obsBodyDeltaCephei: "造父一 · 黄超巨星",
    obsBodyWr124: "WR 124 · 沃尔夫-拉叶星与抛射壳",
    obsBodyVolumeTest: "体积云测试体（技术演示）",
    obsBodyOrionNebula: "猎户座星云 M42",
    obsBodyRingNebula: "环状星云 M57",
    obsBodyHorsehead: "马头星云 Barnard 33",
    obsBodyCrabPulsar: "蟹状星云 M1",
    obsBodyM31: "仙女座星系 M31",
    obsBodyM33: "三角座星系 M33",
    obsBodyLmc: "大麦哲伦云 LMC",
    obsBodySmc: "小麦哲伦云 SMC",
    obsBodyM87: "室女座 A M87 · 星系团中心",
    obsBodyBlackholeTest: "黑洞引力透镜（技术演示）",
    obsBodyPleiades: "昴星团 M45",
    obsBodyM13: "武仙座球状星团 M13",
    obsBodyQuasar3c273: "类星体 3C 273",
    obsBodyAntennae: "触须星系 NGC 4038/4039",
    obsBodyClusterLensing: "星系团引力透镜（技术演示）",
    obsBodyGrb: "伽马射线暴 GRB 221009A",
    /** 观察参数滑杆标签（devPreview 注册表 labelKey 引用，同语义键跨条目复用） */
    obsParamTeff: "有效温度 Teff（K）",
    obsParamCellScale: "对流噪声频率",
    obsParamTimeScale: "时间流速",
    obsParamShAmplitude: "球谐斑块幅度",
    obsParamShSpeed: "球谐演化速度",
    obsParamEjectaDensity: "抛射壳密度倍率",
    obsParamExpandAmp: "径向膨胀幅度",
    obsParamSteps: "基准步进数",
    obsParamRaySteps: "步进数",
    obsParamDensity: "密度倍率",
    obsParamCurtainDensity: "发射幕密度倍率",
    obsParamAbsorption: "吸收系数",
    obsParamHueA: "色相 A（Hα 红）",
    obsParamHueB: "色相 B（OIII 青绿）",
    obsParamIntensity: "亮度",
    obsParamQuality: "质量档（0自动 1低 2中 3高）",
    obsParamJitter: "蓝噪声抖动（0关 1开）",
    obsParamWeightBias: "双色权重（−OIII/+Hα）",
    obsParamDust: "尘埃吸收倍率",
    obsParamImageDriven: "影像驱动（0 参数化对照/1 影像）",
    obsParamDustStrength: "尘埃带强度",
    obsParamDustStrengthNoop: "尘埃带强度（此天体不适用）",
    obsParamHiiDensity: "HII 区密度",
    obsParamHiiDensityNoop: "HII 区密度（此天体不适用）",
    obsParamInclination: "倾角覆写（°）",
    obsParamVolExtinction: "体积尘埃消光强度（0 = 关闭）",
    obsParamVolThickness: "尘埃盘厚（光年）",
    obsParamDor30Boost: "30 Dor 亮度（0 关闭）",
    obsParamDor30Scale: "30 Dor 尺度放大",
    obsParamGcCount: "球状星团数量",
    obsParamMembers: "室女座成员点缀（0 关/1 开）",
    obsParamIcmOpacity: "ICM 弥散辉光强度",
    obsParamMassScale: "质量尺度",
    obsParamCameraDistance: "相机距离",
    obsParamDiskIncl: "盘倾角（°，0=正视/90=侧视）",
    obsParamDiskInner: "盘内缘（r_s）",
    obsParamDiskOuter: "盘外缘（r_s）",
    obsParamBeamStrength: "束流强度",
    obsParamSizeGain: "粒径增益",
    obsParamSpikeGain: "星芒尺寸",
    obsParamNebulaStrength: "反射星云强度",
    obsParamBrightnessGain: "亮度增益",
    obsParamDiskGain: "盘亮度",
    obsParamTorusGain: "尘埃环面亮度",
    obsParamJetAngle: "喷流全开角（°）",
    obsParamJetGain: "喷流亮度",
    obsParamShellGain: "余辉强度",
    obsParamEinsteinRadius: "爱因斯坦半径（场景单位）",
    obsParamLensStrength: "透镜强度",
    obsParamSourceGain: "背景源亮度",
    /** 预设视角按钮标签（devPreview 注册表 viewPresets.labelKey 引用） */
    obsPresetOverview: "全景语境",
    obsPresetCore: "核心推近（EHT 光子环）",
    /**
     * E-M2 日全食实验室（/lab/solar-eclipse）：条目卡/页签/HUD/时间轴。
     * 页签标题含日期与地点（§3.5）；锚点名由数据驱动锚点列表引用（契约 C7，
     * 月食条目将以 7 锚点复用同一 scrubber 组件）。
     */
    solarEclipseTitle: "日全食",
    solarEclipseDescription:
      "三场真实日全食的权威星历复现：2027 埃及世纪之食（全食 6 分 23 秒）、2035 北京家门口的全食、1919 爱丁顿验证广义相对论的历史之食。站在食甚中心线上，拖动时间轴亲历初亏到复圆。",
    eclipseTabAria: "切换日食事件",
    eclipseTab2027: "2027-08-02 · 埃及",
    eclipseTab2035: "2035-09-02 · 北京",
    eclipseTab1919: "1919-05-29 · 索布拉尔",
    /** 观测点说明（固定食甚中心线点，§0.1；全食时长为本站贝塞尔解） */
    eclipseObserver2027: "观测点：埃及新河谷省（食甚中心线，全食 6 分 23 秒）",
    eclipseObserver2035: "观测点：北京市郊怀柔—密云（中心线，全食 1 分 51 秒）",
    eclipseObserver1919:
      "历史场景 · 观测点：巴西索布拉尔（1919 爱丁顿观测队驻地，全食 5 分 14 秒）",
    /** 时间轴锚点名（五接触点，§1.3；数据驱动列表引用） */
    eclipseAnchorC1: "初亏",
    eclipseAnchorC2: "食既",
    eclipseAnchorMax: "食甚",
    eclipseAnchorC3: "生光",
    eclipseAnchorC4: "复圆",
    /** 时间轴 scrubber（M2-6 骨架 + M3 变速档；贝利珠窗高亮刻度 §3.1） */
    eclipseTimelineAria: "日食时间轴",
    eclipsePlay: "播放",
    eclipsePause: "暂停",
    /** HUD（500ms 刷新；视直径为真实值常显——契约 C4 不做几何放大） */
    eclipseHudUtc: "UTC",
    eclipseHudMagnitude: "食分",
    eclipseHudObscuration: "遮挡率",
    eclipseHudSunDiam: "日视直径",
    eclipseHudMoonDiam: "月视直径",
    /** HUD·M3 扩展（A1 登记：真实时刻 + 倍速常显；全食段剩余时间 §3.4） */
    eclipseHudRate: "倍速",
    eclipseHudPhase: "阶段",
    eclipseHudKind: "食型",
    eclipseHudTotalityLeft: "全食剩余",
    /** 食型/阶段名（eclipseKind 实时判定，§1.1 不硬编码事件类型） */
    eclipsePhaseNone: "无食",
    eclipsePhasePartial: "偏食",
    eclipsePhaseTotal: "全食",
    eclipsePhaseAnnular: "环食",
    /** 播放模式（§3.1：导览变速 = 偏食×60/全食×1，登记 A1） */
    eclipsePlayModeAria: "播放模式",
    eclipsePlayModeTour: "导览变速",
    eclipsePlayModeReal: "×1 真实",
    /** 曝光状态机（契约 C5：filtered/naked-eye 双基准 + 滑杆 + 自动档） */
    eclipseExposureTitle: "曝光",
    eclipseExposureAuto: "自动（人眼）",
    eclipseExposureManual: "手动",
    eclipseExposureSliderAria: "曝光（滤镜 ↔ 裸眼）",
    eclipseExposureFiltered: "滤镜",
    eclipseExposureNaked: "裸眼",
    /** 曝光科普卡（A2 登记：日冕亮度经色调映射压缩非线性真值） */
    eclipseExposureCard:
      "光球比日冕亮约 100 万倍（6 个数量级），任何一档曝光都无法同屏两者：滤镜档只见光球、裸眼档光球溢出泛光而日冕显形。本场景的日冕亮度经色调映射压缩，不是线性真值。",
    /** 太阳活动周滑杆（§3.3：绑定日冕 isotropy01，极小年赤道长冕流 ↔ 极大年圆胖） */
    eclipseActivityTitle: "太阳活动周",
    eclipseActivityAria: "太阳活动周（日冕形态）",
    eclipseActivityMin: "极小年",
    eclipseActivityMax: "极大年",
    /** 假想模式（§3.3：与真实时间轴互斥，HUD 明示） */
    eclipseHypoTitle: "假想模式",
    eclipseHypoToggleAria: "开关假想模式",
    eclipseHypoBadge: "假想模式：月地距离已改写，几何为重算值",
    eclipseHypoMoonDist: "月地距离",
    eclipseHypoMoonDistAria: "假想月地距离（km）",
    /** 99%/100% 一键对比（§3.3：天光断崖，纠正「偏食是小号全食」误解） */
    eclipseCompareTitle: "天光断崖对比",
    eclipseCompare99: "遮挡 99%",
    eclipseCompare100: "食甚 100%",
    /** 环境数值条（§1.4：不做粒子级模拟，信息面板实时数值） */
    eclipseEnvTitle: "环境",
    eclipseEnvTemp: "气温降幅",
    eclipseEnvSky: "天光亮度",
    eclipseEnvLm: "极限星等",
    /** 阶段科普卡（§3.1 五接触点；C2/C3 卡含安全口径——底稿 §七） */
    eclipseCardC1:
      "初亏：月缘首次切入日面。此后约一个多小时太阳被逐渐吃掉，但遮挡 90% 前你几乎察觉不到变暗——人眼的对数响应把变化藏起来了。地上树影里的光斑会先泄密：每个都是一枚小月牙。",
    eclipseCardC2:
      "食既前的最后时刻：阳光只剩月缘山谷间的几粒——贝利珠，大小与间距由真实月缘地形（LRO/LOLA 高程）决定；收敛到最后一珠即钻石环。注意：此刻光球仍在，现实中仍不可裸眼直视，须待完全食既。地面可能掠过快速的明暗波纹（影带——机制真实、形态为程序化再现）。",
    eclipseCardMax:
      "食甚：全食的正中。日冕向四周伸展（形态随太阳活动周变化），月缘外侧可见粉红色日珥剪影（分布为典型形态再现，非该次食实测）。环顾四周——地平线一圈仍是橙色暮光，因为百余公里外的大地仍在阳光下：全食不是黑夜。",
    eclipseCardC3:
      "生光：月缘另一侧先漏出钻石环，再散成贝利珠，色球红环一闪即逝。注意：光球一旦重现即不可裸眼直视，现实中此刻必须重新戴上滤镜。",
    eclipseCardC4:
      "复圆：月盘完全退出日面，这场日食结束。同一地点平均要等约 375 年才会再逢全食；而随着月球以每年约 3.8 厘米远离地球，日全食将在数亿年后永久终结——我们正好活在能看到它的地质窗口里。",
    /** 亮行星标注（§2.1：按事件历元真实方位；星等为典型值近似登记）
     * + M7 太空档行星层补齐（土/天/海 + 太阳标签） */
    eclipsePlanetVenus: "金星",
    eclipsePlanetJupiter: "木星",
    eclipsePlanetMercury: "水星",
    eclipsePlanetMars: "火星",
    eclipsePlanetSaturn: "土星",
    eclipsePlanetUranus: "天王星",
    eclipsePlanetNeptune: "海王星",
    eclipseSunLabel: "太阳",
    /** 星历加载态（useSolarEclipses 三态） */
    eclipseLoadingEphemeris: "正在加载日食星历…",
    eclipseEphemerisFailed: "日食星历加载失败，场景暂不可用——请刷新页面重试",
    /** 操作提示（偏食段白昼恒星不可见属科学事实，提示捏合放大看日面） */
    eclipseHintLookAround:
      "拖动或双指滚动环顾 · 双指捏合放大（最高约 ×20）看清日面缺角与贝利珠",
    /**
     * LE-M6 补丁 P5 天体跟随（地面档专属，默认开）：相机随太阳周日运动
     * 差量旋转、保留用户手动偏移（等效赤道仪跟踪，非硬居中）
     */
    eclipseFollowLabel: "跟随太阳（自动居中）",
    eclipseFollowAria: "跟随太阳自动居中",
    eclipseRecenterLabel: "⊙ 回到太阳",
    eclipseRecenterAria: "把视野平滑归中到太阳",
    eclipseFollowNote:
      "跟随开启时太阳始终留在视野内（手动拖开多少度就保持多少度）；相应地，星空与地平线会随跟踪移动——等效于赤道仪跟踪。关闭则回到固定指向。",
    /** M4 视角分段控件（§3.2：地面/太空；切换触发 1–2s 运镜） */
    eclipseViewTitle: "视角",
    eclipseViewAria: "切换观察视角",
    eclipseViewGround: "地面",
    eclipseViewSpace: "太空",
    /** M4 太空视角 HUD（本影宽度为真锥×球面解析真实值；速度 §1.2 锚点） */
    eclipseHudUmbraWidth: "本影宽度",
    eclipseHudShadowSpeed: "本影地速",
    eclipseHudAntumbra: "伪本影",
    /** 本影放大开关（A4 登记：文案倍率与 UMBRA_MAGNIFY_FACTOR=8 同步维护） */
    eclipseUmbraMagnifyLabel: "本影放大 ×8",
    eclipseUmbraMagnifyAria: "开关本影放大（显示辅助）",
    eclipseUmbraMagnifyBadge: "本影已按 ×8 放大显示（真实宽度见 HUD 数值）",
    /** 倾角叙事模式（A5 登记：文案倍率与 INCLINATION_DISPLAY_FACTOR=4 同步维护） */
    eclipseInclinationLabel: "倾角叙事",
    eclipseInclinationAria: "开关倾角叙事模式",
    eclipseInclinationBadge:
      "轨道倾角真实值 5.145°，显示按 ×4 夸张；轨道与交点节奏为叙事时间尺度",
    eclipseInclinationCard:
      "月球轨道相对黄道倾斜 5.145°——多数月份的朔，月影从地球上方或下方掠过；只有朔恰逢月球行至白道交点附近，影锥才会命中地球发生日食。观察影锥多数时候擦过地球外侧、约每半年一段「食季」才命中。",
    /** 太空视角科普卡（A3 登记：太阳距离压缩 + 影锥渲染为可见实体） */
    eclipseSpaceCard:
      "太空视角说明：太阳方向真实、距离压缩绘制（真实日地距离约 1.5 亿 km，超出场景域）；半透明影锥为表达辅助，真实影锥不可见。本影/半影与地表影斑由真锥几何逐帧解析，真实比例下地表本影仅百余公里宽。",
    /** 太空档操作提示（OrbitControls 原生手势） */
    eclipseHintSpace: "拖动旋转 · 滚轮或双指捏合缩放 · 播放看本影扫过地表",
    /** M7-3 月球放大开关（A16 登记：文案倍率与 MOON_MAGNIFY_FACTOR=4 同步维护） */
    eclipseMoonMagnifyLabel: "月球放大 ×4",
    eclipseMoonMagnifyAria: "开关月球放大（显示辅助）",
    eclipseMoonMagnifyBadge:
      "月球与影锥基部已按 ×4 放大显示（真实月球直径仅为地球的 27%）；地表影斑仍为真实几何，关闭即回真实比例",
    /** M8-1 天体比例分段（A18 登记：默认艺术化 = L2 观感；真实 = M7 形态） */
    eclipseBodyScaleAria: "切换天体比例显示档",
    eclipseBodyScaleArt: "艺术化",
    eclipseBodyScaleReal: "真实",
    eclipseBodyScaleCard:
      "艺术化档：天体半径按对数压缩放大（非真实比例，与主场景太阳系视角同一映射）；影锥与地表影斑随放大地球重绘——扫掠位置与相对大小仍真实，影斑取圆形近似；小行星带为示意点云。切「真实」档回到真实比例。",
    /** M7-4 行星轨道远景层（A17 登记：距离压缩与非真实行星尺寸科普卡常显） */
    eclipsePlanetOrbitsLabel: "行星轨道",
    eclipsePlanetOrbitsAria: "开关行星轨道远景层",
    eclipsePlanetOrbitsCard:
      "行星轨道为艺术化远景层：各行星方向与轨道相位按真实轨道要素计算，但日心距离经压缩绘制（1 AU ≈ 1,500 场景单位、外行星对数收拢），行星点尺寸非真实比例。背景为耶鲁亮星表真实星空与程序化银河带（银道面方位真实、形态为艺术再现）。",
    /**
     * M5 Eddington 星光偏折对照（§M5-2/§M5-3；A10 登记：badge 中倍率数值
     * 与 solarEclipseLab.EDDINGTON_DEFLECTION_EXAGGERATION = 2500 同步维护，
     * 真实值 1.75″ 与契约 C1 GR_LIMB_DEFLECTION_ARCSEC 同步）
     */
    eclipseDeflectionTitle: "星光引力偏折（1919）",
    eclipseDeflectionToggle: "显示引力偏折",
    eclipseDeflectionAria: "开关星光引力偏折对照",
    eclipseDeflectionBadge:
      "偏折已按 ×2500 夸张显示；真实偏折极小——日面边缘也仅 1.75″，标记旁标注的数值为真实角秒值",
    eclipseDeflectionLegend:
      "空心圈 = 无太阳时的位置 · 实心点 = 偏折后实位 · 离日面越近偏折越大（δ ∝ 1/b）",
    /** 科学史科普卡（M5-3 诚实口径：当年精度接近实验极限、后世确认；两站分工如实） */
    eclipse1919Card:
      "历史场景：1919 年 5 月 29 日，英国两支观测队分赴巴西索布拉尔与西非普林西比测量星光经过太阳附近时的偏折（爱丁顿本人在普林西比，当日多云仅得 2 张可用底片；决定性数据出自索布拉尔 4 英寸镜的 7 张底片，1.98″±0.12″）。只有全食时才能看见日面附近的恒星——这次食甚太阳恰好行经毕宿星团，亮星密集，正是选中这次日食的原因。测得的偏折与广义相对论预言（日面边缘 1.75″）相符，约为牛顿理论值的两倍。当年的测量精度已接近实验极限，这一结论由 20 世纪后半叶的重复观测所确认。",
    /** M6 面板抽屉标题（<sm 底部抽屉标题栏常显；开合钮复用 panel*Aria 键） */
    eclipsePanelTitle: "观测控制台",
    /** LE-M4-6 条目互链（月食侧 lunarLinkToSolar 同款回链） */
    eclipseLinkToLunar: "→ 去月食实验室看这套几何的另一面",
    /**
     * M6 声景（§5；A8 登记：全食「寂静」为艺术表达——eclipseAudioNote
     * 双语常显注明，sonification 科学口径红线同流星雨 §5）
     */
    eclipseAudioEnable: "日食声景（可听化）",
    eclipseAudioNote:
      "声景说明：真实日食本身无声。环境底噪的渐弱与全食段的「近乎寂静」是对现场氛围的艺术表达；食既/生光（钻石环时刻）的提示音为可听化（sonification）设计。",
    /** M6 一次性观测安全提示（§3.4 口径逐条，底稿 §七；确认后不再弹出） */
    eclipseSafetyTitle: "观测安全提示",
    eclipseSafetyScreen: "在本页面（屏幕内）可随意观看——这里的一切都是模拟。",
    eclipseSafetyRetina: "现实中直视太阳会造成视网膜损伤——没有痛觉、且不可逆。",
    eclipseSafetyTotalityOnly:
      "仅全食阶段（食既 C2 → 生光 C3 之间）可短暂裸眼观看，且仅限日全食；偏食与环食全程都不可裸眼。",
    eclipseSafetyNoDiy:
      "墨镜、自制滤镜、烟熏玻璃、曝光底片均不能保护眼睛，一律无效。",
    eclipseSafetyCertified:
      "其余时段必须使用符合 ISO 12312-2 认证的太阳滤镜（日食眼镜），或改用针孔投影等间接观测法。",
    eclipseSafetyConfirm: "我已了解",
    /**
     * LE-M2 月食实验室（/lab/lunar-eclipse）：条目卡/四页签/HUD/七锚点时间轴。
     * 页签标题含日期与食型副标题（§0.1）；锚点名由数据驱动锚点列表引用
     * （复用日食契约 C7 scrubber，偏食/半影食按 contacts 缺省传子集）。
     */
    lunarEclipseTitle: "月食",
    lunarEclipseDescription:
      "四场真实月食的权威星历复现：2029 本世纪最深的全食（食分 1.84）、2026「差一点就是全食」的偏食、2027 几乎无感的半影食、1992 皮纳图博火山后的极暗血月（丹戎 L=0）。拖动时间轴看地影缺口爬过月面——月食全程裸眼安全。",
    lunarTabAria: "切换月食事件",
    lunarTab2029: "2029-06-26 · 全食",
    lunarTab2026: "2026-08-28 · 偏食",
    lunarTab2027: "2027-02-20 · 半影食",
    lunarTab1992: "1992-12-09 · 历史 L=0",
    /** 观测点说明（固定单城市，§0.1 判据 = 食全程可见 + 食甚月高最优） */
    lunarObserver2029:
      "观测点：巴西圣保罗（食甚月亮高度 87°，近天顶；本世纪食分最大、最暗的月食，Saros 130）",
    lunarObserver2026:
      "观测点：巴西玛瑙斯（食甚月高 83°；食分 0.93——差一点点就是全食的临界感，Saros 138）",
    lunarObserver2027:
      "观测点：尼日利亚拉各斯（食甚月高 78°；半影食全程肉眼几乎无感——这是真实，Saros 143）",
    lunarObserver1992:
      "历史场景 · 观测点：西班牙马德里（食甚月高 72°；皮纳图博火山喷发后被评为丹戎 L=0 的极暗月食，Saros 125）",
    /** 时间轴锚点名（七接触点，§1.2；数据驱动列表引用，缺省锚点自动隐藏） */
    lunarAnchorP1: "半影食始",
    lunarAnchorU1: "初亏",
    lunarAnchorU2: "食既",
    lunarAnchorMax: "食甚",
    lunarAnchorU3: "生光",
    lunarAnchorU4: "复圆",
    lunarAnchorP4: "半影食终",
    lunarTimelineAria: "月食时间轴",
    /** 播放模式（B1 登记：加速回放全程 ~1.5 分钟，HUD 常显真实时刻与倍速） */
    lunarPlayModeAria: "播放模式",
    lunarPlayModeFast: "加速回放",
    lunarPlayModeReal: "×1 真实",
    /** HUD（500ms 刷新；双食分/食型/月高/月视直径为真实值常显，契约 C3） */
    lunarHudUtc: "UTC",
    lunarHudRate: "倍速",
    lunarHudKind: "当前阶段",
    lunarHudUmbralMag: "本影食分",
    lunarHudPenumbralMag: "半影食分",
    lunarHudDanjon: "丹戎 L",
    lunarHudMoonAlt: "月亮高度角",
    lunarHudMoonDiam: "月视直径",
    /** 食型/阶段名（lunarEclipseKind 实时判定，不硬编码事件类型） */
    lunarKindNone: "无食",
    lunarKindPenumbral: "半影食",
    lunarKindPartial: "偏食",
    lunarKindTotal: "全食",
    /** 阶段科普卡（七接触点区段；M2 骨架文案，M3 补血月/丹戎叙事细节） */
    lunarCardP1:
      "半影食始：月球开始进入地球半影。接下来一小段时间你几乎看不出任何变化——半影内仍有部分阳光直射月面，变暗极其微妙。这不是模拟的缺陷，是真实：约 36% 的月食全程只走半影，肉眼几乎无感。",
    lunarCardU1:
      "初亏：月缘触到本影，缺口出现。与日食不同，这个暗缺是地球自己的影子——本影边缘在月距处直径约 9,000 公里，约 2.6 个月球。缺口边缘的弧度就是地球的弧度：古希腊人由此推断大地是球体。",
    lunarCardU2:
      "食既：月球完全没入本影，全食开始。月面不会消失——地球大气把日光折射进影锥并滤成红色：站在月面上看，地球剪影周围是一圈燃烧的红环，那是地球上此刻所有的日出与日落。全食最长可持续近 107 分钟，全程裸眼观看安全。",
    lunarCardMax:
      "食甚：月心最接近影轴的时刻。注意本影内亮度呈径向梯度——靠影心一侧更暗、靠影缘一侧偏亮偏黄，不是均匀染红。此刻的月亮比满月暗约一万倍，被月光压制的星空重新浮现，地面也随之变暗。",
    lunarCardU3: "生光：月缘从本影另一侧露出，全食结束。缺口方位与初亏相反——影子从月面另一侧退场。",
    lunarCardU4: "复圆：月球完全退出本影，肉眼可见的月食结束。此后只剩半影段的微妙变暗，逐渐回到满月。",
    lunarCardP4: "半影食终：月球离开半影，这场月食结束。月球以每年约 3.8 厘米远离地球，但月食不会像日全食那样在遥远未来消失——地影远比月球大。",
    /** 星历加载态（useLunarEclipses 三态） */
    lunarLoadingEphemeris: "正在加载月食星历…",
    lunarEphemerisFailed: "月食星历加载失败，场景暂不可用——请刷新页面重试",
    /** 操作提示（真实视半径渲染，细节靠 FOV 缩放，契约 C3） */
    lunarHintLookAround:
      "拖动或双指滚动环顾夜空 · 双指捏合放大（最高约 ×20）看清月面缺口与本影内的径向渐变",
    /**
     * LE-M6 补丁 P5 天体跟随（地面档专属，默认开）：相机随月亮周日运动
     * 差量旋转、保留用户手动偏移（等效赤道仪跟踪，非硬居中）
     */
    lunarFollowLabel: "跟随月亮（自动居中）",
    lunarFollowAria: "跟随月亮自动居中",
    lunarRecenterLabel: "⊙ 回到月亮",
    lunarRecenterAria: "把视野平滑归中到月亮",
    lunarFollowNote:
      "跟随开启时月亮始终留在视野内（手动拖开多少度就保持多少度）；相应地，星空与地平线会随跟踪移动——等效于赤道仪跟踪。关闭则回到固定指向。",
    /** 面板标题（<sm 底部抽屉标题栏常显；开合钮复用 panel*Aria 键） */
    lunarPanelTitle: "观测控制台",
    /**
     * M3 血月控件（§3.2）：丹戎五档预设（底稿 §六 逐级描述直译）+ 浑浊度
     * 滑杆 + 曝光滑杆；B6 注记（目视主观评级/色值美术映射）与 B2 注记
     * （长曝光 vs 肉眼）为登记表的用户可见侧，勿删。
     */
    lunarDanjonTitle: "丹戎标度（血月深浅）",
    lunarDanjonAria: "丹戎五档预设",
    lunarDanjonDesc0: "L0 极暗：月球几乎不可见，食甚时尤其如此",
    lunarDanjonDesc1: "L1 暗：灰色或褐色调，细节难以分辨",
    lunarDanjonDesc2: "L2 深红或铁锈色：中心影极暗，本影外缘相对明亮",
    lunarDanjonDesc3: "L3 砖红色：本影常带明亮或发黄的边缘",
    lunarDanjonDesc4: "L4 极亮的铜红或橙色：边缘极亮",
    lunarDanjonNote:
      "丹戎标度为目视主观评级（Danjon 1921），无标准色值——本场景色彩为美术映射。",
    lunarTurbidityAria: "大气浑浊度／火山尘埃",
    lunarTurbidityClean: "洁净",
    lunarTurbidityDusty: "火山尘埃",
    lunarExposureTitle: "曝光",
    lunarExposureAria: "曝光",
    lunarExposureDim: "暗",
    lunarExposureBright: "长曝光",
    lunarExposureNote:
      "长曝光照片比肉眼所见亮得多——拉高≈相机长曝光，拉低≈裸眼观感。",
    /** l1992 历史场景叙事卡（皮纳图博 → 丹戎 L=0 的真实因果链） */
    lunarPinatuboCard:
      "1991 年皮纳图博火山喷发把约两千万吨二氧化硫送入平流层，次年 1992-12-09 的月食被大量观测者评为丹戎 L=0——月亮在食甚时几乎从夜空中消失。本页签默认还原这一极暗状态；拖动浑浊度滑杆，体验大气洁净度如何决定血月深浅。",
    /** M3-5 三联对比（§1.4 诚实文案红线：半影「几乎无感」明写） */
    lunarTriptychToggle: "三联对比：半影 / 偏食 / 全食",
    lunarTriptychPenumbral: "半影食甚 · 2027",
    lunarTriptychPartial: "偏食食甚 · 2026",
    lunarTriptychTotal: "全食食甚 · 2029",
    lunarTriptychHonest:
      "半影这一栏你几乎看不见任何变化——这是真实的：约 36% 的月食全程只走半影，肉眼几乎无感。",
    /** M3-6 地圆论证（底稿 §10.1 古希腊推理链） */
    lunarFitCircleToggle: "地圆论证：叠加本影拟合圆",
    lunarFitCircleCard:
      "拖动时间轴、切换不同月食：叠加在缺口上的圆弧曲率始终相同。古希腊人正是据此推理——地影边缘永远是同一曲率的圆弧，而只有球体朝任何方向的投影都是圆。月食，是人类最早握有的地圆证据之一。",
    /** M3-4 月缘增亮科普注解（B5 简化逆反射登记的用户可见侧） */
    lunarLimbSurgeCard:
      "满月的边缘看起来比中心略亮：月面坑洼在逆光方向反射更强（对冲效应）——像天鹅绒蒙在凸面上，中心最暗、边缘最亮。本场景采用简化逆反射模型呈现。",
    /** LE-M4 视角分段控件（地面/太空；月球视角随 M5） */
    lunarViewTitle: "视角",
    lunarViewAria: "切换观察视角",
    lunarViewGround: "地面",
    lunarViewSpace: "太空",
    /** M4 太空档操作提示（OrbitControls 原生手势） */
    lunarHintSpace: "拖动旋转 · 滚轮或双指捏合缩放 · 播放看月球穿过地影",
    /** M4 太空档 HUD 行（恒真值——不随档位/开关变化，B12/B13 用户可见侧） */
    lunarHudScale: "比例",
    lunarHudConeLen: "地影锥长",
    lunarHudMoonDistRow: "月地距离",
    lunarHudUmbraWidthRow: "月距处本影",
    lunarHudUmbraRatio: "本影/月径 · /R⊕",
    lunarHudConeRatio: "锥长/月距",
    /** M4-3 径向放大开关（B12 登记：文案倍率与 LUNAR_REAL_RADIAL_MAGNIFY_FACTOR=4 同步维护） */
    lunarRadialMagnifyLabel: "径向放大 ×4",
    lunarRadialMagnifyAria: "开关径向放大（显示辅助）",
    lunarRadialMagnifyBadge:
      "地月、影锥与剖面盘已横向统一 ×4 放大（轴向距离不变）——全部径向比例数字保持，HUD 数值恒为真值",
    /** M4-2 剖面盘开关与预设机位 */
    lunarSectionDiskLabel: "月距处影盘剖面",
    lunarSectionDiskAria: "开关月距处影盘剖面",
    lunarPresetAria: "预设机位",
    lunarPresetOverview: "影锥全貌",
    lunarPresetCloseup: "月球特写",
    /** M4 太空视角科普卡（B3 登记：轴向真比例为卖点 + 太阳距离压缩 + 影锥可见性辅助） */
    lunarSpaceCard:
      "太空视角说明：影锥轴向为真实比例——地影锥长约 140 万 km、月球轨道约 38.4 万 km，「月球只走到锥长的 27%、该处本影约 2.6 倍月径」按真实比例呈现。太阳方向真实、距离压缩绘制（真实日地距离约 1.5 亿 km 超出场景域）；半透明影锥与剖面盘为表达辅助，真实地影不可见。",
    /** M4-3 比例双模科普卡（B13 登记：统一径向因子——文案数值与派生常量同步维护） */
    lunarScaleCard:
      "艺术化档：地月系统、影锥与月距处剖面盘按统一径向因子约 ×14.6 放大（由主场景天体半径对数压缩派生）——所有径向教学比例严格保持：月距处本影恒约 2.6 倍月径、0.72 倍地球半径。行星与太阳沿用与日食太空档同源的对数压缩半径。切「真实」档回到严格真比例（另有径向放大 ×4 开关）。放大档下的月球轨道环为穿过月球当前显示位置的圆形示意（半径随横向偏移微幅变化）；真实比例下即为真实轨道圆。",
    /** M4-5 交点几何望态（B4 登记：倾角夸张共用日食徽标键；朔↔望切换文案） */
    lunarSyzygyAria: "切换朔望演示",
    lunarSyzygyFull: "望（月食）",
    lunarSyzygyNew: "朔（日食）",
    lunarNodeCard:
      "月球轨道相对黄道倾斜 5.145°——多数月份的望，月球从地影上方或下方掠过；只有望恰逢月球行至白道交点附近，才会穿入地影发生月食。切到「朔」可见影锥方向反转：月影投向地球，正是日食的几何——同一个倾角，一次建模两种食。演示为示意：轨道与交点节奏为叙事时间尺度。",
    /** M4-6 日食 vs 月食对比卡（底稿 §八整表全量；表格数值为教学口径） */
    lunarCompareToggle: "日食 vs 月食对比表",
    lunarCompareColDim: "维度",
    lunarCompareColSolar: "日全食",
    lunarCompareColLunar: "月全食",
    lunarCompareRow1Dim: "谁挡谁",
    lunarCompareRow1Solar: "月球挡住太阳",
    lunarCompareRow1Lunar: "地球的影子落在月球上",
    lunarCompareRow2Dim: "发生月相",
    lunarCompareRow2Solar: "朔（新月）",
    lunarCompareRow2Lunar: "望（满月）",
    lunarCompareRow3Dim: "可见范围",
    lunarCompareRow3Solar: "100–160 km 宽的窄带",
    lunarCompareRow3Lunar: "整个夜半球",
    lunarCompareRow4Dim: "单次时长",
    lunarCompareRow4Solar: "最长 7 分 32 秒",
    lunarCompareRow4Lunar: "全食最长约 107 分钟，全程最长 236 分钟",
    lunarCompareRow5Dim: "同一地点复现",
    lunarCompareRow5Solar: "360–410 年",
    lunarCompareRow5Lunar: "每年数次",
    lunarCompareRow6Dim: "裸眼安全",
    lunarCompareRow6Solar: "仅全食阶段安全",
    lunarCompareRow6Lunar: "全程安全，无需任何防护",
    lunarCompareRow7Dim: "接触点数量",
    lunarCompareRow7Solar: "5 个（C1→C4 + 食甚）",
    lunarCompareRow7Lunar: "7 个（P1/U1/U2/食甚/U3/U4/P4）",
    lunarCompareRow8Dim: "影锥角色",
    lunarCompareRow8Solar: "月影锥尖勉强够到地面",
    lunarCompareRow8Lunar: "地影锥（140 万 km）远长于月距（38.4 万 km）",
    lunarCompareRow9Dim: "延长时长的条件",
    lunarCompareRow9Solar: "月球在近地点",
    lunarCompareRow9Lunar: "月球在远地点",
    lunarCompareRow10Dim: "主视觉",
    lunarCompareRow10Solar: "日冕、色球、日珥、贝利珠、钻石环",
    lunarCompareRow10Lunar: "血月红、本影径向梯度、月缘增亮",
    lunarCompareRow11Dim: "颜色来源",
    lunarCompareRow11Solar: "日冕（百万度等离子体自身发光）",
    lunarCompareRow11Lunar: "地球大气折射 + 瑞利散射",
    lunarCompareRow12Dim: "亮度评级体系",
    lunarCompareRow12Solar: "无（用食分/时长）",
    lunarCompareRow12Lunar: "丹戎标度 L = 0–4",
    lunarCompareRow13Dim: "观测门槛",
    lunarCompareRow13Solar: "需长途追逐（umbraphile 文化）",
    lunarCompareRow13Lunar: "抬头就能看",
    lunarCompareRow14Dim: "类型占比",
    lunarCompareRow14Solar: "约 60% 的中心食是环食",
    lunarCompareRow14Lunar: "半影 36.3% / 偏食 34.9% / 全食 28.8%",
    lunarCompareSummary:
      "日全食是稀缺的、瞬间的、需要追逐的；月全食是慷慨的、从容的、抬头即得的。",
    /** M4-6 半沙罗配对科普卡（连接两条目的真实周期桥梁） */
    lunarHalfSarosCard:
      "半沙罗（sar）配对：一次日食之后约 9 年 5.5 天，会发生一次性质对应的月食（反之亦然）——日全食或日环食之后 9 年 5.5 天，会有一次月全食。两者是同一套日月地几何的镜像，这也是把日食与月食两个实验室连在一起的真实周期。",
    lunarLinkToSolar: "→ 去日食实验室看这套几何的另一面",
    /** LE-M5 月球视角（§2.3；B8 登记的用户可见侧在 lunarMoonViewCard） */
    lunarViewMoon: "月球",
    lunarHintMoonView:
      "拖动环顾月面与地球 · 双指捏合放大（最高约 ×20）细看地球边缘那圈红环——就是它把月亮染红的",
    lunarMoonViewCard:
      "你正站在月面近地侧看「月球上的日食」：太阳藏进地球背后，夜半球的地球漆黑一片，只剩边缘一圈被大气折射的红环——这圈光穿过地球大气、滤掉短波后打到你脚下的月面，正是血月红色的来源。拖动浑浊度滑杆：红环变深，切回地面视角血月同步变深。红环为基于机制的艺术化再现（环宽经放大以可见，无逐日大气实况数据）；实拍对标：Surveyor 3（1967）与 Blue Ghost Mission 1（2025）均在月面拍到过这圈红环。",
    lunarMoonGuideTip:
      "血月的红色从哪来？切到「月球」视角——站上月面，你会看到把月亮染红的那圈地球大气红环。",
    lunarMoonGuideGo: "去月球视角",
    lunarMoonGuideDismissAria: "关闭引导提示",
    /** LE-M5-3 selenelion 彩蛋（B9 登记：真实组合 l1992 北京 + 0.6° 折射抬升显式呈现） */
    lunarSelenelionCard:
      "Selenelion（月食日出同现）：被食的月亮与太阳同时挂在两侧地平线上——几何上月食时日月正好相对，全靠大气折射把两者都「抬」出地平线才可能同框。这不是假想：1992-12-10 清晨的北京（本页这场月食），西北方全食血月正在沉落、东南方太阳正在升起。",
    lunarSelenelionEnter: "🌄 亲眼看看 →",
    lunarSelenelionTitle: "Selenelion · 1992-12-10 北京晨",
    lunarSelenelionExit: "← 返回月食实验室",
    lunarSelenelionTimeAria: "selenelion 时间（UT 1992-12-09 23:10–23:45）",
    lunarSelenelionHudMoon: "月亮高度（几何→视）",
    lunarSelenelionHudSun: "太阳高度（几何→视）",
    lunarSelenelionHudLift: "折射抬升",
    lunarSelenelionAimMoon: "看被食之月（西北）",
    lunarSelenelionAimSun: "看初升太阳（东南）",
    lunarSelenelionRefractionCard:
      "大气折射把地平附近的天体抬升约 0.6°（真实量级：地平处约 34′）——虚圈标记无折射的几何位置。拖到 07:27（UT 23:27）前后：月亮与太阳的几何位置都已在地平线下，你却能同时看见两者——这就是 selenelion 只能发生在地平线上的原因。全食中的月亮在晨光里极暗（1992 年实测丹戎 L=0），拉高曝光滑杆可辅助辨认。本场景折射抬升为教学简化曲线（地平恒定 0.6°、10° 高度收敛归零）。",
    lunarSelenelionHint:
      "西北方：正在沉落的被食之月 · 东南方：正在升起的太阳——拖动环顾双地平线",
    /**
     * LE-M6-1 声景（§5；B15 登记：夜声随食甚渐深的微妙变化为艺术表达，
     * lunarAudioNote 双语常显注明——真实月食无声，接触点提示音为可听化）
     */
    lunarAudioEnable: "月食声景（可听化）",
    lunarAudioNote:
      "声景说明：真实月食本身无声。夜间环境底噪（虫鸣抽象化）随食甚渐深的微妙变化是对夜色氛围的艺术表达（幅度刻意压得很轻——月食不像日食那样有「环境骤静」的现场事实）；七个接触点（P1/U1/U2/食甚/U3/U4/P4）的提示音为可听化（sonification）设计，半影接触最轻、本影接触稍亮。",
    /**
     * LE-M6-1 文化史折叠卡（§3.3：与物理解释明确分区，标注「历史记载与
     * 神话」；B10 登记：卡内钟声为文化演绎，一次性触发、不进科学声景）
     */
    lunarCultureTitle: "文化史：人类如何解释月食",
    lunarCultureTag: "历史记载与神话（非科学解释）",
    lunarCultureItemCn:
      "中国「天狗食月」：古人以为天狗吞月，鸣钟击鼓、敲锣放炮以驱之——月亮总会复圆，于是「有效」的经验代代相传。周代已有「救月」礼制，《周礼》载伐鼓于社；历代钦天监则同时在精确推算月食时刻。",
    lunarCultureItemIndia:
      "印度神话：罗睺（Rahu）偷饮甘露被日月告发，遭毗湿奴斩首，头颅不死，遂追吞日月——因无躯干，月亮总会从断颈处重现。",
    lunarCultureItemInca:
      "印加：美洲豹（jaguar）在啃咬月亮，血月即伤口——人们敲打器物、驱使犬只吠叫，唯恐美洲豹得手后转而扑向地上的人。",
    lunarCultureItemMeso:
      "美索不达米亚：月食被视为对国王的威胁——巴比伦人以「替身王」代受凶兆，同时留下了连续数百年的月食观测记录，那正是沙罗周期被发现的数据基础。",
    lunarCultureItemNorse:
      "北欧：巨狼 Hati 追逐月亮，咬住即成月食；诸神黄昏时它终将吞下月亮。",
    lunarCultureBellLabel: "鸣钟驱天狗（听一声）",
    lunarCultureBellAria: "播放一声文化演绎钟声",
    lunarCultureBellNote:
      "钟声为文化演绎（B10 登记）：只在本卡内按一次响一声，不随时间轴自动出声，与上方的科学声景分离。",
    lunarCultureBellMuted: "先在面板「声景」区打开声音，即可试听这一声钟。",
    /** LE-M6 NGC 6629 掩星科普卡（2029 页签专属；§3.3） */
    lunarNgcCard:
      "同场加映（2029-06-26）：这场月食期间，被食的月亮会掩过人马座的行星状星云 NGC 6629（约 10 等，距离约 6,600 光年）——月亮几乎全暗恰好让这颗平时被月光淹没的小星云可以被记录下来。本实验室的星穹只绘到耶鲁亮星表（约 6.5 等），这颗 10 等星云不在其中，故仅以科普卡呈现、场景内不作图示。",
    /** LE-M6-2 移动端/降级档说明（reduced 档提示，画质分档 §4） */
    lunarReducedNote:
      "已按设备能力自动降档：关闭泛光、限制渲染分辨率，太空视角的银河带与小行星带、月球视角红环壳的着色精度相应简化——几何与数值全部不变。",
  },
  helpHint: {
    /**
     * 操作引导正文（迁移自 HelpHint JSX：空格/\u00a0 与原 JSX 空白折叠
     * 结果逐字符一致——中文态逐像素等价前提，勿改动空白）
     */
    controls:
      "🖱 拖动旋转 · 滚轮缩放 · 右键平移 \u00a0|\u00a0 ⌨ 1-4 切换视角 · [ / ] 巡游上一个/下一个天体（按视角域：行星系统/太阳系/银河系/宇宙序列）· G 银心固定视角（银河系视角下俯瞰太阳系沿波浪轨道绕银心公转，再按返回跟随太阳系）· V 垂直展开（银河系视角下生效；银河系整体 morph 为扁旋转椭球体：银盘/超新星/特殊天体随增益展开，含高度指示线）· 空格暂停 · M 音效 · O 轨道线 \u00a0|\u00a0 点击行星查看信息",
    /** 科学性/艺术化说明段（行间空格为原 JSX 折叠结果，勿改动） */
    disclaimer:
      "恒星闪烁仅行星视角呈现（真空中恒星不闪烁，闪烁源于大气湍流，此为艺术化处理）； 音效为艺术化设计（真空无声），行星环境音按各行星大气特征区分（水星/矮行星近真空几乎静音）； 默认模式下矮行星与人造卫星尺寸经放大以保证可辨识，真实比例模式下过小不可见属科学事实； 银河系视角下太阳垂直振荡的波浪起伏经 ×10 视觉放大（真实振幅仅 ±300 光年，真实比例模式不放大）； 特殊天体高度方向按真实银纬（SIMBAD）推算、水平距离为示意，垂直展开（V）为观察辅助的视觉夸大（指示线标注为未放大的推算高度）—— 开启后整个银盘 morph 为扁旋转椭球体（正面/俯视轮廓仍为圆形、旋臂俯视可辨，侧视旋臂图案被垂直弥散属预期权衡），超新星随盘抬升、银晕增亮、尘埃带渐隐； 太阳观察：飞往太阳近观可见米粒组织/黑子/日珥，选中太阳可开启内部剖面—— 黑子/日珥尺寸与活动频率经演示化放大、耀斑时长减速呈现（均已登记），色球厚度夸大至 +1.5%； 宇宙视角：卫星星系沿细线轨道运动（轨道线随 O 开关），麦哲伦星流/人马座潮汐流为 历史路径上剥离的气体与恒星（弥散粒子带，非轨道线），宇宙网除哈勃膨胀缩放外静止属预期； 大尺度背景为 2MASS 红移巡天（2MRS）约 4.3 万个真实星系点云（椭圆偏黄/旋涡偏蓝白， 室女座团聚集与银道空带为真实数据；红移距离系哈勃流近似有指状效应、近距误差与 银道遮挡带三项失真，银道空带是尘埃遮挡的观测限制非真实空洞），程序化宇宙网降为氛围底层； 银河系侧视可见外盘 S 形 HI 翘曲（Levine et al. 2006，盘缘振幅经艺术化放大以侧视可辨）与 银心上下费米气泡弥散双泡（Su et al. 2010，伽马射线辉光以淡紫/品红艺术化呈现，可在显示选项关闭）",
    /** B3-D 语言切换说明（i18n 全站覆盖后更新：数据/标签/说明均随语言切换） */
    langNote:
      "语言 Language：左上角面板 zh/EN 按钮即时切换界面语言（界面、天体标签与说明均切换；数据来源署名保持原文）",
    /** B5 展馆模式与 H 键说明（新增行） */
    kioskNote:
      "H 隐藏/显示界面 · 展馆模式：左上角面板启动（全屏自动巡游，任意操作暂停、片刻无操作自动恢复）或以 ?mode=kiosk 链接启动",
    /** M4-5 触屏版引导（isTouch 分流：替换键鼠口径首段；快捷键段落隐藏） */
    controlsTouch: "单指拖动旋转 · 双指缩放/平移 · 点按选中天体",
    closeAria: "关闭引导",
    /** 关闭后底部中央"?"重开按钮（UI 布局优化：引导 3 秒自动关闭后可重开） */
    reopenAria: "重新打开操作引导",
  },
  /** M3 移动布局底部标签栏（仅 isCompact 渲染；emoji/符号由组件层持有） */
  tabBar: {
    help: "帮助",
    helpAria: "打开操作引导",
    controls: "控制",
    controlsAria: "打开控制面板",
    contact: "投喂",
    contactAria: "打开投喂与合作面板",
  },
  /** 四视角锚点名（cameraViews.nameZh 迁移，ControlPanel 按钮 + HUD 标题共用） */
  viewLevel: {
    L1: "行星视角",
    L2: "太阳系视角",
    L3: "银河系视角",
    L4: "宇宙视角",
  },
  /** 巡游域名（utils/cycleScopes SCOPE_NAME_ZH 迁移，常量保留供纯逻辑测试） */
  scopeName: {
    system: "行星巡游",
    solar: "太阳系巡游",
    galaxy: "银河系巡游",
    universe: "宇宙巡游",
  },
  /** B5 展馆模式（kiosk）暂停角标 */
  kiosk: {
    /** 暂停角标正文（{sec} = 自动恢复倒计时秒数） */
    pausedBadge: "展馆模式（暂停中，{sec} 秒后恢复）",
    /** 退出按钮 */
    exit: "退出",
    exitAria: "退出展馆模式",
  },
  controlPanel: {
    title: "星海奥德赛",
    subtitle: "Stellar Odyssey",
    langAria: "界面语言切换",
    viewSection: "视角（快捷键 1-4）",
    galacticFrameSection: "银河系视角参考系（G 切换）",
    galacticFrameTitle:
      "银心固定：银心居中不动，俯瞰太阳系沿波浪轨道绕银心公转",
    galacticFrameOn: "银心固定中（点按回到跟随太阳系）",
    galacticFrameOff: "切换银心固定视角（观察太阳系公转）",
    speedSection: "模拟速度（空格暂停）",
    resume: "继续",
    pause: "暂停",
    speedAria: "模拟速度倍率",
    audioSection: "音效（M 静音；真空无声，音效为艺术化设计）",
    audioOn: "开",
    audioOff: "关",
    volumeAria: "音量",
    displaySection: "显示",
    orbits: "轨道线（O）",
    bodyLabels: "天体标签（L）",
    satelliteOrbits: "卫星轨道线",
    youAreHere: "You are here 标记",
    velocityVectors: "速度矢量箭头",
    galaxyCatalog: "真实巡天背景（2MRS）",
    fermiBubbles: "费米气泡",
    verticalExpand: "垂直展开（V）",
    expandGain: "增益",
    expandGainAria: "垂直展开增益（1–6）",
    realScale: "真实比例模式（天体按真实大小）",
    sunCutaway: "太阳内部剖面（1/4 切除视图）",
    colorBoost: "星系色彩增强",
    colorBoostNote:
      "增强红黄/蓝白色彩对比便于分辨恒星与星系类型；关闭后为真实观测色调（对比较弱，偏黄白）",
    bloom: "泛光效果（Bloom，低性能设备可关闭）",
    performance: "性能监控（FPS/内存）",
    kioskSection: "展馆模式",
    kioskStart: "启动展馆模式（全屏自动巡游）",
    kioskNote: "按当前巡游域自动逐站飞往；任意操作暂停，片刻无操作自动恢复",
    demoSection: "动态事件演示",
    /** 面板收起/展开把手（UI 布局优化） */
    collapseAria: "收起控制面板",
    expandAria: "展开控制面板",
    supernovaActive: "超新星爆发进行中…",
    supernovaTrigger: "触发超新星演示（旋臂内随机）",
    flareActive: "耀斑进行中（{cls}{mag} 级）…",
    flareCutawayDisabled: "触发太阳耀斑演示（剖面模式下不可用）",
    flareTrigger: "触发太阳耀斑演示（活动区随机）",
    cmeActive: "CME 进行中（{speed} km/s）…",
    cmeCutawayDisabled: "触发 CME 演示（剖面模式下不可用）",
    cmeTrigger: "触发日冕物质抛射（CME）演示",
    mergerActive: "合并预览进行中…",
    mergerTrigger: "预览银河系—仙女座碰撞合并",
    mergerRestore: "恢复预览前时间",
    /**
     * 显示开关下方来源/科学说明段（i18n 全站覆盖：原 B3 方案 K3 豁免解除）。
     * zh 值与原 JSX 空白折叠结果逐字符一致（中文态逐像素等价，勿改空白）。
     */
    catalogNote:
      "{source}；失真登记：{distortions}。 关闭或数据缺失时回落程序化宇宙网示意",
    expandNote:
      "银河系整体随增益 morph 为扁旋转椭球体（银盘粒子/超新星随盘 抬升、特殊天体垂直高度按增益展开；观察辅助的视觉夸大， 指示线标注为未放大的银纬推算高度）",
    realScaleNote:
      "真实比例下行星/矮行星极小（矮行星过小不可见属科学事实）， 可飞往/跟随后近距离观察",
    cutawayNote:
      "剖面下核心/辐射区/对流区可点选查看科普；外部活动特效已暂时淡出",
  },
  hud: {
    simTime: "模拟时间：{value}",
    /** 大时间尺度专业历元副行（主行为"距今约 …"通俗表示，UI 布局优化） */
    simEpoch: "（天文历元 {value}）",
    /** 沉浸模式（页面最大化）按钮（emoji 由组件层持有） */
    immersiveEnter: "最大化（收起面板）",
    immersiveExit: "退出最大化",
    /** M3-5：全屏 API 不可用（iPhone Safari）时的降级文案（仅收起 UI） */
    immersiveEnterNoFullscreen: "收起面板（此浏览器不支持全屏）",
    /** M4-3：H 键 UI 显隐的触屏等价入口（沉浸按钮旁"隐藏界面"+ 恢复角标） */
    uiHide: "隐藏界面",
    uiShow: "显示界面",
    /** M3 移动版顶部状态条：tap 展开/收起详情 */
    statusExpandAria: "展开状态详情",
    statusCollapseAria: "收起状态详情",
    /** M3 移动版信息面板底部半屏卡：顶部拖拽把手（下滑关闭） */
    sheetDragAria: "下滑关闭面板",
    scale: "当前尺度：{value}",
    frameL1: "参考系：日心系（行星/卫星运动）",
    frameL2: "参考系：日心系（黄道坐标）",
    frameL3: "参考系：银心系（太阳系绕银心）",
    frameL4: "参考系：本星系群质心系（本动以矢量指示）",
    frameHudCenter: "参考系：银心系（银心固定）",
    frameHudFollow: "参考系：银心系（跟随太阳系）",
    galacticYear:
      "银河年进度：第 {orbit} 圈 {percent}%（绕行 {deg}°）｜银盘面高度 {sign}{height} ly",
    frameToggle: "参考系：{mode}（G 切换）",
    frameModeCenter: "银心固定",
    frameModeFollow: "跟随太阳系",
    rateClampSatellite: "快周期卫星运动已减速显示（防闪烁）",
    rateClampPlanet: "行星运动已减速显示（防闪烁）",
    followMode: "跟随模式：{name}",
    followCancel: "取消（Esc）",
    gTipPrefix: "按",
    gTipMiddle: "切换",
    gTipHighlight: "银心固定视角",
    gTipSuffix: "，俯瞰太阳系沿波浪轨道绕银心公转",
    gTipCloseAria: "关闭银心固定视角引导",
    gTipNow: "立即切换（G）",
    mergerTitle: "银河系—仙女座合并演化",
    mergerCloseAria: "关闭合并演化卡片",
    /** zh 用 {yi}（亿年）、en 用 {myr}（Myr）——两参数同时传入，按 locale 取用 */
    mergerTau: "（合并时刻后约 {yi} 亿年）",
    snTitle: "超新星爆发！",
    snCloseAria: "关闭超新星通知",
    snBody: "银河系旋臂内探测到核坍缩超新星（前身星约 {mass} 倍太阳质量）",
    flyBtn: "飞往观看",
    detailBtn: "查看详情",
    flareTitle: "太阳耀斑爆发（{cls}{mag} 级）！",
    flareCloseAria: "关闭耀斑通知",
    flareBody: "活动区（黑子群附近）发生磁重联能量释放",
    flareCmeLinked: "，预计伴随日冕物质抛射（CME）",
    cmeTitle: "日冕物质抛射（CME）！约 {speed} km/s",
    cmeCloseAria: "关闭 CME 通知",
    cmeBody: "大团等离子体从日冕喷出，呈扩张壳层飞离太阳",
    cmeEarthDirected: "——本次抛射朝向地球！",
    cmeArrivalTitle: "CME 已抵达地球！",
    cmeArrivalCloseAria: "关闭 CME 抵达通知",
    cmeArrivalBody:
      "等离子体云抵达地球磁层，扰动引发地磁暴——极区高层大气激发出增强极光 （示意）。",
    flyEarthBtn: "飞往地球观看",
    featureCloseAria: "关闭特征卡片",
    sunspotEarthsPre: "该黑子约可容纳",
    sunspotEarthsPost: "个地球（按放大前真实尺寸换算）",
    layerCloseAria: "关闭分层卡片",
    layerRange: "范围",
    layerTemp: "温度",
    /** 信息面板/剖面分层标题：zh 中英并列、en 仅英文（实现差异登记） */
    bodyTitle: "{nameZh}（{nameEn}）",
    dataSource: "数据来源：{value}",
    infoCloseAria: "关闭信息面板",
    infoCollapseAria: "收起信息面板内容",
    infoExpandAria: "展开信息面板内容",
    cutawayOn: "关闭内部结构剖面",
    cutawayOff: "查看内部结构（1/4 剖面）",
    flyShort: "飞往（F）",
    follow: "跟随",
    unfollow: "取消跟随",
    prevAria: "序列上一个天体（快捷键 [）",
    prevTitle: "上一个（[）",
    nextAria: "序列下一个天体（快捷键 ]）",
    nextTitle: "下一个（]）",
  },
  bodyCycle: {
    prev: "上一个",
    next: "下一个",
    prevAria: "上一个天体（快捷键 [）",
    nextAria: "下一个天体（快捷键 ]）",
  },
  perfMonitor: {
    title: "性能监控",
    fpsLabel: "帧率：{value}",
    memoryLabel: "内存：{value}",
    measuring: "统计中…",
    unavailable: "不可用",
    /** 健康度后缀与 utils/performance formatFpsLabel 同源阈值（fpsHealth） */
    fpsFair: "{fps} FPS（一般）",
    fpsLow: "{fps} FPS（偏低）",
  },
  loading: {
    textures: "加载纹理资源",
    scene: "正在加载星系场景…",
  },
  /** 音频提示（M5-1：AudioContext.resume 失败从静默改为用户可见） */
  audioNotice: {
    resumeFailed:
      "音效未能启动：浏览器拦截了音频播放，请再点一次「音效」开关重试。",
    dismissAria: "关闭音效提示",
  },
  /** 404 页（app/not-found.tsx） */
  notFound: {
    title: "你已漂流到已知宇宙之外",
    body: "这片坐标上观测不到任何天体——页面不存在，或已被引力弹弓抛向了别处。",
    /** 倒计时行模板（渲染侧按 {sec} 拆分，秒数 span 样式由组件持有） */
    autoReturn: "{sec} 秒后自动返回星图",
    returnNow: "立即返回星图",
  },
  /**
   * 3D 场景标签（天体名之外的说明性标签；天体名经 displayBodyName 收口）。
   * 消费侧为 Scene/LocalizedLabelText 叶组件（订阅 locale，重渲染
   * 限制在 Html 标签 DOM 层，不触发 3D 场景重建——附录 A 性能纪律）。
   */
  sceneLabel: {
    siriusA: "天狼星A · 主序星",
    siriusB: "天狼星B · 白矮星",
    youAreHere: "你在这里（太阳系）",
    galacticYearPercent: "银河年 {percent}%",
    oortCloud: "奥尔特云外边界（示意，实际 2,000–100,000 AU）",
    terminationShock: "终端激波（示意，约 {au} AU）",
    heliosheath: "日鞘（渐变区）",
    heliopause: "日球层顶（示意，实际约 120 AU）",
    /** 旅行者标记名后缀（前接 displayBodyName） */
    voyagerCrossedSuffix: "（{year} 穿越）",
    /** 类星体 3C 273 标签后缀（前接 displayBodyName） */
    quasarSuffix: "（约 24 亿光年）",
    /** 触须星系标签后缀 */
    antennaeSuffix: "（星系碰撞现场，约 4500 万光年）",
    lensingArcs: "星系团引力透镜弧（示意，原型 Abell 370）",
    /** 伽马射线暴标签后缀 */
    grbSuffix: "（演示重放，约 20 亿光年）",
    localGroupMotion: "本星系群本动 ~{v} km/s（朝巨引源/沙普利方向，相对 CMB）",
    observableEdge: "可观测宇宙边界示意（半径约 465 亿光年）",
    laniakeaBoundary: "拉尼亚凯亚超星系团边界示意（直径约 5.2 亿光年）",
    greatAttractor: "巨引源",
    mergerCountdown:
      "银河系—仙女座相互接近（~110 km/s），约 {gyr} 十亿年后碰撞合并",
    mergerStage: "银河系—仙女座合并演化：{stage}",
  },
  /**
   * 信息面板标签列/类型行直映射（键=中文原文；catalog.ts、specialBodies
   * factsZh、solarActivity/solarCycle/m87Environment 状态行标签的有限集合）。
   * 值行/描述行留中文（档位 3 边界，登记）；未收录标签回退中文原文。
   */
  catalogText: {
    // ── 信息面板标签列 ──────────────────────────────────────────────
    主旋臂: "主旋臂",
    事件视界: "事件视界",
    伴星: "伴星",
    位置: "位置",
    光变周期: "光变周期",
    光度: "光度",
    光弧: "光弧",
    公转周期: "公转周期",
    共振: "共振",
    内缘: "内缘",
    内部: "内部",
    冲击波: "冲击波",
    前身星: "前身星",
    剪影: "剪影",
    动态效果: "动态效果",
    半径: "半径",
    历史: "历史",
    原型: "原型",
    原理: "原理",
    反射星云: "反射星云",
    发射: "发射",
    吸积盘: "吸积盘",
    周围星云: "周围星云",
    喷流: "喷流",
    备注: "备注",
    外缘: "外缘",
    天狼星A: "天狼星A",
    天狼星B: "天狼星B",
    太阳风: "太阳风",
    定义: "定义",
    室女座团: "室女座团",
    尺度: "尺度",
    尺度对比: "尺度对比",
    年龄: "年龄",
    "当前 CME": "当前 CME",
    当前活动: "当前活动",
    当前耀斑: "当前耀斑",
    形态: "形态",
    形状: "形状",
    成员: "成员",
    探测: "探测",
    描述: "描述",
    携带: "携带",
    日冕洞: "日冕洞",
    日冕温度: "日冕温度",
    星暴: "星暴",
    星风速度: "星风速度",
    本质: "本质",
    标志结构: "标志结构",
    活动周期: "活动周期",
    演示说明: "演示说明",
    潮汐锁定: "潮汐锁定",
    球状星团: "球状星团",
    盘厚度: "盘厚度",
    直径: "直径",
    真实特征尺寸: "真实特征尺寸",
    真实距离: "真实距离",
    示意说明: "示意说明",
    离心率: "离心率",
    科学性说明: "科学性说明",
    穿越日球层顶: "穿越日球层顶",
    组成: "组成",
    结局: "结局",
    结构: "结构",
    结构分层: "结构分层",
    膨胀速度: "膨胀速度",
    自转周期: "自转周期",
    表面温度: "表面温度",
    视向速度: "视向速度",
    视星等变化: "视星等变化",
    触须: "触须",
    质量: "质量",
    距离: "距离",
    轨道倾角: "轨道倾角",
    轨道半长轴: "轨道半长轴",
    轨道周期: "轨道周期",
    轴倾角: "轴倾角",
    较差自转: "较差自转",
    "运动（模拟）": "运动（模拟）",
    近日点距离: "近日点距离",
    进程: "进程",
    远日点距离: "远日点距离",
    遗迹: "遗迹",
    量天尺: "量天尺",
    银心: "银心",
    阶段: "阶段",
    颜色: "颜色",
    黑子: "黑子",
    // ── 天体类型行（typeZh 有限集合） ────────────────────────────────
    恒星: "恒星",
    行星: "行星",
    矮行星: "矮行星",
    卫星: "卫星",
    人造卫星: "人造卫星",
    彗星: "彗星",
    太阳系外围结构: "太阳系外围结构",
    "星际探测器（日球层顶穿越标记）": "星际探测器（日球层顶穿越标记）",
    旋涡星系: "旋涡星系",
    棒旋星系: "棒旋星系",
    椭圆星系: "椭圆星系",
    不规则星系: "不规则星系",
    "动态事件（核坍缩超新星）": "动态事件（核坍缩超新星）",
    "红巨星（红超巨星）": "红巨星（红超巨星）",
    蓝超巨星: "蓝超巨星",
    "双星系统（主序星 + 白矮星）": "双星系统（主序星 + 白矮星）",
    "中子星/脉冲星（超新星遗迹中心）": "中子星/脉冲星（超新星遗迹中心）",
    "超大质量黑洞（银心）": "超大质量黑洞（银心）",
    发射星云: "发射星云",
    行星状星云: "行星状星云",
    "球状星团（银晕）": "球状星团（银晕）",
    "恒星级黑洞（X射线双星）": "恒星级黑洞（X射线双星）",
    "沃尔夫-拉叶星（大质量恒星晚期）": "沃尔夫-拉叶星（大质量恒星晚期）",
    "造父变星（脉动变星）": "造父变星（脉动变星）",
    疏散星团: "疏散星团",
    "暗星云（分子云剪影）": "暗星云（分子云剪影）",
    "类星体（活动星系核）": "类星体（活动星系核）",
    "星系碰撞现场（并合中的旋涡星系对）": "星系碰撞现场（并合中的旋涡星系对）",
    "星系团引力透镜（背景星系光弧）": "星系团引力透镜（背景星系光弧）",
    "伽马射线暴（长暴）": "伽马射线暴（长暴）",
  },
} as const;

/** 递归将字典叶子放宽为 string（保持嵌套结构与键集合不变） */
type DictShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : DictShape<T[K]>;
};

/** 字典结构类型：以 zh 为单一事实来源，en 必须与其键集合完全一致 */
export type I18nDict = DictShape<typeof zh>;
