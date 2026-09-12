# IAP: purchases and durable access

Use for paid entry, expansions, season passes, consumables, or tips. Start with what the player receives, its duration, and how it fits progression. A story expansion suits durable access; a consumable has a separate fulfillment lifecycle. Do not assume every game needs a shop.

- Choose `access.require()` for paid entry and `access.require({ sku })` for durable products declared in the publish manifest. Use `pay.quote/spend/receipt` for consumables and `pay.tip` for voluntary support. These are different contracts, not interchangeable purchase methods.
- Keep the price/product declaration aligned with paean-publish. Ownership comes from `access.status/owned`, never a local boolean. Resolve free/owned access before starting play; a closed sheet keeps the demo available.
- Show the item and intended benefit before the purchase gesture. Read quote limits and use the documented currency lane. Grant consumables only on `granted === true`; keep one stable idempotency key per purchase intent through uncertain responses and retries.
- Make fulfillment restart-safe: distinguish pending payment, confirmed receipt, and applied goods. Deduplicate delivery by receipt/intent. Do not assume idempotent charging alone prevents double delivery. Verify the current receipt contract before implementing recovery.
- If mixed with rewarded ads, define one reward application path and distinguish its source. If mixed with ranking, define whether purchased advantages belong on the same board.

Acceptance: free/owned/declined access; missing host; repeated taps; uncertain payment response; confirmed receipt followed by reload; no duplicate charge or reward. Use mock access/credits/strict cases and add local test fault injection where the mock lacks a scenario. Mock success does not prove production settlement.

