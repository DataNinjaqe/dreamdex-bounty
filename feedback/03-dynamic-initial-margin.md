# Initial margin is dynamic (pool-OI based) but this is buried in SDK docs; InsufficientMarginForOrder gives no numbers

Severity: major
Area: docs | API

## Steps to reproduce
1. Fund a fresh testnet account (ours: ~$1,640 equity) and open several positions until margin health sits around 2.8x (ours: 4 longs ~$11.6k notional + 2 shorts ~$2.4k).
2. Submit a new $1,200 order (NEAR-PERP or AVAX-PERP short) through the markets SDK.
3. The order reverts with InsufficientMarginForOrder, even though account health (2.79x) looks comfortable and the same $1,200 size succeeded earlier the same day when health was 3.60x.
4. Call client.getMaxPerpOrderSize for the same pool/account/side: it reports a max of ~$454 notional, limitedBy "initialMargin".

## Expected
- The headline margin docs (perps-testnet trading docs and Link-a-Bot / bot-kit guides) state up front that effective initial margin is NOT a constant: pools raise the effective IMF with open interest, so "health looks fine" does not mean "you can open".
- InsufficientMarginForOrder (or the SDK wrapper) includes the numbers a builder needs: required margin, available margin, and the current max order size for that pool.

## Actual
The "initial margin is not a constant" fact exists only deep in the SDK's PERPS.md Q&A (around lines 503-514). The main docs present margin as if the app-set leverage were the whole story, and the revert carries no figures. We misdiagnosed this for hours as a bot-link coverage problem (we even re-checked trading-key authorization market by market) before finding getMaxPerpOrderSize.

## Evidence
- 2026-10-20 timeline on account 0x09a006d6109231f48DAc68e80027f85d79287fb8: 15:30 a $1,200 ZEC short succeeded at health 3.60x; after TAO+ZEC shorts filled, health ~2.8x and every subsequent $1,200 NEAR/AVAX attempt reverted InsufficientMarginForOrder (6 consecutive hunter rounds).
- getMaxPerpOrderSize measured 2026-10-20 19:35 CST: NEAR-PERP short max 97.2 NEAR (~$454 at mark 4.673), AVAX-PERP short max 48.4 AVAX (~$454 at mark 9.379), both limitedBy "initialMargin".
- tradingKeyCheck returns ok=true for the bot key on NEAR/AVAX/BTC for this account, ruling out the link-coverage explanation.

## Environment
- SDK: @somnia-chain/markets-sdk (via github.com/somnia-chain/dreamdex-bot-kit)
- Network: Somnia Tokyo testnet (Hideki, chain ID 50383)
- Wallet address: 0x09a006d6109231f48DAc68e80027f85d79287fb8
