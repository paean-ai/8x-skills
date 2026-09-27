# IAP: purchases and durable access

Use for paid entry, expansions, season passes, consumables, or tips. Start with what the player receives, its duration, and how it fits progression. A story expansion suits durable access; a consumable has a separate fulfillment lifecycle. Do not assume every game needs a shop.

- Choose `access.require()` for paid entry and `access.require({ sku })` for durable products declared in the publish manifest. Use `pay.quote/spend/receipt` for consumables and `pay.tip` for voluntary support. These are different contracts, not interchangeable purchase methods.
- Keep the price/product declaration aligned with paean-publish. Ownership comes from `access.status/owned`, never a local boolean. Resolve free/owned access before starting play; a closed sheet keeps the demo available.
- Show the item and intended benefit before the purchase gesture. Read quote limits and use the documented currency lane. Grant consumables only on `granted === true`; keep one stable idempotency key per purchase intent through uncertain responses and retries.
- Make fulfillment restart-safe: distinguish pending payment, confirmed receipt, and applied goods. Deduplicate delivery by receipt/intent. Do not assume idempotent charging alone prevents double delivery. Verify the current receipt contract before implementing recovery.
- If mixed with rewarded ads, define one reward application path and distinguish its source. If mixed with ranking, define whether purchased advantages belong on the same board.

Acceptance: free/owned/declined access; missing host; repeated taps; uncertain payment response; confirmed receipt followed by reload; no duplicate charge or reward. Use mock access/credits/strict cases and add local test fault injection where the mock lacks a scenario. Mock success does not prove production settlement.

## Catalogue registration and live checks

Durable IAP has two separate steps: implement the SDK call, then register the
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
host's confirmation sheet using the server-listed title and price. Do not swap
to `pay.spend`, invent local ownership, or enable a fake purchase button to work
around an empty catalogue.

Before reporting availability after an authorized publication, compare every
intended SKU/title/amount/currency with a fresh hosted status. A mock whose
products came from the local manifest cannot verify this. Test the confirmation
flow as a viewer who is neither the publisher nor an owner of that SKU; both can
bypass payment UI. A confirmation sheet test need not settle a purchase; do not
spend real credits without authorization.
When publication is deferred, report "integration ready; catalogue not activated"
and hand off the exact access declaration instead of reporting the items as live.
