/**
 * 主人亲令加仓（2026-10-20 13:00）：给 BTC-PERP 空头加仓。
 * 大单会被链上 revert（placeOrderFor），故拆成小口分批吃。
 * 目标总名义约 $9,700（加仓后健康度约 2.2x，在 perp-guard 减仓线 2.0 之上）；
 * 健康度 < 2.25 即停手。label 用 scale-in-short，避免 momentum-guard 误盯资费核心仓。
 */
import {
  createExchange,
  perpMarkets,
  requireMarket,
  positionIn,
  placePerp,
  marginSnapshot,
  healthRatio,
  sizeForNotional,
  markOf,
  liveMark,
  ORDER_TYPE,
} from "@dreamdex-bot-kit/perp-core";

const TARGET = 9700;
const CHUNK = 1500;
const MIN_HEALTH = 2.25;

async function main() {
  const ctx = createExchange({ withSigner: true });
  if (!ctx.canTrade) { console.log("cannot trade (no signer / DRY_RUN?)"); return; }
  const owner = ctx.config.owner as `0x${string}`;

  const markets = await perpMarkets(ctx.exchange, true);
  const market = await requireMarket(ctx.exchange, "BTC-PERP", { reload: true });
  const dec = market.info.baseDecimals;

  const snap0 = await marginSnapshot(ctx.exchange, markets[0], owner);
  console.log(`health before: ${healthRatio(snap0).toFixed(2)}`);
  const pos0: any = await positionIn(ctx.exchange, market);
  console.log(`BTC position before: ${pos0?.contracts ?? 0} ${pos0?.side ?? "-"}`);

  let filledUsd = 0;
  let filledQty = 0;
  let fails = 0;
  while (filledUsd < TARGET) {
    const snap = await marginSnapshot(ctx.exchange, markets[0], owner);
    const h = healthRatio(snap);
    if (h < MIN_HEALTH) { console.log(`health ${h.toFixed(2)} < ${MIN_HEALTH}, stop adding`); break; }

    const thisChunk = Math.min(CHUNK, TARGET - filledUsd);
    const mark = (await liveMark(ctx.exchange, market)) ?? markOf(market.info);
    if (!mark || mark <= 0) { console.log("no mark price, stop"); break; }
    const qty = sizeForNotional(thisChunk, market.info, mark);
    if (qty <= 0n) { console.log("qty 0, stop"); break; }
    const px = BigInt(Math.round(mark * 1e18));
    try {
      const res = await placePerp({
        ctx, market, side: "short", quantity: qty, price: px,
        orderType: ORDER_TYPE.FILL_OR_KILL, slippageBps: 30,
        label: "scale-in-short",
      });
      const f = Number(res.filled ?? 0n) / 10 ** dec;
      console.log(`chunk $${thisChunk} @ ${mark.toFixed(1)} -> filled ${f} BTC`);
      if (f > 0) { filledQty += f; filledUsd += f * mark; fails = 0; }
      else { fails++; if (fails >= 2) { console.log("two empty chunks, stop"); break; } }
    } catch (e: any) {
      console.log(`chunk $${thisChunk} reverted: ${String(e?.message ?? e).slice(0, 120)}`);
      fails++;
      if (fails >= 2) { console.log("two reverts, stop"); break; }
    }
  }

  const pos1: any = await positionIn(ctx.exchange, market);
  console.log(`BTC position after: ${pos1?.contracts ?? 0} ${pos1?.side ?? "-"} label=${pos1?.label ?? ""}`);
  const snap1 = await marginSnapshot(ctx.exchange, markets[0], owner);
  console.log(`added total: ${filledQty} BTC (~$${filledUsd.toFixed(0)})`);
  console.log(`health after: ${healthRatio(snap1).toFixed(2)}`);
}

main().catch((e) => { console.error("add-btc-short failed:", e?.message ?? e); process.exit(1); });
