/**
 * 嘻嘻dreamdex · 动量守卫 (momentum-guard)
 *
 * 5 秒一轮的盯盘平仓守护进程。
 * 背景：DreamDEX 协议规定止损单只能由账户本人挂，bot 的链接 key 挂不上链上止损。
 * 替代方案：本进程每 5 秒查一次 mark 价格，浮亏到止损线 / 浮盈到止盈线就直接市价平仓。
 *
 * 参数（环境变量可覆盖）：
 *  - MOM_GUARD_STOP_PCT=4    止损线（%）
 *  - MOM_GUARD_TP_PCT=10     止盈线（%）
 *  - MOM_GUARD_POLL_MS=5000  轮询间隔（ms）
 *  - MOM_GUARD_ONLY_MOMENTUM=true  只盯动量仓（label momentum-开头）；false 则盯所有仓位
 *
 * 注意：只处理有 entryPrice 的仓位；entryPrice 缺失则跳过（避免误杀）。
 * perp-guard（健康度兜底）继续运行，本进程是单笔仓位的止损/止盈层。
 */

import {
  createExchange,
  perpMarkets,
  positionIn,
  closePosition,
  liveMark,
  markOf,
  onStop,
  sleep,
} from "@dreamdex-bot-kit/perp-core";

const STOP_PCT = Number(process.env.MOM_GUARD_STOP_PCT ?? 4);
const TP_PCT = Number(process.env.MOM_GUARD_TP_PCT ?? 10);
const POLL_MS = Number(process.env.MOM_GUARD_POLL_MS ?? 5000);
const ONLY_MOMENTUM = (process.env.MOM_GUARD_ONLY_MOMENTUM ?? "true") === "true";

async function main() {
  const ctx = createExchange({ withSigner: true });
  if (!ctx.canTrade) { console.error("cannot trade, exiting"); process.exit(1); }
  const owner = ctx.config.owner as `0x${string}`;
  const stopped = onStop();
  console.log(`[momentum-guard] started: stop -${STOP_PCT}% / tp +${TP_PCT}% / poll ${POLL_MS}ms / onlyMomentum=${ONLY_MOMENTUM}`);

  // entry 价格缓存：label -> entry（开仓时由 momentum-hunter 写入，这里做后备）
  while (!stopped()) {
    try {
      const markets = await perpMarkets(ctx.exchange, true);
      for (const m of markets) {
        if (stopped()) break;
        const pos: any = await positionIn(ctx.exchange, m);
        if (!pos || !pos.contracts) continue;

        const label: string = pos.label ?? "";
        if (ONLY_MOMENTUM && !label.startsWith("momentum")) continue;

        const entry = Number(pos.entryPrice ?? 0);
        if (!entry || entry <= 0) continue; // 没有开仓价，跳过

        const mark = (await liveMark(ctx.exchange, m)) ?? markOf(m.info);
        if (!mark || mark <= 0) continue;

        const side = pos.side as string;
        const pnlPct = side === "long"
          ? ((mark - entry) / entry) * 100
          : ((entry - mark) / entry) * 100;

        if (pnlPct <= -STOP_PCT) {
          console.log(`[momentum-guard] STOP ${m.display} ${side} pnl ${pnlPct.toFixed(2)}% <= -${STOP_PCT}% -> closing`);
          try {
            await closePosition(ctx, m, owner, { label: `momentum-guard stop ${pnlPct.toFixed(1)}%` });
            console.log(`[momentum-guard] closed ${m.display} (stop)`);
          } catch (e: any) {
            console.error(`[momentum-guard] close failed ${m.display}: ${e.message?.slice(0, 150)}`);
          }
        } else if (pnlPct >= TP_PCT) {
          console.log(`[momentum-guard] TAKE-PROFIT ${m.display} ${side} pnl ${pnlPct.toFixed(2)}% >= +${TP_PCT}% -> closing`);
          try {
            await closePosition(ctx, m, owner, { label: `momentum-guard tp ${pnlPct.toFixed(1)}%` });
            console.log(`[momentum-guard] closed ${m.display} (tp)`);
          } catch (e: any) {
            console.error(`[momentum-guard] close failed ${m.display}: ${e.message?.slice(0, 150)}`);
          }
        }
      }
    } catch (e: any) {
      console.error(`[momentum-guard] loop error: ${e.message?.slice(0, 150)}`);
    }
    await sleep(POLL_MS, stopped);
  }
  console.log("[momentum-guard] stopped");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message?.slice(0, 300)); process.exit(1); });
