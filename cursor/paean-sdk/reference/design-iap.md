# IAP: purchases and durable access

Use for paid entry, expansions, season passes, consumables, or tips. Start with what the player receives, its duration, and how it fits progression. A story expansion suits durable access; a consumable has a separate fulfillment lifecycle. Do not assume every game needs a shop.

- Choose `access.require()` for paid entry. For in-app goods, select platform-managed `access.require({ sku })` or app-managed `pay.quote/spend/receipt` using the comparison below. Direct spend supports app-defined cosmetics as well as consumables. Use `pay.tip` for voluntary support; it is not an item checkout.
- Keep prices aligned with the chosen catalogue. Ownership comes from `access.status/owned` for platform products or verified receipts for app-managed goods, never a local boolean. Resolve free/owned entry access before starting play; a closed sheet keeps the demo available.
- Show the item and intended benefit before the purchase gesture. Read quote limits and use the documented currency lane. Grant consumables only on `granted === true`; keep one stable idempotency key per purchase intent through uncertain responses and retries.
- Make fulfillment restart-safe: distinguish pending payment, confirmed receipt, and applied goods. Deduplicate delivery by receipt/intent. Do not assume idempotent charging alone prevents double delivery. Verify the current receipt contract before implementing recovery.
- If mixed with rewarded ads, define one reward application path and distinguish its source. If mixed with ranking, define whether purchased advantages belong on the same board.

Acceptance: free/owned/declined access; missing host; repeated taps; uncertain payment response; confirmed receipt followed by reload; no duplicate charge or reward. Use mock access/credits/strict cases and add local test fault injection where the mock lacks a scenario. Mock success does not prove production settlement.

## Choose the ownership contract

| | Platform-managed products | App-managed credits spend |
| --- | --- | --- |
| Checkout | `access.require({ sku })` | `auth.ensure(['pay.spend'])`, then `pay.quote/spend` |
| Price source | Registered listing `access.products` | App-defined catalogue; validate with the host quote |
| Permission | No spend scope; host owns confirmation | `pay.spend`; host still confirms each charge |
| Permanent ownership | Platform records the durable entitlement | App persists and verifies receipts and fulfills the item |
| Empty `access.products` | Matching SKU is unavailable | Does not disable direct-spend purchases |

Prefer platform-managed products when automatic durable ownership fits the work
and its publisher can register the catalogue. Direct spend is also a supported
choice for permanent cosmetics when the app implements account-bound recovery.
Do not describe all skin IAP as requiring catalogue registration, or describe
`pay.spend` as restricted to consumables. A missing SKU establishes a catalogue
problem for the access contract; it does not prove that the SDK method is broken.

### Direct-spend checkout and restoration

- Keep an explicit SKU/title/credits catalogue in the app. Request `pay.spend`
  on Buy; request any `storage.kv` / `account.profile` scopes needed for recovery
  on Buy or Restore. Check actual grants, including partial-denial outcomes.
  Opening the shop or playing its demo must not prompt for payment permission.
- Read `pay.quote({ amount, currency: 'credits' })` and its `limits` before
  spending. Only the host confirmation can authorize the actual charge. Grant
  goods only after `granted === true`; a dismissal changes no ownership.
- Persist the purchase intent before spending and reuse its `idempotencyKey`
  across uncertain responses and reloads. For a one-time permanent SKU, an
  app/user-scoped stable key can also prevent duplicate settlement across devices;
  verify the host's idempotency scope and replay contract. Never generate a new
  key simply because a reply was lost, or reuse one for a new consumable intent.
- Store receipt identifiers in account-bound cloud storage, preferably separate
  per-SKU records to avoid overwriting concurrent purchases. Local storage may
  keep an account-keyed recovery copy; neither it nor a writable cloud boolean
  proves ownership. Clear cached entitlements when the signed-in account changes.
- Restore by loading the account's receipt records and calling `pay.receipt(id)`.
  Verify the actual current receipt shape: the current SDK/8x host returns
  `status: 'completed'`, `kind`, `appHashKey`, `sku`, `amount`, and `currency`,
  not a documented `valid` boolean. Check the matching completed spend and item.
  Keep uncertain failures recoverable; do not grant unverified receipts.
- Calling `pay.receipt` only for IDs left in localStorage cannot restore after
  local data is cleared. A paid receipt followed by a failed cloud write needs
  retained recovery data and an explicit retry. Restore must not silently charge;
  an unresolved intent may require another user-confirmed attempt with the same key.

Test an empty platform catalogue, permission denial, host cancellation, quote
limits, insufficient balance, rapid taps, a lost response after settlement,
cloud-write failure, cleared local storage, account changes, and receipt mismatch.
Mock success proves the integration contract, not production settlement. Label
the tested environment and report separately whether real host confirmation and
post-payment restoration have been verified.

## Catalogue registration and live checks

For **platform-managed `access.require({ sku })` products**, implement the SDK
call, then register the
catalogue in the existing Square listing through the authorized publishing flow.
Writing or uploading `clide.json` does not itself perform the second step.
The publisher supplies `access` in the Square publish/update request; see
`paean-publish`. A hosting-only upload cannot activate products. Runtime app code
must not call publisher APIs or carry credentials to register its own catalogue.

Distinguish the three data sources:

| Source | Meaning |
| --- | --- |
| Local `clide.json` → `access.products` | Intended publisher configuration; not evidence of registration |
| Hosted `/paean-app.json` → `access.products` | Platform-generated listing metadata for standalone policy; may briefly be cached |
| Hosted `PaeanSDK.access.status()` → `products` | Helper-normalized live catalogue and viewer ownership; raw bridge/API data nests the catalogue under `access.products` |

For a missing Buy button, inspect `PaeanSDK.VERSION`, `status.hosted`,
`status.reason`, and the returned SKU list. Distinguish a missing host, a failed
status read, a successful response without the SKU, and an already-owned SKU.
Only the successful missing-SKU case should say "Not on sale yet". A version
above the documented baseline does not register products automatically.

For a free game with permanent skins, use `model: "free"` with paid entries in
`products`. No `pay.spend` grant is needed: `access.require({sku})` opens the
host's confirmation sheet using the server-listed title and price. Do not invent
ownership or enable a nonfunctional purchase button around an empty catalogue.
A deliberate migration to direct spend is possible: implement its permission,
pricing, receipt persistence and restoration contract, preserve existing durable
owners, and test it. Do not silently switch payment mechanisms on a status failure.

Before reporting availability after an authorized publication, compare every
intended SKU/title/amount/currency with a fresh hosted status. A mock whose
products came from the local manifest cannot verify this. Test the confirmation
flow as a viewer who is neither the publisher nor an owner of that SKU; both can
bypass payment UI. A confirmation sheet test need not settle a purchase; do not
spend real credits without authorization.
When publication is deferred, report "integration ready; catalogue not activated"
and hand off the exact access declaration instead of reporting the items as live.
