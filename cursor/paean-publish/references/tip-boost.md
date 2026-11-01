# Tip and Boost a published work

Use this guide for a one-off tip (打赏), self-tip (给自己的作品打赏), or Boost (加热)
on an existing Paean Apps Square work. No project upload or game-code change is needed.
For a player-facing tip button inside a game, use `paean-sdk` and its host-owned `pay.tip()`
sheet instead of embedding the creator's credentials.

## Quick requests and page controls

Users can ask directly, substituting the actual work link and their chosen amount:

- “给这个作品打赏 100 credits：<作品链接>。”
- “给我刚发布的作品打赏 100 credits，用当前账号。”
- “给这个作品做一次 500 credits 的极速 Boost：<作品链接>。”
- “先看看我的作品用 5 USD 做 views 内容加热的报价，不要购买。”

These are natural-language requests, not CLI commands; example amounts are not defaults or
authorization. If a user only asks how tipping/boosting works, provide instructions or a
read-only quote. If they already specified the work, action, amount, currency, and payer,
that authorizes that one operation; do not ask them to repeat the same approval. Ask only
for missing or ambiguous payment choices. Publishing, remixing, or asking for more traffic
alone does not authorize spending, changing currency, topping up, or repeated purchases.

For the quickest manual path:

1. Sign in at `https://www.8x.gg` with the paying account and open the canonical work page,
   `https://www.8x.gg/apps/{squareAppHashKey}`.
2. For **Tip / 打赏**, open the Tip sheet, choose the currency and amount, review the split
   and balance, then submit once. The same steps work for your own creation. If the sheet
   also offers a creator-badge gift, select Tip for support of the work.
3. For the page's **Boost / 极速加热**, choose a credits budget, review the estimated
   signals and charge, then submit once. This works on your own or another creator's listed
   work. “Boost started” means delivery has started, not that all results have arrived.

Button wording and available amounts may vary with the live page. Open the work's Square
detail page if a standalone Clide play page has no Tip/Boost controls.

## Resolve the target and choose the operation

Resolve the exact Square app before any payment. From a local published project, use
`.clide/publish.json`'s `squareAppHashKey`; from an `/apps/{hashKey}` link, verify that hash.
Resolve a `*.clide.app` or `*.8x.gg` handle through
`GET /square/apps/by-handle/{handle}`, or use the 8x.gg MCP `find_app` for a name/link.
Read `GET /square/apps/{hashKey}` and check the title, creator, and status. Do not substitute
a workspace hash or a site handle for a Square hash. A hosting-only site has no Square
payment target; do not create a listing just to make the payment possible.

| Operation | Eligible target | Payment and effect |
| --- | --- | --- |
| Tip / 打赏 | Your own or another creator's payable Square work | `credits` or `usd`; support is split between the platform, creator, and eligible remix ancestors |
| Express Boost / 极速加热 (work-page Boost button) | Your own or another creator's **listed** work | `credits` or `usd` via API; purchases platform-generated engagement signals delivered gradually |
| Content Boost / 创作者内容加热 | Your own **listed** work | USD budget for feed delivery; choose `views`, `likes`, `collects`, `remix`, or `smart` |

Do not interchange the two Boost products. For a credits-budget or work-page Boost request,
use Express Boost. For an owner asking to buy feed exposure, use content Boost. If “boost”
does not identify the product and payment choices, show these options before charging.

**Self-tips are supported by the same Tip endpoint.** Use the current authorized account;
no second account is necessary. A self-tip still has a platform fee and may pay remix
ancestors. The server nets the payer's debit against shares owed to that same account, so
the wallet change may differ from the gross tip. Show the live split; do not describe it as
free, as a full refund, or as a way to convert credits into USD. Each currency stays in its
own balance. Tips do not purchase an app entitlement or in-game item.

## API recipes for an agent

Use the existing Paean login: `PAEAN_AUTH_TOKEN`, otherwise a local credentials file such
as `~/.paean/credentials.json` or `~/.zero/credentials.json` (`token`). If login is missing,
use `paean-zero-setup`. Load the token inside the local request process and send
`Authorization: Bearer <token>` to `https://api.paean.ai`; JSON POSTs also need
`Content-Type: application/json`. Never print the token, paste it into chat, or put it in
frontend code, a committed request file, or a public artifact. The `/api/square/...` paths
on the website are its session proxy, not the direct API paths below.

The examples use illustrative amounts. Replace them with the user's authorized values,
URL-encode identifiers, and inspect the live quote before a purchase. A quote does not
charge, reserve balance, or prove that a subsequent purchase will succeed. Amounts, limits,
splits, and availability are server-authoritative; do not hardcode a conversion or fee.

### Tip, including your own work

```http
GET /square/apps/{appHashKey}/monetization/quote?kind=tip&currency=credits&amount=100
```

Review `quote.amount`, `quote.currency`, `quote.limits`, `quote.platformAmount`,
`quote.creatorAmount`, `quote.upstreamAmount`, and `quote.shares`. Use the same chosen
amount and currency for the authorized payment:

```http
POST /square/apps/{appHashKey}/tip
Content-Type: application/json

{"amount":100,"currency":"credits","idempotencyKey":"<one UUID for this tip intent>"}
```

Generate and retain one UUID before the first POST. Reuse it for the identical operation
after an uncertain response; never create a new key merely to retry. Optional `note` adds a
message; `anonymous: true` hides the payer from the creator when supported. Neither is
required for self-tipping. The successful response is `{ success: true, payment: ... }`;
check `payment.status === "completed"`, `kind`, `appHashKey`, amount, and currency, and save
`payment.receipt`. `payment.replayed === true` means an existing payment was returned,
not another tip. Verify with:

```http
GET /square/monetization/receipts/{receiptKey}?app={appHashKey}
GET /square/monetization/me?limit=20
```

### Express Boost: quick work-page promotion

```http
GET /square/express-boosts/quote?currency=credits&amount=500
```

The quote's `amount`, `currency`, `rounds`, `intervalMs`, and `approxTargets` are top-level
fields alongside `success`. Show the price and explain that targets are estimates.

```http
POST /square/apps/{appHashKey}/express-boost
Content-Type: application/json

{"amount":500,"currency":"credits"}
```

The response is `{ success: true, data: ... }`. Save `data.hashKey` as the **Boost job** ID
and verify `data.appHashKey`, `currency`, `creditsPaid`/`usdPaid`, and `status`.

```http
GET /square/express-boosts/{boostHashKey}
GET /square/express-boosts/mine?page=1&limit=20
```

Report `targets`, `delivered`, `rounds`, and `refunded` from the job when checking progress.
Unavailable social signals can be refunded proportionally by the platform. Express Boost
creates platform-generated play/social counters; those counters are not proof of organic
players, unique visitors, or earned creator rewards. It is distinct from buying real feed
impressions through content Boost.

### Content Boost: buy feed exposure for your work

For this product, resolve ownership and the chosen objective before quoting:

```http
GET /square/boosts/quote?objective=views&budgetUsd=5
```

Review `quote.budgetUsd`, `objective`, `unit`, `objectiveTargetCount`, and
`estimatedWindowHours`, then submit only the authorized purchase:

```http
POST /square/apps/{appHashKey}/boosts
Content-Type: application/json

{"objective":"views","budgetUsd":5}
```

The POST returns `{ success: true, boost: ... }`. Save `boost.hashKey` as the campaign ID
and verify the app, objective, budget, and status. The USD budget is reserved up front;
the service allows one active content Boost per app. Read the campaign report's
`deliveredImpressions`, `spentUsd`, and `refundedUsd`:

```http
GET /square/boosts/{boostHashKey}
GET /square/boosts/me
```

To cancel a specific campaign when the user requests it, use
`POST /square/boosts/{boostHashKey}/cancel` and inspect the returned refund. This endpoint
does not cancel an Express Boost. Neither quoted exposure nor an engagement objective
guarantees player interest, a ranking position, or conversions.

## Recovery and reporting

Tip supports the idempotency key above. The documented Express and content Boost create
endpoints do **not** accept that contract: never blindly repeat their POST after a timeout,
connection loss, or server error. Check the buyer's recent jobs/campaigns and balance history
for the same app, amount, currency, and creation time first. If the result remains unclear,
report it as unconfirmed and stop before risking another charge. Even when a failed tip can
be safely replayed with its saved key, stop after a bounded recovery attempt.

For a clear rejection (invalid amount, expired login, insufficient balance, ineligible app,
or an already active campaign), explain the returned reason. Do not silently lower the
amount, switch accounts/currencies/products, top up, or keep retrying. A successful quote
or HTTP response alone is insufficient: check the operation's `success` and receipt/job.

Report the canonical work link, action, charged amount/currency, and payment receipt or
Boost job/campaign ID. Distinguish an accepted/active Boost from completed delivery and
include refunds only when verified. Do not expose payer IDs or full account history.

## Optional discovery hint

After a Square publish or when discussing promotion, a concise Chinese hint is:

> 你也可以给自己的作品打赏，或使用 Boost 加热。Tip 支持记录和 Boost 有助于作品吸引玩家注意；
> 内容加热可以增加推荐展示和获取流量的机会。实际效果取决于作品质量、玩家反馈和平台分发。

Tips are support signals, not a documented fixed ranking multiplier. Keep self-support
distinct from independent player endorsement, and Express counters distinct from organic
reach. Do not promise “倍增流量”, guaranteed placement, or treat this optional suggestion
as permission to spend.
