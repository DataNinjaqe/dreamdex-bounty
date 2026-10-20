# Large single close orders revert on-chain; no documented max close size

Severity: major
Area: contracts | API

## Steps to reproduce
1. Hold a perp position with a large notional (in our case a SOL short of roughly $10,000 notional, built up on Somnia Tokyo testnet).
2. Submit one market close order for the full position size through the markets SDK / bot kit.
3. Observe the transaction revert. Repeat with the position split into small chunks (we used 10 batches) — every chunk succeeds.

## Expected
A full-position close succeeds in one order, or the SDK exposes a documented, queryable maximum close size (the way getMaxPerpOrderSize exists for opens) and a clear error when the size is too large.

## Actual
The full-size close reverts on-chain with an opaque custom error (we observed the 0xc95fe237 error pattern on oversized closes). Nothing in the trading docs we followed states a per-order close cap, so the failure reads like a contract bug. Splitting the same close into 10 equal batches closed the position cleanly.

## Evidence
- 2026-10-19: SOL short (~$10k notional) on account 0x9a149509770E9FAd526907e7C93148CA74001A89 could not be closed in one order; closed successfully in 10 batches of 10 SOL each. Account health recovered from MarginCall (1.93x) to Healthy (2.66x) after the chunked close.
- Same chunking requirement hit again on 2026-10-20 when adding to / reducing larger positions (fills chunked at ~$1,500 each).

## Environment
- SDK: @somnia-chain/markets-sdk (via github.com/somnia-chain/dreamdex-bot-kit)
- Network: Somnia Tokyo testnet (Hideki, chain ID 50383)
- Wallet address: 0x9a149509770E9FAd526907e7C93148CA74001A89
