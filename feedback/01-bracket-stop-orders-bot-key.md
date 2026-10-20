# Linked bot key cannot arm bracket stop orders, and docs/SDK do not say so upfront

Severity: major
Area: SDK | docs

## Steps to reproduce
1. Link a bot (trading key) to an account in the dreamDEX app (Link a Bot), covering all perp markets.
2. Using the official dreamdex-bot-kit (markets SDK), open a perp position through the bot key.
3. Try to attach a bracket (stop-loss / take-profit) stop order to that position through the bot key.

## Expected
Either the bot key can arm stop orders for positions it opened, or the Link-a-Bot guide / SDK surface this limitation clearly before the builder designs risk management around bracket orders (e.g. a documented error like "stops must be armed by the account itself").

## Actual
Bracket arming fails with an authentication-style error. Only after digging did we find the protocol rule: "Stop orders can only be armed by the account itself" — a linked bot key can never arm stops. The failure looks like a credentials problem, so we burned hours retrying auth flows. Workaround we had to build ourselves: an off-chain guard process polling every 5 seconds and market-closing positions at -4% / +10%.

## Evidence
- Reproducible on every momentum position opened 2026-10-19/20 via bot key 0xC01728d20d7569344a2eabf5924A90f05C9653E2 for account 0x9a149509770E9FAd526907e7C93148CA74001A89 (positions in VVV, WLD, ZRO, LIT, PUMP, TAO, ZEC markets).
- Bot-kit strategy log notes the failure as non-fatal on every run; root cause confirmed as the protocol rule quoted above, not a missing approval.

## Environment
- SDK: @somnia-chain/markets-sdk (via github.com/somnia-chain/dreamdex-bot-kit)
- Network: Somnia Tokyo testnet (Hideki, chain ID 50383)
- Wallet address: 0x9a149509770E9FAd526907e7C93148CA74001A89 (bot key 0xC01728d20d7569344a2eabf5924A90f05C9653E2)
