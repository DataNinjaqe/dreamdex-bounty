/**
 * 嘻嘻dreamdex · 动量猎手引擎
 *
 * 双引擎策略的主动出击部分：
 *  - 资费引擎（已在跑）：持有资费为正的仓位躺赚
 *  - 动量引擎（本脚本）：扫描 24h 强动量币种，顺势开单，快进快出
 *
 * 信号源：Binance 公开 API 的 24h ticker（免 key）
 * 执行地：DreamDEX Hideki 测试网 perp（bot 已链接全部市场）
 *
 * 风控：
 *  - 只在账户健康度 > 2.0 时开新单
 *  - 每单名义价值固定（MOM_NOTIONAL_USDSO，默认 150）
 *  - 止损 4%，止盈 10%（用链上止损单 armBracket）
 *  - 最多同时持有 MOM_MAX_POSITIONS 个动量仓位
 *  - 已有仓位的市场跳过（不动资费引擎的仓位）
 *  - perp-guard 常驻进程是最后的安全网
 *
 * 运行方式：cron 每 30 分钟跑一次，单次扫描即退出。
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
  armBracket,
  ORDER_TYPE,
} from "@dreamdex-bot-kit/perp-core";

// ---- 暴力模式参数（2026-10-20 主人令：激进、高倍、梭哈） ----
const MOM_NOTIONAL = Number(process.env.MOM_NOTIONAL_USDSO ?? 1500); // 每单名义价值 USDso（$150 → $400 → $1500，2026-10-20 主人令：大号单笔起码 1500）
const MOM_MIN_24H_PCT = Number(process.env.MOM_MIN_24H_PCT ?? 3);    // 24h 涨跌幅阈值 %（5% → 3%，更多机会）
const MOM_MAX_POSITIONS = Number(process.env.MOM_MAX_POSITIONS ?? 8); // 最大动量仓位（5 → 8）
const MOM_STOP_PCT = Number(process.env.MOM_STOP_PCT ?? 4);          // 止损 %（不变，guard 兜底）
const MOM_TP_PCT = Number(process.env.MOM_TP_PCT ?? 10);             // 止盈 %（不变）
const MOM_MIN_HEALTH = Number(process.env.MOM_MIN_HEALTH ?? 2.2);    // 开单最低健康度（2.0 → 1.8 → 2.2；2026-10-20 主人授权 dreamdex 判断执行：单笔升到 $1500 后，1.8 门槛会把账户直接开进 perp-guard 的 2.0 减仓区、逼近 1.3 全平线；2.2 保证开仓后健康度仍在 guard 线上）
const MOM_LONG_PAUSE = process.env.MOM_LONG_PAUSE === "1";           // 家族 5:0 决议：资费环境付空头时暂停开多头（只做空），MOM_LONG_PAUSE=1 生效
// 注意：杠杆倍数只能由账户本人在 App 里设置，bot 无权更改（协议限制）
// 主人如需高倍，请在 DreamDEX App → 每市场 → 设置杠杆

interface Ticker24h { symbol: string; priceChangePercent: number; }

async function fetchOkx24h(): Promise<Ticker24h[]> {
  // OKX 公开行情：24h 涨跌幅，不需要 key
  const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SWAP", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; momentum-hunter/1.0)" },
  });
  if (!res.ok) throw new Error(`okx tickers http ${res.status}`);
  const j: any = await res.json();
  const arr: any[] = j.data ?? [];
  return arr
    .filter((t) => typeof t.instId === "string" && t.instId.endsWith("-USDT-SWAP"))
    .map((t) => {
      const base = t.instId.replace(/-USDT-SWAP$/, "");
      // open24h: 24h 开盘价，last: 最新价
      const open = parseFloat(t.open24h) || 0;
      const last = parseFloat(t.last) || 0;
      const pct = open > 0 ? ((last - open) / open) * 100 : 0;
      return { symbol: base, priceChangePercent: pct };
    });
}

async function main() {
  const ctx = createExchange({ withSigner: true });
  if (!ctx.canTrade) { console.log("cannot trade (no signer / DRY_RUN?)"); return; }
  const owner = ctx.config.owner as `0x${string}`;

  // 1. 账户健康检查
  const markets = await perpMarkets(ctx.exchange, true);
  const snap0 = await marginSnapshot(ctx.exchange, markets[0], owner);
  const health = healthRatio(snap0);
  console.log(`account health: ${health.toFixed(2)} (need > ${MOM_MIN_HEALTH} to open)`);
  if (health < MOM_MIN_HEALTH) { console.log("health too low, skip opening new momentum positions"); return; }

  // 2. 现有仓位盘点
  const openPositions = new Map<string, string>(); // baseSymbol -> side
  let momentumCount = 0;
  for (const m of markets) {
    const pos: any = await positionIn(ctx.exchange, m);
    if (pos && pos.contracts) {
      openPositions.set(m.info.baseSymbol, pos.side as string);
      const label: string = (pos as any).label ?? "";
      if (label.startsWith("momentum")) momentumCount++;
    }
  }
  console.log(`open positions: ${openPositions.size}, momentum positions: ${momentumCount}/${MOM_MAX_POSITIONS}`);

  // 3. 拿 24h 动量信号（OKX 公开行情）
  const tickers = await fetchOkx24h();
  const byBase = new Map(tickers.map((t) => [t.symbol, t.priceChangePercent]));
  const candidates: { base: string; pct: number; side: "long" | "short" }[] = [];
  for (const m of markets) {
    const base = m.info.baseSymbol;
    if (openPositions.has(base)) continue; // 已有仓位跳过
    const pct = byBase.get(base);
    if (pct === undefined) continue;
    if (pct >= MOM_MIN_24H_PCT) {
      if (MOM_LONG_PAUSE) { console.log(`${base} +${pct.toFixed(1)}%: long paused by MOM_LONG_PAUSE`); continue; }
      candidates.push({ base, pct, side: "long" });
    } else if (pct <= -MOM_MIN_24H_PCT) candidates.push({ base, pct, side: "short" });
  }
  // 按动量强度排序，最强的先开
  candidates.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  console.log(`momentum candidates (|24h| >= ${MOM_MIN_24H_PCT}%):`,
    candidates.map((c) => `${c.base} ${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(1)}% ${c.side}`).join(", ") || "none");

  // 4. 开单
  let opened = 0;
  for (const c of candidates) {
    if (momentumCount + opened >= MOM_MAX_POSITIONS) { console.log("momentum slot full"); break; }
    // 开单前再查一次健康度
    const snap = await marginSnapshot(ctx.exchange, markets[0], owner);
    if (healthRatio(snap) < MOM_MIN_HEALTH) { console.log("health dropped, stop opening"); break; }

    const market = await requireMarket(ctx.exchange, `${c.base}-PERP`, { reload: true });
    const mark = (await liveMark(ctx.exchange, market)) ?? markOf(market.info);
    if (!mark || mark <= 0) { console.log(`${c.base}: no mark price, skip`); continue; }

    const qty = sizeForNotional(MOM_NOTIONAL, market.info, mark);
    if (qty <= 0n) { console.log(`${c.base}: qty 0, skip`); continue; }

    // 用市价单快速成交（FILL_OR_KILL + 滑点）
    const px = BigInt(Math.round(mark * 1e18));
    console.log(`OPEN momentum ${c.side} ${c.base} ~$${MOM_NOTIONAL} @ ${mark} (24h ${c.pct.toFixed(1)}%)`);
    try {
      const res = await placePerp({
        ctx, market, side: c.side, quantity: qty, price: px,
        orderType: ORDER_TYPE.FILL_OR_KILL, slippageBps: 30,
        label: `momentum-${c.side}`,
      });
      const filled = Number(res.filled ?? 0n) / 10 ** market.info.baseDecimals;
      console.log(`  filled: ${filled} ${c.base}`);
      if (filled > 0) {
        // 挂止损止盈 bracket
        try {
          const entry = mark;
          const stopPx = c.side === "long" ? entry * (1 - MOM_STOP_PCT / 100) : entry * (1 + MOM_STOP_PCT / 100);
          const tpPx = c.side === "long" ? entry * (1 + MOM_TP_PCT / 100) : entry * (1 - MOM_TP_PCT / 100);
          await armBracket({
            ctx: ctx as any, market, position: c.side,
            takeProfit: BigInt(Math.round(tpPx * 1e18)),
            stopLoss: BigInt(Math.round(stopPx * 1e18)),
          });
          console.log(`  bracket armed: stop ${MOM_STOP_PCT}% / tp ${MOM_TP_PCT}%`);
        } catch (e: any) {
          console.log(`  bracket failed (non-fatal): ${e.message?.slice(0, 120)}`);
        }
        opened++;
      }
    } catch (e: any) {
      console.log(`  open failed: ${e.message?.slice(0, 150)}`);
    }
  }

  console.log(opened > 0 ? `OPENED ${opened} momentum position(s)` : "no new momentum positions opened");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message?.slice(0, 300)); process.exit(1); });
