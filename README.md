# Xixi DreamDEX Agent — dual-engine perps trading agent with layered risk guards

A perps trading agent built on the official dreamDEX bot kit / Somnia Markets SDK, running live on **Somnia Tokyo testnet** (Hideki, chain ID 50383). It trades two independent engines and wraps them in always-on risk guards, across two accounts.

## What it does

**Engine 1 — Funding-rate harvester.** Scans funding across all perp markets every 2 hours. Holds positions on the side that *receives* funding (e.g. shorting BTC-PERP while longs pay ~100%+ APR), and auto-closes any position whose funding flips against it.

**Engine 2 — Momentum hunter.** Every 30 minutes, ranks markets by 24h move (public CEX data). Moves ≥ 3% trigger a same-direction perp order (configurable size: $1,500 main account / $450 second account), capped at 8 momentum positions, gated on margin health > 2.2x. A kill switch (`MOM_LONG_PAUSE=1`) can disable new longs while leaving shorts running.

**Risk layer (always on):**
- `perp-guard` — if margin health < 2.0x, reduce positions 25%; if < 1.3x, flatten everything.
- `momentum-guard` — polls momentum positions every 5 seconds; market-closes at -4% (stop) / +10% (take profit). Built because bracket stop orders cannot be armed by a linked bot key (see feedback/01).
- Watchdog jobs check every 15 minutes that both guards are alive and restart them if the runtime killed them.

## Who it is for

Testnet builders and perps traders who want a reference implementation of a *guarded* autonomous agent: signal engines separated from risk engines, every rule executable and logged, no hidden state.

## Evidence of building

Live on Somnia Tokyo testnet since 2026-10-19:
- Main account `0x9a149509770E9FAd526907e7C93148CA74001A89` — funding shorts (BTC/BNB/DOGE/XRP), momentum trades (VVV, WLD, ZRO, LIT, PUMP, TAO, ZEC, NEAR…), BTC short scaled to 0.17375 BTC (~$14.2k notional).
- Second account `0x09a006d6109231f48DAc68e80027f85d79287fb8` — same dual-engine setup, $450/order.
- Bot (trading) key: `0xC01728d20d7569344a2eabf5924A90f05C9653E2` (orders only, cannot withdraw).

## How to run

Built on [dreamdex-bot-kit](https://github.com/somnia-chain/dreamdex-bot-kit):

```bash
git clone https://github.com/somnia-chain/dreamdex-bot-kit && cd dreamdex-bot-kit
npm install
# .env: NETWORK=hideki, BOT_PRIVATE_KEY=<your bot key>, OWNER_ADDRESS=<your account>, DRY_RUN=true
npx tsx momentum-hunter.ts        # one momentum scan round
npx tsx funding-monitor.ts        # one funding scan round
# guards run as long-lived processes; see guard scripts in this repo
```

Start with `DRY_RUN=true`, watch the decisions, then flip to live on testnet.

## Feedback track

Reproducible issues we hit while building this, one file per issue, in [`feedback/`](feedback/):
1. Bracket stop orders cannot be armed by a linked bot key — undocumented upfront.
2. Large single close orders revert on-chain; no documented max close size.
3. Initial margin is dynamic (pool-OI based) but buried in SDK docs; `InsufficientMarginForOrder` reports no numbers.

## X posts

- https://x.com/AngieMarti60773/status/2112544651668492313
- https://x.com/AngieMarti60773/status/2112544582450000128
- https://x.com/AngieMarti60773/status/2112544511830442216

## License / notes

Testnet only. This is a builder-bounty submission for the dreamDEX Perps Builder Bounty (DoraHacks). Not financial advice.
