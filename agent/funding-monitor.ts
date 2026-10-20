/**
 * Funding monitor: watches funding on open positions.
 * If a position's side is no longer the paid side (funding flipped),
 * close it. Run via cron every 2 hours. Exits 0 after one check.
 */
import {
  createExchange, requireMarket, closePosition, positionIn, perpMarkets, fundingApr,
} from "@dreamdex-bot-kit/perp-core";

async function main() {
  const ctx = createExchange({ withSigner: true });
  const owner = ctx.config.owner as `0x${string}`;
  const markets = await perpMarkets(ctx.exchange, true);
  let acted = false;

  for (const m of markets) {
    const pos: any = await positionIn(ctx.exchange, m);
    if (!pos || !pos.contracts) continue;
    const fresh = await requireMarket(ctx.exchange, m.symbol, { reload: true });
    const f = fundingApr(fresh.info);
    const side = pos.side as string;
    const earning = f.paidSide === side;
    console.log(`${fresh.display}: ${side} ${pos.contracts} | funding ${(f.apr*100).toFixed(1)}% APR (pays ${f.paidSide}s) | ${earning ? "EARNING" : "PAYING"}`);
    if (!earning && f.known) {
      console.log(`  -> funding flipped against us, closing ${fresh.display}`);
      const res: any = await closePosition(ctx, fresh, owner, { label: "funding flipped" });
      const filled = Number(res.filled ?? 0n) / 10 ** fresh.info.baseDecimals;
      console.log(`  closed, filled ${filled}`);
      acted = true;
    }
  }
  console.log(acted ? "ACTIONS TAKEN" : "no action needed");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message?.slice(0,300)); process.exit(1); });
