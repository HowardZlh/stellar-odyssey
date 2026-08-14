# Supporter Unlock

> 中文原版 / Chinese original: [../unlock-guide.md](../unlock-guide.md)

> Some advanced content is available as a **time-limited supporter unlock**: pay the tier amount,
> redeem with your proof of payment, and access reverts to the free experience upon expiry.
> This is a clearly priced purchase, entirely separate from the voluntary "Fuel the Voyage"
> sponsorship (which comes with no rewards) — neither is a condition for the other. The project
> source code remains open source. Purchase and redemption both happen at
> [stellar.guushu.com/unlock](https://stellar.guushu.com/unlock).

## What is unlocked (the free experience stays intact)

**The free experience is unchanged**: everything in the Planet / Solar System views (L1/L2),
the heliopause close-up, ambient auto-triggered solar events, far views plus all info-panel
science notes in the Galaxy / Universe views (L3/L4), audio, and the bilingual UI — none of it
requires unlocking.

Unlocking adds four kinds of access (identical across tiers; only duration differs):

| Content | Free experience | Unlocked |
|---|---|---|
| **Close-view detail layers** (stellar surfaces / volumetric nebulae / black-hole gravitational lensing / close views of clusters, galaxies and extragalactic objects — 24 in total) | Visible from afar; detail layers lock when zooming in | All open |
| **L3/L4 tour sequences** (`[` / `]` stop-by-stop touring in the galaxy/universe views, including kiosk mode) | Locked (L1/L2 tours unrestricted) | All open |
| **Manual event demos** (flares / CMEs / supernovae / merger preview) | 5 per day shared (resets each calendar day; ambient auto-triggered events don't count) | Unlimited |
| **Astronomy Lab · Body Observatory** ([/lab/observatory](https://stellar.guushu.com/lab/observatory), an interactive observing field of all 23 close-up detail rigs) | 10 observations per day shared (of which 7 popular targets — black-hole lensing, M87, Betelgeuse, etc. — share 3 daily trials that also count against the total; unlimited during the launch free-access window) | Unlimited |

## Tiers & pricing

| Tier | Price | Reference ($, Ko-fi) | Duration |
|---|---|---|---|
| Week Pass | ¥6 | $1 | 7 days |
| Month Pass | ¥15 | $2.5 | 31 days (multi-month subscriptions stack by month count) |
| Year Pass | ¥88 | $13 | 366 days |

- For automatic Afdian redemption, access starts **from the order time** (not the redeem time);
  manual channels start from issuance.
- Access does **not auto-renew** upon expiry — no hidden charges of any kind.

## Purchase & redeem (three channels)

### Channel 1: Afdian (automatic, recommended)

1. Open the [unlock page](https://stellar.guushu.com/unlock) and click "Buy on Afdian" — purchase
   at the tier amount (Week/Year Pass are **products**; Month Pass is a **subscription plan**).
2. After paying, copy your **order number**: in the Afdian app or website, go to
   "My → Orders", find the order, and copy its number (14–40 digits).
3. Back on the unlock page, paste the order number into the "Afdian order number" field and click
   "Redeem" — access activates instantly, showing your tier, expiry date, and remaining days.

> The same order number can be **redeemed repeatedly**: it always returns the same token issued the
> first time (durations do not stack) — if you lose your token, just redeem the order number again.

### Channel 2: WeChat tip code (manual)

1. Expand the WeChat tip code on the unlock page and pay the selected **tier amount**.
2. Send a redeem email to [stevenzearo@163.com](mailto:stevenzearo@163.com) with a **payment
   screenshot** and the **transaction time**.
3. You will usually receive a reply within 48 hours containing your unlock token and a direct
   activation link — activate as described under "Using your token" below.

### Channel 3: Ko-fi (manual)

1. Go to [ko-fi.com/howardzlh](https://ko-fi.com/howardzlh) and pay the tier's **$ amount**
   (week $1 / month $2.5 / year $13).
2. Same as channel 2: email your payment receipt and transaction time; the token comes by reply.

## Using your token & switching devices

Your unlock credential is a three-segment string starting with `SO1.` (a time-limited signed token):

- **Activation**: successful redemption activates automatically; tokens from manual-channel replies
  are pasted under "Already have a token? Activate here" on the unlock page, then click "Activate";
  or simply open the direct link from the reply, `https://stellar.guushu.com/unlock?token=…`
  (opening it activates immediately).
- **Persistence**: once activated, the token is stored in this browser (localStorage) — it survives
  refreshes and restarts, and day-to-day browsing performs zero network checks.
- **Switching devices / browsers**: on the activated device, click "**Copy my token**" on the unlock
  page, then paste and activate on the new device's unlock page (the same token works on multiple
  devices); the `?token=` direct link works too.
- **Keep your token safe**: save the token text yourself. Recovery: Afdian orders return the same
  token when redeemed again with the order number; manual-channel tokens can be recovered by email
  using your redemption correspondence.

## Expiry & renewal

- Upon expiry, the app reverts to the free experience automatically (close-view detail layers and
  L3/L4 tours lock again; demos and the Body Observatory return to their daily quotas). There is
  **no auto-renewal**.
- Renewing = purchase any tier again and redeem; activating the new token replaces the old one.
  Token durations do **not stack**.

## Refund policy

- **Unredeemed** orders: email [stevenzearo@163.com](mailto:stevenzearo@163.com) to request a refund
  to the original payment method.
- **Redeemed** orders: non-refundable.
- No invoices are provided.

## FAQ

**Q: Where do I find my Afdian order number?**
Log in to the Afdian app or website, go to "My → Orders", find the order, and copy its number
(14–40 digits). The unlock page input accepts digits only — avoid pasting extra characters.

**Q: Redeem error reference**

| Message on the page | Meaning & what to do |
|---|---|
| The order number should be 14-40 digits | Wrong input format — re-copy it in full from Afdian "My Orders" |
| Invalid order number | Afdian cannot find this order — make sure you copied the **order number** with no missing characters |
| The order has not been paid | Payment hasn't completed — pay first, then redeem |
| The order amount is below the lowest tier (¥6) | The paid amount is below the Week Pass price — pay the tier amount with a new order |
| The item in this order is not eligible for unlock redemption | The order is not for an unlock tier item — only orders for the Stellar Odyssey Week/Month/Year Pass items/plans can be redeemed; please retry with an unlock tier order |
| This order has already been redeemed | Idempotency guard: if switching devices, activate with your original token (redeeming again returns the same token — just paste the order number once more to retrieve it) |
| The order-lookup service is temporarily unavailable | Upstream (Afdian) API hiccup — retry later |
| The redeem service is not yet live | Server side not fully configured — come back later or contact us by email |
| Network request failed | Local network issue — check your connection and retry |

**Q: Token paste errors?**

| Message | What to do |
|---|---|
| Malformed token | Make sure you copied it in full: starts with `SO1.`, three segments, no line breaks or truncation |
| Token signature verification failed | The token content was modified — re-copy it in full from the source (copy button / reply email / direct link) |
| This token has expired | Access has ended — purchase any tier to renew |

**Q: What does "Clear access" do? Does it refund?**
"Clear access" on the unlock page only removes the activated token from this browser (e.g., tidying
up before leaving a shared computer). It has nothing to do with refunds; paste your token again to
restore access.

**Q: Is unlocking the same as sponsoring?**
No. Unlocking is a clearly priced, time-limited purchase (pay ¥X, get Y days); sponsorship
([/donate](https://stellar.guushu.com/donate)) is voluntary support with no rewards. The two are
entirely independent — sponsoring does not grant unlocks, and unlock purchases are not listed on the
donor roster.
