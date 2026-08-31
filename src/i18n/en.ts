/**
 * 英文字典（B2 i18n 基建 + B3 UI 壳层批量迁移）
 *
 * 键集合与 zh.ts 由 `I18nDict` 类型强制一致（缺键/多键均编译报错）。
 * 商业合作相关文案口径：仅中性商业合作表述。
 * `catalogText` 组为「中文原文 → 英文」映射（键=中文原文，B3 登记）。
 * 天文术语待交付后用户过术语表复核（人工检查点，科学准确性红线）。
 */
import type { I18nDict } from "./zh";

export const en: I18nDict = {
  contactBadge: {
    badgeLabel: "Partnership",
    dialogAriaLabel: "Commercial partnership contact",
    title: "Commercial Partnership",
    description:
      "Educational institutions, science museums, and exhibition integrators are welcome to reach out: large-screen exhibit deployment, custom development, and course content.",
    githubIssues: "GitHub Issues",
    sponsor: "Sponsor on Afdian",
    donateLabel: "Fuel the Voyage",
    donateAria: "Open the donation page (new tab)",
    unlockLabel: "Supporter Unlock",
    unlockAria: "Open the unlock page (new tab)",
    closeAria: "Close the support & partnership panel",
  },
  donate: {
    title: "Fuel the Voyage",
    subtitle: "Support the project and unlock instantly",
    intro:
      "Supporting the project unlocks the advanced content: Alipay QR payment is recommended — once paid, your unlock credential is issued automatically and the close-view detail layers and tour demos unlock instantly, with your nickname and message (both optional) listed on the contributor roster and in the Contributor Universe. The full source code remains open; your support funds continued development and domain upkeep, keeping the project free, ad-free, and open source.",
    platformsSection: "Support channels",
    platformAvailable: "Support",
    platformComingSoon: "Reserved · coming soon",
    alipayGuide:
      "Recommended: on the unlock page, click a tier card to generate a payment QR code — once paid, your unlock token is issued automatically and access unlocks instantly, no account needed; your nickname joins the contributor roster automatically.",
    alipayCta: "Pay with Alipay on the unlock page",
    wechatGuide:
      "Fallback channel: WeChat tips cannot be verified automatically — they are checked manually and the unlock token is sent by email only (not instant; usually within 48 hours). In a hurry? Use the Alipay QR above. Pay the tier amount, then email us using the template below with a payment screenshot and the transaction time.",
    mbdNote:
      "Fallback · pay by QR with no account needed, then redeem automatically on the unlock page with your order ID",
    afdianNote:
      "Fallback · redeem automatically on the unlock page with your order number (Afdian account required)",
    kofiNote:
      "Overseas fallback · verified manually, unlock token sent by email",
    wechatQrAlt: "WeChat tip code",
    wechatQrHint:
      "Long-press in WeChat to scan, or scan with your phone; please pay the tier price",
    donorsSection: "Fuel supply roster",
    donorsNote:
      "Sorted by cumulative donation amount, descending (manually registered; may lag)",
    donorsEmpty:
      "This spot is waiting — be the first star to light the voyage.",
    donorAmount: "¥{amount}",
    contributorsEntry: "Enter the Contributor Universe",
    backToApp: "Back to the star map",
  },
  contributors: {
    title: "Contributor Universe",
    subtitle:
      "Every supporter is on display here — each star corresponds to one registered donor",
    intro:
      "Star size and brightness follow a logarithmic mapping of cumulative donation amount; positions are derived deterministically from nickname and platform, independent of registration order.",
    sortNote:
      "Sorted by cumulative donation amount, descending (manually registered; may lag)",
    empty: "This spot is waiting — be the first star to light the voyage.",
    goDonate: "Go to the donation page",
    backToApp: "Back to the star map",
    hintDesktop:
      "Drag to look around · scroll to zoom · click a star for details",
    hintTouch:
      "Drag with one finger to look around · pinch to zoom · tap to focus on a contributor",
    listSection: "Text roster",
    webglFallback:
      "3D rendering is unavailable in this environment; showing the text roster instead.",
    preparing: "Lighting up the stars…",
    detailAmount: "Amount",
    detailDate: "Date",
    detailPlatform: "Platform",
    detailMessage: "Message",
    detailCloseAria: "Close details",
    anonymous: "Anonymous supporter",
    platformAlipay: "Alipay",
  },
  unlock: {
    title: "Supporter Unlock",
    subtitle:
      "Time-limited access to close-view detail layers and tour sequences",
    intro:
      "This page offers clearly priced, time-limited access: pay the tier amount and unlock automatically (or redeem with your proof of payment); access reverts to the free experience upon expiry. Supporter nicknames and messages (both optional) are listed on the contributor roster and in the Contributor Universe. The project source code remains open source.",
    backToApp: "Back to the star map",
    statusSection: "My access",
    statusFree:
      "You are on the free experience — close-view detail layers, L3/L4 tours, and unlimited demos are locked.",
    statusActive: "Access active",
    statusTierLabel: "Tier",
    statusExpiryLabel: "Expires",
    statusRemainingLabel: "Remaining",
    statusRemainingDays: "{days} days",
    tierWeek: "Week Pass",
    tierMonth: "Month Pass",
    tierYear: "Year Pass",
    copyToken: "Copy my token",
    copyTokenDone: "Copied to clipboard",
    copyTokenFail:
      "Auto-copy failed — please select and copy the text below manually",
    copyTokenAria: "Copy unlock token (paste it to activate on another device)",
    clearEntitlement: "Clear access",
    clearConfirmHint:
      "After clearing you will need to paste the token again to restore access — save your token first.",
    clearConfirmYes: "Confirm clear",
    clearConfirmNo: "Cancel",
    tiersSection: "Unlock tiers",
    tierColumnTier: "Tier",
    tierColumnPriceCny: "Price (¥)",
    tierColumnPriceUsd: "Reference ($)",
    tierColumnDays: "Duration",
    tierPriceCny: "¥{price}",
    tierPriceUsd: "${price}",
    tierDays: "{days} days",
    benefitsTitle:
      "What you unlock (identical across tiers; only duration differs)",
    benefitDetail:
      "All close-view detail layers: stellar surfaces, volumetric nebulae, black-hole gravitational lensing, and close views of clusters, galaxies and extragalactic objects (24 in total)",
    benefitTour:
      "L3/L4 tour sequences: body cycling in the galaxy and universe views",
    benefitDemo:
      "Unlimited event demos: flares / CMEs / supernovae / galaxy-merger preview",
    refundTitle: "Refunds & notes",
    refundPolicy:
      "Unredeemed orders are fully refundable; if a redeemed order is refunded, its unlock credential will be invalidated accordingly. No invoices are provided; access does not auto-renew upon expiry.",
    channelsSection: "Purchase & redeem",
    alipayChannelTitle:
      "Alipay QR pay (recommended · instant auto-unlock after payment)",
    alipayChannelGuide:
      "Click a tier card above to pay by QR code: once paid, your unlock token is issued automatically and access activates instantly — no account needed; your nickname and message (both optional) join the contributor roster.",
    alipayChannelCta: "Pick a tier and pay by QR",
    mbdTitle: "Mianbaoduo (fallback · automatic order redemption)",
    mbdGuide:
      "Pay by QR code — no account needed. Buy the matching tier product on Mianbaoduo (mbd.pub); after payment your order ID appears below the product page. Paste it below to redeem automatically.",
    mbdLink: "Buy on Mianbaoduo",
    mbdOrderInputLabel: "Mianbaoduo order ID",
    mbdOrderInputPlaceholder: "Paste order ID (32 characters)",
    mbdOrderInvalid:
      "The order ID should be 32 letters/digits — copy it from below the product page on Mianbaoduo",
    afdianTitle: "Afdian (fallback · automatic order redemption)",
    afdianGuide:
      "Afdian account required. Purchase the tier amount on Afdian (Week/Year Pass as products, Month Pass as a subscription plan), then paste your order number below to redeem automatically.",
    afdianLink: "Buy on Afdian",
    orderInputLabel: "Afdian order number",
    orderInputPlaceholder: "Paste order number (14-40 digits)",
    orderInvalid:
      'The order number should be 14-40 digits — copy it from "My Orders" on Afdian',
    redeemButton: "Redeem",
    redeemPending: "Redeeming…",
    redeemSuccess: "Redeemed — access activated!",
    errInvalidOrder: "Invalid order number — please check and retry",
    errOrderNotPaid:
      "The order has not been paid — please pay before redeeming",
    errAmountTooLow:
      "The order amount is below the lowest tier (¥6) and cannot be redeemed",
    errAlreadyRedeemed:
      "This order has already been redeemed (if switching devices, activate with your original token)",
    errUpstream:
      "The order-lookup service is temporarily unavailable — please retry later",
    errNotConfigured:
      "The redeem service is not yet live — please come back later or contact us by email",
    errPlanNotEligible:
      "The item in this order is not eligible for unlock redemption — please make sure you purchased an unlock tier item",
    errUnknown:
      "Redeem failed (unknown error) — please retry later or contact us by email",
    errNetwork:
      "Network request failed — please check your connection and retry",
    wechatTitle: "WeChat tip code (manual review · token sent by email)",
    wechatGuide:
      "Handled manually — the unlock token is sent by email only (not instant; usually within 48 hours). We recommend the Alipay QR above instead: token issued automatically, unlocks instantly.",
    wechatSteps:
      "Pay the selected tier amount by scanning the tip code, then send a redeem email to {email} using the template below, with a payment screenshot and the transaction time.",
    wechatExpand: "Show WeChat payment steps (tip code + email template)",
    wechatCollapse: "Hide WeChat payment steps",
    wechatQrAlt: "WeChat tip code",
    wechatQrHint:
      "Long-press in WeChat to scan, or scan with your phone; please pay the tier price",
    kofiTitle: "Ko-fi (overseas fallback · manual review)",
    kofiGuide:
      "Pay the tier\u2019s $ amount via Ko-fi, then send a redeem email to {email} with your payment receipt and the transaction time — we will reply with your unlock token (usually within 48 hours).",
    kofiLink: "Pay on Ko-fi",
    emailCta: "Send redeem email",
    emailSubject: "Stellar Odyssey unlock redemption",
    mailTplHint:
      "Email template (copy with one click, or open your mail client pre-filled):",
    mailTplToLabel: "To",
    mailTplSubjectLabel: "Subject",
    mailTplBody:
      "Nickname (optional, listed on the contributor roster):\nTier purchased (Week/Month/Year Pass) and payment channel:\nPayment screenshot: see attachment\nTransaction time:\nMessage (optional, shown on the roster):\n\nNote: the unlock token will be sent to the address this email is sent from — make sure it can receive mail. If nothing arrives for a long while, check your spam folder and add {email} to your contacts.",
    mailTplCopy: "Copy email template",
    mailTplCopied: "Copied",
    mailTplOpen: "Open mail client",
    tokenSection: "Already have a token? Activate here",
    tokenIntro:
      "Tokens from manual-channel replies, device migration, or B2B delivery are all pasted and activated here.",
    tokenInputLabel: "Unlock token",
    tokenInputPlaceholder: "Paste the full token starting with SO1.",
    tokenActivate: "Activate",
    tokenErrFormat:
      "Malformed token — make sure you copied it in full (three segments starting with SO1.)",
    tokenErrSignature:
      "Token signature verification failed — do not modify the token and retry",
    tokenErrExpired: "This token has expired — purchase any tier to renew",
    tokenActivated: "Access activated!",
    revokedNotice:
      "This credential has quietly dimmed with the refund. The stars remain where you left them — whenever you wish to set sail again, the unlock page keeps a light on for you.",
    revokeCheckFailed:
      "Unable to verify credential status. Please check your network connection and try again.",
    lockedTitle: "Supporter-only content",
    lockedDetailBody:
      "This close-up detail is supporter-only. Unlock to view it up close.",
    lockedCycleBody:
      "Galaxy/Universe tour sequences are supporter-only. Unlock to tour every stop.",
    lockedQuotaBody:
      "Today's free demo quota is used up. Unlock for unlimited demos, or come back tomorrow.",
    lockedGoUnlock: "Unlock now",
    lockedGoUnlockAria: "Open unlock page (new tab)",
    lockedCloseAria: "Dismiss lock notice",
    panelSection: "Supporter Unlock",
    panelStatusFree: "Free experience",
    panelStatusActive: "{tier} · {days} days left",
    panelGo: "View unlock plans",
    panelGoAria: "Open unlock page (new tab)",
    demoQuotaRemaining: "{count} free demos left today",
    demoQuotaExhausted: "Today's free demos are used up — unlock for unlimited",
    cycleLockedTooltip: "Galaxy/Universe tours are supporter-only",
    alipay: {
      tierCta: "Pay with Alipay QR",
      tierCtaAria: "Select {tier} and open the Alipay payment dialog",
      modalTitle: "Pay with Alipay QR code",
      closeAria: "Close payment dialog",
      tierLine: "{tier} · ¥{price} / {days} days",
      nicknameLabel: "Nickname (optional)",
      nicknamePlaceholder:
        'Shown on the contributor roster; leave empty to appear as "Anonymous supporter"',
      messageLabel: "Message (optional)",
      messagePlaceholder: "Shown with your nickname, up to 50 characters",
      publicNote:
        "Your nickname and message will be publicly displayed on the contributor roster and the Contributor Universe.",
      createButton: "Generate payment code",
      creating: "Generating payment code…",
      qrTitle: 'Open Alipay "Scan" to complete the payment',
      qrAlt: "Alipay payment QR code",
      amountLine: "Amount due: ¥{amount}",
      expireHint:
        "The QR code is valid for 30 minutes; access activates automatically on this page once paid.",
      openInAlipay: "Open Alipay on this phone to pay",
      waiting: "Waiting for payment confirmation…",
      paidTitle: "Payment received — access activated!",
      paidTokenHint:
        "Here is your unlock token — keep it safe. Paste it on the unlock page to restore access on another device:",
      expiredNotice:
        "The QR code has expired (unpaid for over 30 minutes) — please generate a new one.",
      regenerate: "Generate a new payment code",
      backToEdit: "Back to edit",
      errNicknameTooLong:
        "Nickname too long — please keep it within 20 characters",
      errNicknameBlocked:
        "The nickname contains content unsuitable for public display — please revise and retry",
      errMessageTooLong:
        "Message too long — please keep it within 50 characters",
      errMessageBlocked:
        "The message contains content unsuitable for public display — please revise and retry",
      errNotConfigured:
        "Alipay payment is not yet live — please use Afdian or another channel",
      errGateway: "Alipay pre-order failed — please retry later",
      errOrderLost:
        "Order status lookup failed — please generate a new payment code",
      errUnknown:
        "Operation failed (unknown error) — please retry later or contact us by email",
      errNetwork:
        "Network request failed — please check your connection and retry",
      errTokenVerify:
        "The credential returned by the server failed verification — please contact us by email",
    },
  },
  lab: {
    entrySection: "Astronomy Lab",
    entryLabel: "Enter the Astronomy Lab",
    entryAria: "Open the Astronomy Lab (new tab)",
    title: "Astronomy Lab",
    subtitle:
      "Interactive sky experiments built on real catalogs and physical models",
    backToApp: "Back to the star map",
    backToLab: "Back to the lab",
    open: "Enter experiment",
    dataSourceLabel: "Data sources",
    loadingScene: "Loading lab scene…",
    loadingStars: "Loading bright star catalog…",
    starsFailed:
      "Failed to load the bright star catalog — the star dome is unavailable. Please refresh and retry.",
    unknownEntry: "Unregistered lab experiment",
    hintLookAround:
      "Drag or two-finger scroll to look around · Pinch to zoom the field of view",
    meteorShowerTitle: "Midsummer Twin Meteor Showers",
    meteorShowerDescription:
      "A physics-driven observing field for the Perseids and κ-Cygnids: a real star dome from the Yale Bright Star Catalog (8,404 stars, mag ≤ 6.5) projected in horizontal coordinates — a mid-northern night sky you can look around. Includes a historical recreation of the 1966 Leonid storm.",
    panelTitle: "Observation Console",
    showerTabAria: "Switch meteor shower",
    showerPerseids: "Perseids",
    showerKappaCygnids: "κ-Cygnids",
    showerLeonids1966: "Leonid Storm '66",
    cardRadiant: "Radiant",
    cardSpeed: "Entry speed",
    cardZhr: "ZHR",
    cardParent: "Parent body",
    parentPerseids: "Comet 109P/Swift–Tuttle",
    parentKappaCygnids: "Unconfirmed (candidates still debated)",
    parentLeonids: "Comet 55P/Tempel–Tuttle",
    stormNote1966:
      "Historical recreation: the Leonid storm of 1966-11-17, simulated at a conservative ZHR of 40,000 (peak estimates briefly reached ~40 meteors per second)",
    ctrlTimeScale: "Time rate",
    ctrlTimeLapse: "Time-lapse",
    ctrlHourOffset: "Local time offset",
    ctrlLimitingMag: "Light pollution (limiting magnitude)",
    ctrlObserverLat: "Observer latitude",
    ctrlAdvanced: "Advanced",
    ctrlFireballRate: "Fireball rate boost",
    ctrlWindSpeed: "Upper-atmosphere wind",
    ctrlRadiantMarker: "Radiant marker",
    hudLocalTime: "Local time",
    hudRadiantAlt: "Radiant altitude",
    radiantLabelPerseids: "Perseus",
    radiantLabelKappaCygnids: "Cygnus",
    radiantLabelLeonids: "Leo",
    viewModeAria: "Switch viewpoint",
    viewGround: "Ground",
    viewSpace: "Space",
    hudNextMeteor: "Next meteor",
    hudNextFireball: "Next fireball",
    ffMeteor: "Skip to next meteor",
    ffFireball: "Skip to next fireball",
    demoMeteor: "Demo meteor",
    demoFireball: "Demo fireball",
    demoDisclaimer:
      "Demos are injected outside the timeline — not the real flux schedule at this moment",
    ctrlFollowOnDemo: "Follow on trigger",
    followExit: "Exit follow (ESC)",
    vaporizedToast:
      "The meteoroid has fully vaporized before reaching the ground — cometary meteoroids burn up at 80–115 km and never land",
    ctrlBurnLayer: "Burn-layer reference discs (80/115 km)",
    hintSpace: "Drag to orbit above the burn layers · Scroll to zoom",
    audioEnable: "Meteor audio (sonification)",
    audioVolumeAria: "Audio volume",
    sonificationNote:
      'Sonification note: real meteors are silent. The descending whistle emulates radio echoes — forward scatter of radio signals off the ionized trail, a radio-observation technique; the fireball crackle nods to "electrophonic sounds", a rare and still-debated phenomenon.',
    helpTips:
      "Drag or two-finger scroll to look around; enable the radiant marker to find it — every meteor streaks away from that point; use the fast-forward/demo buttons to see one right away.",
    panelExpandAria: "Expand the observation console",
    panelCollapseAria: "Collapse the observation console",
    observatoryTitle: "Body Observatory",
    observatoryDescription:
      "Every close-up detail rig in one place: stellar surfaces, volumetric nebulae, galaxy close views, black-hole lensing and more — 23 observable targets with live tuning sliders, performance readouts, and view presets.",
    observatoryPickBody: "Pick a target",
    observatoryEnter: "Observe",
    observatoryBackToGallery: "Back to targets",
    observatoryPremiumBadge: "Supporter · limited daily trials",
    observatoryFreeWindowNote:
      "Free-access window: unlimited for all targets until {date}",
    observatoryEntitledNote:
      "Supporter access active: unlimited for all targets",
    observatoryQuotaLine: "{count} observations left today",
    observatoryPremiumQuotaLine: "{count} supporter-target trials left today",
    observatoryLockedTitle: "Observation limited",
    observatoryLockedDaily:
      "Today's free observations are used up — unlock for unlimited access, or come back tomorrow.",
    observatoryLockedPremium:
      "Today's trials for supporter targets are used up — unlock for unlimited access, or come back tomorrow.",
    observatoryUnknownBody: "Unregistered observation target",
    obsHudFps: "FPS",
    obsHudHeap: "JS heap",
    obsHudClock: "Virtual clock",
    obsHudQuality: "Volume quality tier",
    obsHudSource: "Source",
    obsPanelBloom: "Bloom",
    obsPanelGrid: "Reference grid",
    obsPanelExposure: "Exposure",
    obsPanelPresets: "View presets",
    obsPanelParams: "Observation parameters",
    obsBodyBetelgeuse: "Betelgeuse · Red Supergiant",
    obsBodyRigel: "Rigel · Blue Supergiant",
    obsBodySirius: "Sirius A · Main-sequence Star",
    obsBodySiriusB: "Sirius B · White Dwarf",
    obsBodyDeltaCephei: "Delta Cephei · Yellow Supergiant",
    obsBodyWr124: "WR 124 · Wolf–Rayet Star & Ejecta Shell",
    obsBodyVolumeTest: "Volumetric Cloud Test (Tech Demo)",
    obsBodyOrionNebula: "Orion Nebula M42",
    obsBodyRingNebula: "Ring Nebula M57",
    obsBodyHorsehead: "Horsehead Nebula Barnard 33",
    obsBodyCrabPulsar: "Crab Nebula M1",
    obsBodyM31: "Andromeda Galaxy M31",
    obsBodyM33: "Triangulum Galaxy M33",
    obsBodyLmc: "Large Magellanic Cloud",
    obsBodySmc: "Small Magellanic Cloud",
    obsBodyM87: "Virgo A M87 · Cluster Core",
    obsBodyBlackholeTest: "Black-hole Lensing (Tech Demo)",
    obsBodyPleiades: "Pleiades M45",
    obsBodyM13: "Hercules Globular Cluster M13",
    obsBodyQuasar3c273: "Quasar 3C 273",
    obsBodyAntennae: "Antennae Galaxies NGC 4038/4039",
    obsBodyClusterLensing: "Cluster Gravitational Lensing (Tech Demo)",
    obsBodyGrb: "Gamma-ray Burst GRB 221009A",
    obsParamTeff: "Effective temperature Teff (K)",
    obsParamCellScale: "Convection noise frequency",
    obsParamTimeScale: "Time rate",
    obsParamShAmplitude: "Spherical-harmonic patch amplitude",
    obsParamShSpeed: "Patch evolution speed",
    obsParamEjectaDensity: "Ejecta shell density",
    obsParamExpandAmp: "Radial expansion amplitude",
    obsParamSteps: "Base raymarch steps",
    obsParamRaySteps: "Raymarch steps",
    obsParamDensity: "Density multiplier",
    obsParamCurtainDensity: "Emission curtain density",
    obsParamAbsorption: "Absorption",
    obsParamHueA: "Hue A (Hα red)",
    obsParamHueB: "Hue B (OIII teal)",
    obsParamIntensity: "Brightness",
    obsParamQuality: "Quality tier (0 auto / 1 low / 2 mid / 3 high)",
    obsParamJitter: "Blue-noise jitter (0 off / 1 on)",
    obsParamWeightBias: "Dual-hue balance (−OIII / +Hα)",
    obsParamDust: "Dust absorption",
    obsParamImageDriven: "Image-driven (0 parametric / 1 imagery)",
    obsParamDustStrength: "Dust lane strength",
    obsParamDustStrengthNoop: "Dust lane strength (no effect on this target)",
    obsParamHiiDensity: "HII region density",
    obsParamHiiDensityNoop: "HII region density (no effect on this target)",
    obsParamInclination: "Inclination override (°)",
    obsParamVolExtinction: "Volumetric dust extinction (0 = off)",
    obsParamVolThickness: "Dust disc thickness (ly)",
    obsParamDor30Boost: "30 Dor brightness (0 off)",
    obsParamDor30Scale: "30 Dor scale boost",
    obsParamGcCount: "Globular cluster count",
    obsParamMembers: "Virgo members (0 off / 1 on)",
    obsParamIcmOpacity: "ICM glow intensity",
    obsParamMassScale: "Mass scale",
    obsParamCameraDistance: "Camera distance",
    obsParamDiskIncl: "Disc inclination (°, 0 face-on / 90 edge-on)",
    obsParamDiskInner: "Disc inner edge (r_s)",
    obsParamDiskOuter: "Disc outer edge (r_s)",
    obsParamBeamStrength: "Doppler beaming",
    obsParamSizeGain: "Particle size gain",
    obsParamSpikeGain: "Star-spike size",
    obsParamNebulaStrength: "Reflection nebula strength",
    obsParamBrightnessGain: "Brightness gain",
    obsParamDiskGain: "Disc brightness",
    obsParamTorusGain: "Dust torus brightness",
    obsParamJetAngle: "Jet opening angle (°)",
    obsParamJetGain: "Jet brightness",
    obsParamShellGain: "Afterglow strength",
    obsParamEinsteinRadius: "Einstein radius (scene units)",
    obsParamLensStrength: "Lens strength",
    obsParamSourceGain: "Background source brightness",
    obsPresetOverview: "Overview",
    obsPresetCore: "Core close-up (EHT photon ring)",
    solarEclipseTitle: "Total Solar Eclipse",
    solarEclipseDescription:
      "Three real total solar eclipses recreated from authoritative ephemerides: the 2027 eclipse of the century over Egypt (totality 6 min 23 s), the 2035 eclipse over Beijing, and the 1919 eclipse that proved general relativity. Stand on the central line and scrub the timeline from first contact to last.",
    eclipseTabAria: "Switch eclipse event",
    eclipseTab2027: "2027-08-02 · Egypt",
    eclipseTab2035: "2035-09-02 · Beijing",
    eclipseTab1919: "1919-05-29 · Sobral",
    eclipseObserver2027:
      "Site: New Valley, Egypt (central line, totality 6 min 23 s)",
    eclipseObserver2035:
      "Site: Beijing outskirts, China (central line, totality 1 min 51 s)",
    eclipseObserver1919:
      "Historical scene · Site: Sobral, Brazil (1919 Eddington expedition site, totality 5 min 14 s)",
    eclipseAnchorC1: "First contact",
    eclipseAnchorC2: "Totality begins",
    eclipseAnchorMax: "Maximum",
    eclipseAnchorC3: "Totality ends",
    eclipseAnchorC4: "Last contact",
    eclipseTimelineAria: "Eclipse timeline",
    eclipsePlay: "Play",
    eclipsePause: "Pause",
    eclipseHudUtc: "UTC",
    eclipseHudMagnitude: "Magnitude",
    eclipseHudObscuration: "Obscuration",
    eclipseHudSunDiam: "Sun diameter",
    eclipseHudMoonDiam: "Moon diameter",
    eclipseHudRate: "Rate",
    eclipseHudPhase: "Phase",
    eclipseHudKind: "Type",
    eclipseHudTotalityLeft: "Totality left",
    eclipsePhaseNone: "No eclipse",
    eclipsePhasePartial: "Partial",
    eclipsePhaseTotal: "Total",
    eclipsePhaseAnnular: "Annular",
    eclipsePlayModeAria: "Playback mode",
    eclipsePlayModeTour: "Guided speed",
    eclipsePlayModeReal: "×1 real time",
    eclipseExposureTitle: "Exposure",
    eclipseExposureAuto: "Auto (human eye)",
    eclipseExposureManual: "Manual",
    eclipseExposureSliderAria: "Exposure (filter ↔ naked eye)",
    eclipseExposureFiltered: "Filter",
    eclipseExposureNaked: "Naked eye",
    eclipseExposureCard:
      "The photosphere is about a million times brighter than the corona (6 orders of magnitude) — no single exposure can show both: the filter stop shows only the photosphere, while the naked-eye stop lets the photosphere bloom out as the corona appears. Corona brightness here is tone-mapped, not a linear physical value.",
    eclipseActivityTitle: "Solar cycle",
    eclipseActivityAria: "Solar activity cycle (corona shape)",
    eclipseActivityMin: "Minimum",
    eclipseActivityMax: "Maximum",
    eclipseHypoTitle: "What-if mode",
    eclipseHypoToggleAria: "Toggle what-if mode",
    eclipseHypoBadge:
      "What-if mode: Moon distance overridden, geometry recomputed",
    eclipseHypoMoonDist: "Moon distance",
    eclipseHypoMoonDistAria: "Hypothetical Moon distance (km)",
    eclipseCompareTitle: "Sky-brightness cliff",
    eclipseCompare99: "99% covered",
    eclipseCompare100: "Maximum 100%",
    eclipseEnvTitle: "Environment",
    eclipseEnvTemp: "Temp. drop",
    eclipseEnvSky: "Sky brightness",
    eclipseEnvLm: "Limiting mag.",
    eclipseCardC1:
      "First contact: the lunar limb bites into the Sun. For the next hour the Sun is slowly eaten away, yet you barely notice any dimming before 90% coverage — your eyes hide it. The tree-shadow spots on the ground give it away first: each one becomes a tiny crescent.",
    eclipseCardC2:
      "The last moments before totality: sunlight survives only through valleys on the lunar limb — Baily's beads, whose sizes and gaps come from real lunar-limb topography (LRO/LOLA). When they converge to a single bead you get the diamond ring. Caution: the photosphere is still exposed — in reality it is NOT yet safe to look with naked eyes. Fast ripples may sweep the ground (shadow bands — real mechanism, stylized rendering).",
    eclipseCardMax:
      "Maximum: the middle of totality. The corona stretches outward (its shape follows the solar cycle) and pink prominences silhouette beyond the lunar limb (typical forms — the actual distribution of that day is unrecorded). Look around: the horizon glows orange in a full 360° ring, because the land a hundred-odd kilometres away is still in sunlight — totality is not night.",
    eclipseCardC3:
      "Third contact: the diamond ring bursts out on the other limb, scatters back into beads, and the red chromosphere flashes once. Caution: the instant the photosphere returns it is unsafe for naked eyes — in reality filters go back on right now.",
    eclipseCardC4:
      "Last contact: the Moon fully leaves the solar disk. On average a given spot on Earth waits about 375 years for the next total eclipse — and as the Moon recedes ~3.8 cm per year, total eclipses will end forever in a few hundred million years. We happen to live in the geological window that gets to see them.",
    eclipsePlanetVenus: "Venus",
    eclipsePlanetJupiter: "Jupiter",
    eclipsePlanetMercury: "Mercury",
    eclipsePlanetMars: "Mars",
    eclipsePlanetSaturn: "Saturn",
    eclipsePlanetUranus: "Uranus",
    eclipsePlanetNeptune: "Neptune",
    eclipseSunLabel: "Sun",
    eclipseLoadingEphemeris: "Loading eclipse ephemerides…",
    eclipseEphemerisFailed:
      "Failed to load the eclipse ephemerides — the scene is unavailable. Please refresh and retry.",
    eclipseHintLookAround:
      "Drag or two-finger scroll to look around · pinch to zoom in (up to ~×20) on the eclipsed Sun and Baily's beads",
    /** LE-M6 patch P5 body tracking (ground view only, on by default) */
    eclipseFollowLabel: "Track the Sun (auto-centre)",
    eclipseFollowAria: "Track the Sun and keep it centred",
    eclipseRecenterLabel: "⊙ Back to the Sun",
    eclipseRecenterAria: "Smoothly recentre the view on the Sun",
    eclipseFollowNote:
      "While tracking, the Sun stays in view (any offset you drag to is preserved); the stars and horizon move with the tracking in turn — the equivalent of an equatorial mount. Turn it off for a fixed pointing.",
    eclipseViewTitle: "View",
    eclipseViewAria: "Switch viewpoint",
    eclipseViewGround: "Ground",
    eclipseViewSpace: "Space",
    eclipseHudUmbraWidth: "Umbra width",
    eclipseHudShadowSpeed: "Umbra ground speed",
    eclipseHudAntumbra: "antumbra",
    eclipseUmbraMagnifyLabel: "Magnify umbra ×8",
    eclipseUmbraMagnifyAria: "Toggle umbra magnification (display aid)",
    eclipseUmbraMagnifyBadge:
      "Umbra shown magnified ×8 (true width in the HUD)",
    eclipseInclinationLabel: "Inclination story",
    eclipseInclinationAria: "Toggle inclination story mode",
    eclipseInclinationBadge:
      "True orbital inclination 5.145°, shown exaggerated ×4; orbit and node pacing use a narrative timescale",
    eclipseInclinationCard:
      "The Moon's orbit is tilted 5.145° to the ecliptic — at most new moons the shadow sweeps above or below the Earth. Only when new moon happens near an orbital node does the cone strike the Earth. Watch the cone miss most passes and connect only during eclipse seasons roughly every half year.",
    eclipseSpaceCard:
      "Space view notes: the Sun is drawn with its true direction but compressed distance (the real 150 million km is beyond the scene); the translucent shadow cones are a visual aid — real shadow cones are invisible. Umbra/penumbra and the ground shadow spot are solved each frame from true cone geometry; at true scale the umbra is only ~100–270 km wide.",
    eclipseHintSpace:
      "Drag to orbit · Scroll or pinch to zoom · Press play to watch the umbra sweep",
    /** M7-3 Moon magnification (A16: ×4 synced with MOON_MAGNIFY_FACTOR) */
    eclipseMoonMagnifyLabel: "Magnify Moon ×4",
    eclipseMoonMagnifyAria: "Toggle Moon magnification (display aid)",
    eclipseMoonMagnifyBadge:
      "Moon and shadow-cone bases shown ×4 larger (the real Moon is only 27% of Earth's diameter); the ground shadow spot keeps true geometry — turn off to restore true scale",
    /** M8-1 body-scale segmented control (A18: artistic default = L2 look) */
    eclipseBodyScaleAria: "Switch body-scale display mode",
    eclipseBodyScaleArt: "Artistic",
    eclipseBodyScaleReal: "True scale",
    eclipseBodyScaleCard:
      "Artistic mode: body radii are log-compressed and enlarged (not to scale — the same mapping as the main Solar-System view); the shadow cones and ground shadow spot are redrawn on the enlarged Earth, keeping true sweep position and relative size (the spot uses a circular approximation); the asteroid belt is an illustrative point cloud. Switch to True scale for real proportions.",
    /** M7-4 planet-orbit backdrop (A17: compressed distances + non-scale dots) */
    eclipsePlanetOrbitsLabel: "Planet orbits",
    eclipsePlanetOrbitsAria: "Toggle the planet-orbit backdrop",
    eclipsePlanetOrbitsCard:
      "The planet backdrop is artistic: directions and orbital phases follow real orbital elements, but heliocentric distances are compressed (1 AU ≈ 1,500 scene units, outer planets log-compressed) and planet dots are not to scale. The background shows the real Yale bright-star sky plus a procedural Milky Way band (true galactic-plane orientation, artistic texture).",
    /** M5 Eddington starlight deflection (A10: ×2500 synced with EDDINGTON_DEFLECTION_EXAGGERATION) */
    eclipseDeflectionTitle: "Starlight deflection (1919)",
    eclipseDeflectionToggle: "Show gravitational deflection",
    eclipseDeflectionAria: "Toggle starlight deflection comparison",
    eclipseDeflectionBadge:
      "Deflection exaggerated ×2500 for display; the real effect is tiny — just 1.75″ even at the solar limb. The values next to the markers are true arcseconds.",
    eclipseDeflectionLegend:
      "Hollow ring = position without the Sun · solid dot = deflected position · the closer to the Sun, the larger the shift (δ ∝ 1/b)",
    eclipse1919Card:
      "Historical scene: on 29 May 1919, two British expeditions — at Sobral, Brazil and Príncipe, West Africa — measured how starlight bends when passing near the Sun (Eddington himself was on Príncipe, where clouds left only 2 usable plates; the decisive data came from Sobral\u2019s 4-inch lens: 7 plates, 1.98″ ± 0.12″). Only during a total eclipse can stars near the Sun be seen — at maximum the Sun stood right in the Hyades cluster, rich in bright stars, which is exactly why this eclipse was chosen. The measured deflection matched the prediction of general relativity (1.75″ at the solar limb), about twice the Newtonian value. The precision achieved then was close to the experimental limit; the conclusion was confirmed by repeated measurements in the second half of the 20th century.",
    /** M6 panel drawer title (<sm bottom drawer; toggle button reuses panel*Aria keys) */
    eclipsePanelTitle: "Observation console",
    eclipseLinkToLunar: "→ Visit the lunar eclipse lab for the other half of this geometry",
    /** M6 soundscape (§5; A8: totality "silence" is artistic — note shown bilingually) */
    eclipseAudioEnable: "Eclipse soundscape (sonification)",
    eclipseAudioNote:
      "Soundscape note: a real eclipse makes no sound of its own. The fading ambience and the near-silence of totality are an artistic rendering of the on-site atmosphere; the chimes at second/third contact (diamond-ring moments) are sonification by design.",
    /** M6 one-time viewing-safety notice (§3.4, item-by-item wording; never repeats once confirmed) */
    eclipseSafetyTitle: "Viewing safety",
    eclipseSafetyScreen:
      "On this page (on screen) you may look freely — everything here is a simulation.",
    eclipseSafetyRetina:
      "In real life, staring at the Sun damages the retina — painlessly and irreversibly.",
    eclipseSafetyTotalityOnly:
      "Only during totality (between second contact C2 and third contact C3) may you briefly look with the naked eye, and only at a total eclipse; partial and annular eclipses are never safe to view unaided.",
    eclipseSafetyNoDiy:
      "Sunglasses, homemade filters, smoked glass and exposed film do not protect your eyes — none of them work.",
    eclipseSafetyCertified:
      "At all other times use ISO 12312-2 certified solar filters (eclipse glasses), or switch to indirect methods such as pinhole projection.",
    eclipseSafetyConfirm: "Got it",
    /** LE-M2 lunar eclipse lab (/lab/lunar-eclipse): entry card / 4 tabs / HUD / 7-anchor timeline */
    lunarEclipseTitle: "Lunar Eclipse",
    lunarEclipseDescription:
      "Four real lunar eclipses from authoritative ephemerides: the century's deepest totality in 2029 (magnitude 1.84), the 2026 partial that just misses totality, the almost imperceptible 2027 penumbral eclipse, and the 1992 post-Pinatubo ultra-dark blood moon (Danjon L=0). Scrub the timeline and watch Earth's shadow creep across the Moon — completely safe to watch with the naked eye.",
    lunarTabAria: "Switch lunar eclipse event",
    lunarTab2029: "2029-06-26 · Total",
    lunarTab2026: "2026-08-28 · Partial",
    lunarTab2027: "2027-02-20 · Penumbral",
    lunarTab1992: "1992-12-09 · Historic L=0",
    lunarObserver2029:
      "Observer: São Paulo, Brazil (Moon at 87° altitude at maximum, near zenith; the deepest, darkest lunar eclipse of the century, Saros 130)",
    lunarObserver2026:
      "Observer: Manaus, Brazil (Moon at 83° at maximum; magnitude 0.93 — tantalizingly close to totality, Saros 138)",
    lunarObserver2027:
      "Observer: Lagos, Nigeria (Moon at 78° at maximum; a penumbral eclipse that is nearly invisible to the eye — truthfully so, Saros 143)",
    lunarObserver1992:
      "Historic scene · Observer: Madrid, Spain (Moon at 72° at maximum; rated Danjon L=0 after the Pinatubo eruption, Saros 125)",
    lunarAnchorP1: "P1 penumbral start",
    lunarAnchorU1: "U1 umbral start",
    lunarAnchorU2: "U2 totality begins",
    lunarAnchorMax: "Maximum",
    lunarAnchorU3: "U3 totality ends",
    lunarAnchorU4: "U4 umbral end",
    lunarAnchorP4: "P4 penumbral end",
    lunarTimelineAria: "Lunar eclipse timeline",
    lunarPlayModeAria: "Playback mode",
    lunarPlayModeFast: "Fast replay",
    lunarPlayModeReal: "×1 real time",
    lunarHudUtc: "UTC",
    lunarHudRate: "Speed",
    lunarHudKind: "Phase",
    lunarHudUmbralMag: "Umbral mag.",
    lunarHudPenumbralMag: "Penumbral mag.",
    lunarHudDanjon: "Danjon L",
    lunarHudMoonAlt: "Moon altitude",
    lunarHudMoonDiam: "Moon ang. diam.",
    lunarKindNone: "No eclipse",
    lunarKindPenumbral: "Penumbral",
    lunarKindPartial: "Partial",
    lunarKindTotal: "Total",
    lunarCardP1:
      "Penumbral start: the Moon enters Earth's penumbra. For a while you will hardly notice anything — inside the penumbra part of the Sun still shines directly on the Moon, so the dimming is extremely subtle. That is not a rendering flaw; it is real: about 36% of lunar eclipses never leave the penumbra and are nearly invisible to the eye.",
    lunarCardU1:
      "Umbral start: the lunar limb touches the umbra and a dark bite appears. Unlike a solar eclipse, that bite is Earth's own shadow — about 9,000 km across at the Moon's distance, some 2.6 Moon diameters. The curvature of its edge is the curvature of Earth: the ancient Greeks inferred a spherical Earth from exactly this.",
    lunarCardU2:
      "Totality begins: the Moon is fully immersed in the umbra. It does not vanish — Earth's atmosphere refracts sunlight into the shadow cone and filters it red: seen from the Moon, Earth's silhouette is rimmed by a burning red ring — every sunrise and sunset on Earth at once. Totality can last nearly 107 minutes, safe for the naked eye throughout.",
    lunarCardMax:
      "Maximum: the Moon's center is closest to the shadow axis. Note how brightness inside the umbra grades radially — darker toward the shadow center, brighter and yellower toward its edge; it is not a uniform red tint. The Moon is now roughly 10,000× fainter than a full moon, the stars it had drowned out return, and the ground dims with it.",
    lunarCardU3:
      "Totality ends: the lunar limb emerges on the far side of the umbra. Note the bite now sits opposite to where it entered — the shadow exits across the other limb.",
    lunarCardU4:
      "Umbral end: the Moon fully leaves the umbra and the naked-eye eclipse is over. Only the subtle penumbral dimming remains as the full moon returns.",
    lunarCardP4:
      "Penumbral end: the Moon leaves the penumbra and the eclipse is over. The Moon recedes ~3.8 cm per year, yet lunar eclipses will not vanish in the distant future the way total solar eclipses will — Earth's shadow is far larger than the Moon.",
    lunarLoadingEphemeris: "Loading lunar eclipse ephemerides…",
    lunarEphemerisFailed:
      "Failed to load lunar eclipse ephemerides — the scene is unavailable. Please refresh and try again.",
    lunarHintLookAround:
      "Drag or two-finger scroll to look around · pinch to zoom in (up to ~×20) on the umbral bite and the gradient inside it",
    /** LE-M6 patch P5 body tracking (ground view only, on by default) */
    lunarFollowLabel: "Track the Moon (auto-centre)",
    lunarFollowAria: "Track the Moon and keep it centred",
    lunarRecenterLabel: "⊙ Back to the Moon",
    lunarRecenterAria: "Smoothly recentre the view on the Moon",
    lunarFollowNote:
      "While tracking, the Moon stays in view (any offset you drag to is preserved); the stars and horizon move with the tracking in turn — the equivalent of an equatorial mount. Turn it off for a fixed pointing.",
    lunarPanelTitle: "Observation Console",
    /** M3 blood-moon controls: Danjon presets + turbidity + exposure (B2/B6 notes) */
    lunarDanjonTitle: "Danjon scale (blood-moon depth)",
    lunarDanjonAria: "Danjon five-level presets",
    lunarDanjonDesc0: "L0 Very dark: the Moon is almost invisible, especially at maximum",
    lunarDanjonDesc1: "L1 Dark: gray or brownish coloration, details hard to make out",
    lunarDanjonDesc2:
      "L2 Deep red or rust-colored: very dark central shadow, relatively bright outer umbra",
    lunarDanjonDesc3: "L3 Brick-red: the umbra usually has a bright or yellow rim",
    lunarDanjonDesc4: "L4 Very bright copper-red or orange: an exceptionally bright rim",
    lunarDanjonNote:
      "The Danjon scale is a subjective visual rating (Danjon 1921) with no standard color values — the colors here are an artistic mapping.",
    lunarTurbidityAria: "Atmospheric turbidity / volcanic dust",
    lunarTurbidityClean: "Clean",
    lunarTurbidityDusty: "Volcanic dust",
    lunarExposureTitle: "Exposure",
    lunarExposureAria: "Exposure",
    lunarExposureDim: "Dim",
    lunarExposureBright: "Long exposure",
    lunarExposureNote:
      "Long-exposure photos are far brighter than the naked-eye view — slide up ≈ camera long exposure, down ≈ what your eyes see.",
    lunarPinatuboCard:
      "The 1991 Pinatubo eruption injected some twenty million tonnes of sulfur dioxide into the stratosphere. The next lunar eclipse, 1992-12-09, was widely rated Danjon L=0 — the Moon nearly vanished from the sky at maximum. This tab restores that ultra-dark state by default; drag the turbidity slider to see how atmospheric clarity sets the depth of a blood moon.",
    lunarTriptychToggle: "Triple comparison: penumbral / partial / total",
    lunarTriptychPenumbral: "Penumbral max · 2027",
    lunarTriptychPartial: "Partial max · 2026",
    lunarTriptychTotal: "Total max · 2029",
    lunarTriptychHonest:
      "You can barely see any change in the penumbral pane — and that is real: about 36% of lunar eclipses never leave the penumbra and are nearly invisible to the eye.",
    lunarFitCircleToggle: "Round-Earth proof: overlay fitted umbra circle",
    lunarFitCircleCard:
      "Scrub the timeline and switch between eclipses: the arc laid over the bite always has the same curvature. This is exactly how the ancient Greeks reasoned — Earth's shadow edge is always a circular arc of the same curvature, and only a sphere casts a circular shadow in every direction. The lunar eclipse is one of humanity's earliest proofs of a round Earth.",
    lunarLimbSurgeCard:
      "A full moon looks slightly brighter at its rim than at its center: the cratered surface reflects more strongly back toward the light (the opposition surge) — like velvet stretched over a convex form, darkest in the middle, brightest at the edge. Rendered here with a simplified retroreflection model.",
    lunarViewTitle: "View",
    lunarViewAria: "Switch viewpoint",
    lunarViewGround: "Ground",
    lunarViewSpace: "Space",
    lunarHintSpace:
      "Drag to rotate · Scroll or pinch to zoom · Press play to watch the Moon cross Earth's shadow",
    lunarHudScale: "Scale",
    lunarHudConeLen: "Shadow cone length",
    lunarHudMoonDistRow: "Earth–Moon distance",
    lunarHudUmbraWidthRow: "Umbra at Moon",
    lunarHudUmbraRatio: "Umbra/Moon · /R⊕",
    lunarHudConeRatio: "Cone/Moon dist",
    lunarRadialMagnifyLabel: "Radial magnify ×4",
    lunarRadialMagnifyAria: "Toggle radial magnification (display aid)",
    lunarRadialMagnifyBadge:
      "Earth, Moon, shadow cones and the cross-section disk are uniformly magnified ×4 in the transverse direction (axial distances unchanged) — every radial teaching ratio is preserved, and HUD numbers always show true values",
    lunarSectionDiskLabel: "Shadow cross-section at Moon distance",
    lunarSectionDiskAria: "Toggle shadow cross-section disk",
    lunarPresetAria: "Camera presets",
    lunarPresetOverview: "Full cone view",
    lunarPresetCloseup: "Moon close-up",
    lunarSpaceCard:
      "Space view notes: the shadow cone is axially true to scale — the umbral cone is about 1.4 million km long while the Moon orbits at about 384,000 km, so “the Moon only reaches 27% of the cone, where the umbra is about 2.6 Moon diameters wide” is shown at true proportions. The Sun's direction is real but its distance is compressed (the true 150 million km lies outside the scene); the translucent cones and cross-section disk are presentation aids — the real shadow is invisible.",
    lunarScaleCard:
      "Artistic mode: the Earth–Moon system, shadow cones and cross-section disk are enlarged by a single radial factor of about ×14.6 (derived from the main scene's logarithmic body-radius compression) — every radial teaching ratio is strictly preserved: the umbra at Moon distance stays about 2.6 Moon diameters and 0.72 Earth radii. Planets and the Sun use the same log-compressed radii as the solar-eclipse space view. Switch to “Real” for strict true scale (with an optional ×4 radial magnify). In the magnified modes the Moon-orbit ring is a circular guide through the Moon's current displayed position (its radius breathes slightly with the lateral offset); at true scale it is the true orbital circle.",
    lunarSyzygyAria: "Switch syzygy demo",
    lunarSyzygyFull: "Full moon (lunar eclipse)",
    lunarSyzygyNew: "New moon (solar eclipse)",
    lunarNodeCard:
      "The Moon's orbit is tilted 5.145° to the ecliptic — at most full moons the Moon passes above or below Earth's shadow; only when full moon coincides with a node crossing does the Moon enter the shadow and a lunar eclipse occur. Switch to “New moon” to see the shadow cone reverse direction: the Moon's shadow points at Earth — exactly the geometry of a solar eclipse. One inclination, two kinds of eclipses. The demo is schematic: orbit and node rhythms run on narrative time.",
    lunarCompareToggle: "Solar vs lunar eclipse comparison",
    lunarCompareColDim: "Aspect",
    lunarCompareColSolar: "Total solar eclipse",
    lunarCompareColLunar: "Total lunar eclipse",
    lunarCompareRow1Dim: "Who blocks whom",
    lunarCompareRow1Solar: "The Moon blocks the Sun",
    lunarCompareRow1Lunar: "Earth's shadow falls on the Moon",
    lunarCompareRow2Dim: "Moon phase",
    lunarCompareRow2Solar: "New moon",
    lunarCompareRow2Lunar: "Full moon",
    lunarCompareRow3Dim: "Visibility",
    lunarCompareRow3Solar: "A narrow 100–160 km track",
    lunarCompareRow3Lunar: "The entire night hemisphere",
    lunarCompareRow4Dim: "Duration",
    lunarCompareRow4Solar: "At most 7 min 32 s",
    lunarCompareRow4Lunar: "Totality up to ~107 min, whole event up to 236 min",
    lunarCompareRow5Dim: "Recurrence at one place",
    lunarCompareRow5Solar: "360–410 years",
    lunarCompareRow5Lunar: "Several times a year",
    lunarCompareRow6Dim: "Naked-eye safety",
    lunarCompareRow6Solar: "Safe only during totality",
    lunarCompareRow6Lunar: "Safe throughout, no protection needed",
    lunarCompareRow7Dim: "Contact points",
    lunarCompareRow7Solar: "5 (C1→C4 + maximum)",
    lunarCompareRow7Lunar: "7 (P1/U1/U2/max/U3/U4/P4)",
    lunarCompareRow8Dim: "Role of the shadow cone",
    lunarCompareRow8Solar: "The Moon's umbral tip barely reaches the ground",
    lunarCompareRow8Lunar:
      "Earth's cone (1.4M km) far exceeds the Moon's distance (384k km)",
    lunarCompareRow9Dim: "What lengthens it",
    lunarCompareRow9Solar: "Moon at perigee",
    lunarCompareRow9Lunar: "Moon at apogee",
    lunarCompareRow10Dim: "Signature visuals",
    lunarCompareRow10Solar: "Corona, chromosphere, prominences, Baily's beads, diamond ring",
    lunarCompareRow10Lunar: "Blood-moon red, radial umbral gradient, limb surge",
    lunarCompareRow11Dim: "Source of color",
    lunarCompareRow11Solar: "The corona (million-degree plasma glowing itself)",
    lunarCompareRow11Lunar: "Earth's atmosphere: refraction + Rayleigh scattering",
    lunarCompareRow12Dim: "Brightness rating",
    lunarCompareRow12Solar: "None (magnitude/duration)",
    lunarCompareRow12Lunar: "Danjon scale L = 0–4",
    lunarCompareRow13Dim: "Effort to observe",
    lunarCompareRow13Solar: "Long-distance chasing (umbraphile culture)",
    lunarCompareRow13Lunar: "Just look up",
    lunarCompareRow14Dim: "Type share",
    lunarCompareRow14Solar: "~60% of central eclipses are annular",
    lunarCompareRow14Lunar: "Penumbral 36.3% / partial 34.9% / total 28.8%",
    lunarCompareSummary:
      "A total solar eclipse is scarce, momentary and chased; a total lunar eclipse is generous, unhurried, and yours for a glance upward.",
    lunarHalfSarosCard:
      "The half-saros (sar) pairing: about 9 years 5.5 days after a solar eclipse comes a lunar eclipse of corresponding character (and vice versa) — a total or annular solar eclipse is followed, 9 years 5.5 days later, by a total lunar eclipse. They are mirror images of the same Sun–Earth–Moon geometry, the real cycle that links these two labs.",
    lunarLinkToSolar: "→ Visit the solar eclipse lab for the other half of this geometry",
    /** LE-M5 Moon view (§2.3; B8 registration surfaces in lunarMoonViewCard) */
    lunarViewMoon: "Moon",
    lunarHintMoonView:
      "Drag to look around the regolith and Earth · pinch to zoom in (up to ~×20) on that red ring on Earth's limb — the light that paints the Moon red",
    lunarMoonViewCard:
      "You are standing on the Moon's near side watching a solar eclipse by Earth: the Sun hides behind Earth, the night hemisphere goes pitch black, and only a ring of sunlight refracted through the atmosphere remains — the very light that crosses Earth's air, loses its short wavelengths, and lands at your feet: the source of the blood moon's red. Drag the turbidity slider: the ring deepens, and back in the ground view the blood moon deepens in sync. The ring is a mechanism-faithful artistic rendition (its width is exaggerated for visibility; no day-specific atmospheric data). Real-photo references: Surveyor 3 (1967) and Blue Ghost Mission 1 (2025) both captured this ring from the lunar surface.",
    lunarMoonGuideTip:
      "Where does the blood moon's red come from? Switch to the Moon view — standing on the lunar surface you'll see the ring of Earth's atmosphere that paints the Moon red.",
    lunarMoonGuideGo: "Go to Moon view",
    lunarMoonGuideDismissAria: "Dismiss the tip",
    /** LE-M5-3 selenelion easter egg (B9: real combination, Beijing 1992 + explicit 0.6° refraction lift) */
    lunarSelenelionCard:
      "Selenelion — the eclipsed Moon and the Sun visible at once on opposite horizons. Geometrically they sit exactly opposite during a lunar eclipse, so only atmospheric refraction lifting both above the horizon makes the pairing possible. Not a thought experiment: on the morning of 1992-12-10 in Beijing (this very eclipse), the totally eclipsed Moon was setting in the northwest while the Sun rose in the southeast.",
    lunarSelenelionEnter: "🌄 See it yourself →",
    lunarSelenelionTitle: "Selenelion · Beijing dawn, 1992-12-10",
    lunarSelenelionExit: "← Back to the lunar eclipse lab",
    lunarSelenelionTimeAria: "Selenelion time (UT 1992-12-09 23:10–23:45)",
    lunarSelenelionHudMoon: "Moon alt (geometric→apparent)",
    lunarSelenelionHudSun: "Sun alt (geometric→apparent)",
    lunarSelenelionHudLift: "Refraction lift",
    lunarSelenelionAimMoon: "Eclipsed Moon (NW)",
    lunarSelenelionAimSun: "Rising Sun (SE)",
    lunarSelenelionRefractionCard:
      "Atmospheric refraction lifts objects near the horizon by about 0.6° (true magnitude: ~34′ at the horizon) — the dashed circles mark the un-refracted geometric positions. Scrub to around UT 23:27: both the Moon and the Sun are geometrically below the horizon, yet you can see both at once — which is why a selenelion can only happen right at the horizon. The totally eclipsed Moon is extremely faint in dawn light (Danjon L=0 as actually rated in 1992); raise the exposure slider to spot it. The refraction lift here is a teaching simplification (constant 0.6° at the horizon, tapering to zero at 10° altitude).",
    lunarSelenelionHint:
      "Northwest: the eclipsed Moon setting · Southeast: the Sun rising — drag to sweep between the two horizons",
    /** LE-M6-1 soundscape (§5; B15: the subtle night-ambience shift is an artistic rendering) */
    lunarAudioEnable: "Lunar eclipse soundscape (sonification)",
    lunarAudioNote:
      "Soundscape note: a real lunar eclipse makes no sound of its own. The subtle shift in the night ambience (stylised insect chorus) as the eclipse deepens is an artistic rendering of the mood — deliberately kept faint, because a lunar eclipse has nothing like the abrupt hush reported at a total solar eclipse. The chimes at the seven contacts (P1/U1/U2/greatest/U3/U4/P4) are sonification by design: lightest for the penumbral contacts, brighter for the umbral ones.",
    /** LE-M6-1 cultural-history card (§3.3 kept clearly apart from the physics; B10 bell = cultural rendition) */
    lunarCultureTitle: "Cultural history: how people explained lunar eclipses",
    lunarCultureTag: "Historical records and mythology (not a scientific explanation)",
    lunarCultureItemCn:
      "China — “the celestial dog eats the Moon”: people believed a hound was swallowing it and drove the beast off with bells, drums, gongs and firecrackers. The Moon always came back, so the “remedy” was handed down for millennia. The Zhou dynasty already had a rite for “rescuing the Moon” (drums beaten at the altar, per the Rites of Zhou) — while the imperial astronomical bureau was simultaneously computing eclipse times with precision.",
    lunarCultureItemIndia:
      "India — Rahu drank the nectar of immortality and was beheaded by Vishnu after the Sun and Moon exposed him. His head lives on and chases them to swallow them; having no body, the Moon always reappears from the severed neck.",
    lunarCultureItemInca:
      "Inca — a jaguar was biting the Moon, the blood-red colour being the wound. People beat objects and made dogs bark, fearing the jaguar would turn on them once it finished with the Moon.",
    lunarCultureItemMeso:
      "Mesopotamia — an eclipse threatened the king, so the Babylonians installed a “substitute king” to absorb the omen. They also left centuries of continuous eclipse records: exactly the data that revealed the saros cycle.",
    lunarCultureItemNorse:
      "Norse — the wolf Hati chases the Moon; when he catches it there is an eclipse, and at Ragnarök he swallows it for good.",
    lunarCultureBellLabel: "Ring the bell to drive off the dog (one strike)",
    lunarCultureBellAria: "Play one cultural-rendition bell strike",
    lunarCultureBellNote:
      "The bell is a cultural rendition (registered as B10): one strike per click inside this card only — it never sounds on its own along the timeline, and is kept apart from the scientific soundscape above.",
    lunarCultureBellMuted:
      "Turn on sound in the panel's soundscape section first to hear the bell.",
    /** LE-M6 NGC 6629 occultation card (2029 tab only; §3.3) */
    lunarNgcCard:
      "Bonus feature (2029-06-26): during this eclipse the darkened Moon occults NGC 6629, a planetary nebula in Sagittarius (~10th magnitude, ~6,600 light-years away) — with the Moon almost fully dimmed, a nebula normally drowned in moonlight becomes recordable. This lab's star dome only draws the Yale Bright Star Catalogue (to ~6.5 mag), so this 10th-magnitude nebula is not among them: it appears as a science note only, not as an object in the scene.",
    /** LE-M6-2 reduced-quality tier note (§4) */
    lunarReducedNote:
      "Automatically stepped down for this device: bloom off, render resolution capped, and the Milky Way band / asteroid belt in the space view plus the shading detail of the Moon-view atmospheric ring simplified accordingly — all geometry and numbers are unchanged.",
  },
  helpHint: {
    controls:
      "🖱 Drag to rotate · Scroll to zoom · Right-drag to pan \u00a0|\u00a0 ⌨ 1-4 switch views · [ / ] tour previous/next body (per view domain: planet system / Solar System / galaxy / universe sequences) · G galactic-center view (in the galaxy view, look down on the Solar System riding its wavy orbit around the Galactic Center; press again to re-follow the Solar System) · V vertical expansion (galaxy view only; the whole galaxy morphs into an oblate spheroid: disk / supernovae / special objects spread out with gain, with height indicator lines) · Space pause · M audio · O orbit lines \u00a0|\u00a0 Click a planet for details",
    /** G3 help-panel science notes section title */
    disclaimerTitle: "Scientific accuracy & artistic license",
    disclaimer:
      "Star twinkling appears only in the planet view (stars do not twinkle in a vacuum; twinkling comes from atmospheric turbulence — an artistic touch); audio is an artistic design (space is silent), with planet ambient sound differentiated by each atmosphere (Mercury / dwarf planets are near-vacuum and almost silent); in default mode dwarf planets and artificial satellites are enlarged for recognizability — being invisible at real scale is a scientific fact honored by real-scale mode; in the galaxy view the wavy rise and fall of the Sun\u2019s vertical oscillation is visually amplified ×10 (true amplitude only ±300 ly; not amplified in real-scale mode); special-object heights are derived from true galactic latitude (SIMBAD) while horizontal distances are schematic, and vertical expansion (V) is a visual exaggeration to aid observation (indicator lines mark the unamplified derived height) — when enabled the whole disk morphs into an oblate spheroid (face-on / top-down outline stays circular and spiral arms remain readable from above; side-on arm patterns being vertically dispersed is an accepted trade-off), supernovae rise with the disk, the halo brightens, and the dust lane fades; Sun watching: fly to the Sun for a close view of granulation / sunspots / prominences, and select the Sun to open the interior cutaway — sunspot / prominence sizes and activity frequency are demo-amplified and flare duration is slowed for presentation (all registered), with chromosphere thickness exaggerated to +1.5%; universe view: satellite galaxies move along thin orbit lines (toggled with O), the Magellanic Stream / Sagittarius tidal stream are gas and stars stripped along historical paths (diffuse particle bands, not orbit lines), and the cosmic web staying static apart from Hubble-expansion scaling is expected; the large-scale background is the 2MASS Redshift Survey (2MRS) point cloud of ~43,000 real galaxies (ellipticals yellowish / spirals blue-white; the Virgo Cluster overdensity and the galactic-plane gap are real data — three registered distortions: redshift distances follow the Hubble-flow approximation with finger-of-god effects, nearby-distance errors, and the galactic obscuration band, the gap being a dust-obscuration observational limit rather than a true void), with the procedural cosmic web demoted to an ambience layer; the side-on galaxy view shows the outer-disk S-shaped HI warp (Levine et al. 2006; rim amplitude artistically amplified for side-on visibility) and the diffuse Fermi bubbles above and below the Galactic Center (Su et al. 2010; gamma-ray glow rendered in artistic violet/magenta, can be turned off in display options)",
    langNote:
      "Language 语言: use the zh/EN buttons on the top-left panel to switch the UI language instantly (UI, body labels, and descriptions all switch; data-source attributions keep their original language)",
    kioskNote:
      "H hides/shows the UI · Kiosk mode: start from the top-left panel (fullscreen auto tour; any input pauses, and it resumes after a short idle) or launch via a ?mode=kiosk link",
    /** M4-5 touch guide (isTouch branch: replaces the mouse/keyboard line) */
    controlsTouch:
      "Drag with one finger to rotate · pinch to zoom / two-finger pan · tap a body to select it",
    closeAria: "Dismiss the guide",
    reopenAria: "Reopen the controls guide",
  },
  tabBar: {
    help: "Help",
    helpAria: "Open the controls guide",
    controls: "Controls",
    controlsAria: "Open the control panel",
    contact: "Support",
    contactAria: "Open the support & partnership panel",
  },
  viewLevel: {
    L1: "Planet View",
    L2: "Solar System View",
    L3: "Galaxy View",
    L4: "Universe View",
  },
  scopeName: {
    system: "Planet tour",
    solar: "Solar System tour",
    galaxy: "Galaxy tour",
    universe: "Universe tour",
  },
  kiosk: {
    pausedBadge: "Kiosk mode (paused — resuming in {sec}s)",
    exit: "Exit",
    exitAria: "Exit kiosk mode",
    /** G2 one-time notice when a gated tour falls back (tour=galaxy/universe, no unlock) */
    gateFallback:
      "The galaxy / universe tours are supporter-exclusive; without an unlock the tour switches to the Solar System route",
    gateFallbackCloseAria: "Dismiss the tour route notice",
  },
  controlPanel: {
    title: "Stellar Odyssey",
    subtitle: "星海奥德赛",
    langAria: "Switch interface language",
    viewSection: "View (keys 1-4)",
    galacticFrameSection: "Galaxy-view reference frame (G)",
    galacticFrameTitle:
      "Galactic-center fixed: the center stays put while you look down on the Solar System riding its wavy orbit around it",
    galacticFrameOn:
      "Galactic center fixed (tap to re-follow the Solar System)",
    galacticFrameOff:
      "Fix on the Galactic Center (watch the Solar System orbit)",
    speedSection: "Simulation speed (Space to pause)",
    resume: "Resume",
    pause: "Pause",
    speedAria: "Simulation speed multiplier",
    audioSection:
      "Audio (M to mute; space is silent — sound is an artistic design)",
    audioOn: "On",
    audioOff: "Off",
    volumeAria: "Volume",
    displaySection: "Display",
    orbits: "Orbit lines (O)",
    bodyLabels: "Body labels (L)",
    satelliteOrbits: "Satellite orbit lines",
    youAreHere: "You-are-here marker",
    velocityVectors: "Velocity vector arrows",
    galaxyCatalog: "Real survey background (2MRS)",
    fermiBubbles: "Fermi bubbles",
    verticalExpand: "Vertical expansion (V)",
    expandGain: "Gain",
    expandGainAria: "Vertical expansion gain (1–6)",
    realScale: "Real-scale mode (true body sizes)",
    sunCutaway: "Sun interior cutaway (quarter-section view)",
    colorBoost: "Enhanced galaxy colors",
    colorBoostNote:
      "Boosts red-yellow / blue-white color contrast to make star and galaxy types easier to tell apart; when off, colors follow the real observed palette (weaker contrast, yellowish white)",
    bloom: "Bloom effect (can be disabled on low-end devices)",
    performance: "Performance monitor (FPS/memory)",
    kioskSection: "Kiosk mode",
    kioskStart: "Start kiosk mode (fullscreen auto tour)",
    kioskNote:
      "Flies stop to stop within the current tour domain; any input pauses, resuming after a short idle",
    demoSection: "Dynamic event demos",
    collapseAria: "Collapse the control panel",
    expandAria: "Expand the control panel",
    supernovaActive: "Supernova in progress…",
    supernovaTrigger: "Trigger supernova demo (random spot in a spiral arm)",
    flareActive: "Flare in progress ({cls}{mag})…",
    flareCutawayDisabled:
      "Trigger solar flare demo (unavailable in cutaway mode)",
    flareTrigger: "Trigger solar flare demo (random active region)",
    cmeActive: "CME in progress ({speed} km/s)…",
    cmeCutawayDisabled: "Trigger CME demo (unavailable in cutaway mode)",
    cmeTrigger: "Trigger coronal mass ejection (CME) demo",
    mergerActive: "Merger preview in progress…",
    mergerTrigger: "Preview the Milky Way–Andromeda collision",
    mergerRestore: "Restore pre-preview time",
    catalogNote:
      "{source}; registered distortions: {distortions}. Falls back to the procedural cosmic-web sketch when disabled or when data is unavailable",
    expandNote:
      "The whole galaxy morphs into an oblate spheroid with the gain (disk particles / supernovae rise with the disk, special-object heights spread out by the gain; a visual exaggeration to aid observation — indicator lines mark the unamplified latitude-derived heights)",
    realScaleNote:
      "At real scale, planets and dwarf planets are tiny (dwarf planets being invisible is a scientific fact); fly to or follow one for a close-up view",
    cutawayNote:
      "In the cutaway, the core / radiative zone / convective zone can be clicked for notes; external activity effects are temporarily faded out",
  },
  hud: {
    simTime: "Sim time: {value}",
    simEpoch: "(epoch {value})",
    immersiveEnter: "Maximize (collapse panels)",
    immersiveExit: "Exit maximized view",
    immersiveEnterNoFullscreen:
      "Collapse panels (fullscreen unsupported in this browser)",
    /** M4-3: touch-equivalent entry for the H shortcut (hide UI + restore badge) */
    uiHide: "Hide UI",
    uiShow: "Show UI",
    statusExpandAria: "Expand status details",
    statusCollapseAria: "Collapse status details",
    sheetDragAria: "Swipe down to close the panel",
    scale: "Scale: {value}",
    frameL1: "Frame: heliocentric (planet/moon motion)",
    frameL2: "Frame: heliocentric (ecliptic coordinates)",
    frameL3: "Frame: galactocentric (Solar System around the Galactic Center)",
    frameL4: "Frame: Local Group barycenter (peculiar motion shown as vectors)",
    frameHudCenter: "Frame: galactocentric (center fixed)",
    frameHudFollow: "Frame: galactocentric (following the Solar System)",
    galacticYear:
      "Galactic year: orbit {orbit}, {percent}% ({deg}° traveled) | disk height {sign}{height} ly",
    frameToggle: "Frame: {mode} (G to switch)",
    frameModeCenter: "center fixed",
    frameModeFollow: "following Solar System",
    rateClampSatellite:
      "Fast-orbit satellite motion slowed for display (anti-flicker)",
    rateClampPlanet: "Planet motion slowed for display (anti-flicker)",
    followMode: "Following: {name}",
    followCancel: "Cancel (Esc)",
    gTipPrefix: "Press",
    gTipMiddle: "to switch to the ",
    gTipHighlight: "galactic-center view",
    gTipSuffix:
      " and look down on the Solar System riding its wavy orbit around the Galactic Center",
    gTipCloseAria: "Dismiss galactic-center view tip",
    gTipNow: "Switch now (G)",
    mergerTitle: "Milky Way–Andromeda merger evolution",
    mergerCloseAria: "Close merger evolution card",
    mergerTau: " (~{myr} Myr after the merger moment)",
    snTitle: "Supernova!",
    snCloseAria: "Dismiss supernova notice",
    snBody:
      "Core-collapse supernova detected in a Milky Way spiral arm (progenitor ≈{mass} solar masses)",
    flyBtn: "Fly to watch",
    detailBtn: "Details",
    flareTitle: "Solar flare ({cls}{mag})!",
    flareCloseAria: "Dismiss flare notice",
    flareBody:
      "Magnetic-reconnection energy release in an active region (near a sunspot group)",
    flareCmeLinked: ", a coronal mass ejection (CME) is expected to follow",
    cmeTitle: "Coronal mass ejection (CME)! ~{speed} km/s",
    cmeCloseAria: "Dismiss CME notice",
    cmeBody:
      "A huge blob of plasma erupts from the corona, expanding away from the Sun as a shell",
    cmeEarthDirected: " — this ejection is headed for Earth!",
    cmeArrivalTitle: "CME has reached Earth!",
    cmeArrivalCloseAria: "Dismiss CME arrival notice",
    cmeArrivalBody:
      "The plasma cloud hits Earth\u2019s magnetosphere, driving a geomagnetic storm — enhanced aurorae light up the polar upper atmosphere (schematic).",
    flyEarthBtn: "Fly to Earth to watch",
    featureCloseAria: "Close feature card",
    sunspotEarthsPre: "This sunspot could hold about",
    sunspotEarthsPost: "Earths (by true, pre-magnification size)",
    layerCloseAria: "Close layer card",
    layerRange: "Extent",
    layerTemp: "Temperature",
    bodyTitle: "{nameEn}",
    dataSource: "Data source: {value}",
    infoCloseAria: "Close info panel",
    infoCollapseAria: "Collapse info panel content",
    infoExpandAria: "Expand info panel content",
    cutawayOn: "Close interior cutaway",
    cutawayOff: "View interior structure (quarter cutaway)",
    flyShort: "Fly to (F)",
    follow: "Follow",
    unfollow: "Unfollow",
    prevAria: "Previous body in sequence (key [)",
    prevTitle: "Previous ([)",
    nextAria: "Next body in sequence (key ])",
    nextTitle: "Next (])",
  },
  bodyCycle: {
    prev: "Prev",
    next: "Next",
    prevAria: "Previous body (key [)",
    nextAria: "Next body (key ])",
  },
  perfMonitor: {
    title: "Performance",
    fpsLabel: "FPS: {value}",
    memoryLabel: "Memory: {value}",
    measuring: "Measuring…",
    unavailable: "N/A",
    fpsFair: "{fps} FPS (fair)",
    fpsLow: "{fps} FPS (low)",
  },
  loading: {
    textures: "Loading textures",
    scene: "Loading the galaxy scene…",
  },
  audioNotice: {
    resumeFailed:
      'Audio could not start: the browser blocked playback. Tap the "Sound" toggle again to retry.',
    dismissAria: "Dismiss audio notice",
  },
  notFound: {
    title: "You have drifted beyond the known universe",
    body: "No celestial object can be observed at these coordinates — the page does not exist, or has been slingshotted elsewhere by gravity.",
    autoReturn: "Returning to the star map in {sec}s",
    returnNow: "Return to the star map now",
  },
  sceneLabel: {
    siriusA: "Sirius A · main sequence",
    siriusB: "Sirius B · white dwarf",
    youAreHere: "You are here (Solar System)",
    galacticYearPercent: "Galactic year {percent}%",
    oortCloud: "Oort Cloud outer edge (schematic; actually 2,000–100,000 AU)",
    terminationShock: "Termination shock (schematic, ~{au} AU)",
    heliosheath: "Heliosheath (transition region)",
    heliopause: "Heliopause (schematic; actually ~120 AU)",
    voyagerCrossedSuffix: " (crossed {year})",
    quasarSuffix: " (~2.4 billion ly)",
    antennaeSuffix: " (galaxy collision, ~45 million ly)",
    lensingArcs:
      "Cluster gravitational lensing arcs (schematic, prototype Abell 370)",
    grbSuffix: " (demo replay, ~2 billion ly)",
    localGroupMotion:
      "Local Group peculiar motion ~{v} km/s (toward the Great Attractor / Shapley, relative to the CMB)",
    observableEdge:
      "Observable-universe boundary (schematic, radius ~46.5 billion ly)",
    laniakeaBoundary:
      "Laniakea Supercluster boundary (schematic, ~520 million ly across)",
    greatAttractor: "Great Attractor",
    mergerCountdown:
      "Milky Way and Andromeda closing in (~110 km/s), colliding and merging in ~{gyr} billion years",
    mergerStage: "Milky Way–Andromeda merger: {stage}",
  },
  catalogText: {
    // ── Info-panel labels ────────────────────────────────────────────
    主旋臂: "Major spiral arms",
    事件视界: "Event horizon",
    伴星: "Companion star",
    位置: "Location",
    光变周期: "Pulsation period",
    光度: "Luminosity",
    光弧: "Lensed arcs",
    公转周期: "Orbital period",
    共振: "Resonance",
    内缘: "Inner edge",
    内部: "Interior",
    冲击波: "Shock wave",
    前身星: "Progenitor",
    剪影: "Silhouette",
    动态效果: "Dynamics",
    半径: "Radius",
    历史: "History",
    原型: "Prototype",
    原理: "Principle",
    反射星云: "Reflection nebula",
    发射: "Launch",
    吸积盘: "Accretion disk",
    周围星云: "Surrounding nebula",
    喷流: "Jet",
    备注: "Notes",
    外缘: "Outer edge",
    天狼星A: "Sirius A",
    天狼星B: "Sirius B",
    太阳风: "Solar wind",
    定义: "Definition",
    室女座团: "Virgo Cluster",
    尺度: "Scale",
    尺度对比: "Scale comparison",
    年龄: "Age",
    "当前 CME": "Current CME",
    当前活动: "Current activity",
    当前耀斑: "Current flare",
    形态: "Shape",
    形状: "Shape",
    成员: "Members",
    探测: "Exploration",
    描述: "Description",
    携带: "Payload",
    日冕洞: "Coronal holes",
    日冕温度: "Coronal temperature",
    星暴: "Starburst",
    星风速度: "Stellar wind speed",
    本质: "Nature",
    标志结构: "Landmark structure",
    活动周期: "Activity cycle",
    演示说明: "Demo note",
    潮汐锁定: "Tidally locked",
    球状星团: "Globular clusters",
    盘厚度: "Disk thickness",
    直径: "Diameter",
    真实特征尺寸: "True feature size",
    真实距离: "True distance",
    示意说明: "Schematic note",
    离心率: "Eccentricity",
    科学性说明: "Science note",
    穿越日球层顶: "Heliopause crossing",
    组成: "Composition",
    结局: "Fate",
    结构: "Structure",
    结构分层: "Layered structure",
    膨胀速度: "Expansion speed",
    自转周期: "Rotation period",
    表面温度: "Surface temperature",
    视向速度: "Radial velocity",
    视星等变化: "Magnitude range",
    触须: "Antennae",
    质量: "Mass",
    距离: "Distance",
    轨道倾角: "Inclination",
    轨道半长轴: "Semi-major axis",
    轨道周期: "Orbital period",
    轴倾角: "Axial tilt",
    较差自转: "Differential rotation",
    "运动（模拟）": "Motion (simulated)",
    近日点距离: "Perihelion distance",
    进程: "Progress",
    远日点距离: "Aphelion distance",
    遗迹: "Remnant",
    量天尺: "Standard candle",
    银心: "Galactic center",
    阶段: "Phases",
    颜色: "Color",
    黑子: "Sunspots",
    // ── Body type line (typeZh) ─────────────────────────────────────
    恒星: "Star",
    行星: "Planet",
    矮行星: "Dwarf planet",
    卫星: "Moon",
    人造卫星: "Artificial satellite",
    彗星: "Comet",
    太阳系外围结构: "Outer Solar System structure",
    "星际探测器（日球层顶穿越标记）":
      "Interstellar probe (heliopause crossing marker)",
    旋涡星系: "Spiral galaxy",
    棒旋星系: "Barred spiral galaxy",
    椭圆星系: "Elliptical galaxy",
    不规则星系: "Irregular galaxy",
    "动态事件（核坍缩超新星）": "Dynamic event (core-collapse supernova)",
    "红巨星（红超巨星）": "Red supergiant",
    蓝超巨星: "Blue supergiant",
    "双星系统（主序星 + 白矮星）":
      "Binary system (main-sequence star + white dwarf)",
    "中子星/脉冲星（超新星遗迹中心）":
      "Neutron star / pulsar (at the supernova remnant center)",
    "超大质量黑洞（银心）": "Supermassive black hole (Galactic Center)",
    发射星云: "Emission nebula",
    行星状星云: "Planetary nebula",
    "球状星团（银晕）": "Globular cluster (galactic halo)",
    "恒星级黑洞（X射线双星）": "Stellar-mass black hole (X-ray binary)",
    "沃尔夫-拉叶星（大质量恒星晚期）":
      "Wolf–Rayet star (late-stage massive star)",
    "造父变星（脉动变星）": "Cepheid variable (pulsating star)",
    疏散星团: "Open cluster",
    "暗星云（分子云剪影）": "Dark nebula (molecular cloud silhouette)",
    "类星体（活动星系核）": "Quasar (active galactic nucleus)",
    "星系碰撞现场（并合中的旋涡星系对）":
      "Galaxy collision (merging spiral pair)",
    "星系团引力透镜（背景星系光弧）":
      "Cluster gravitational lens (background galaxy arcs)",
    "伽马射线暴（长暴）": "Gamma-ray burst (long)",
  },
};
