# Test results

Run before publishing the mainnet test version 0.1 and re-run on every change to the contracts.
Reproduce from a fresh clone with `npm ci && npm run compile && npm test && npm run test:local`
(Node 22; `test:local` starts its own anvil chain, no key or BOT needed).

| Suite | What it covers | Result |
|---|---|---|
| `npm test` | Pure logic and repository guards (network tables agree, 3D market is the first screen) | 7 / 7 pass |
| `npm run test:local` | Every contract path on a local chain, including the capped mainnet configuration | 39 / 39 pass |
| `npm run verify -- --network mainnet` | On-chain code of all seven mainnet contracts equals this build (immutables masked) | 7 / 7 match, all source-verified on BOTScan |

The last block of `test:local` deploys exactly what mainnet runs (six contracts, cap 0.001 BOT,
no second Pixel Workshop) and checks the cap on every path that takes BOT: listing and shop prices,
offers, and request rewards. Static analysis is in [static-analysis.md](static-analysis.md).

## `npm run test:local` output

```

projects
  ok  anyone registers a project; ids start at 1
  ok  only the owner updates or curates

shops
  ok  open a shop in a project with a category and items
  ok  rejects bad category, 9 items, zero price
  ok  wrong price is refused

escrow
  ok  buy → escrow → buyer confirms → seller paid, receipt minted
  ok  dispute holds 7 days; release before fails, after succeeds
  ok  seller refund returns money and mints no receipt
  ok  listings: listed price enforced, unlisted refused
  ok  releaseMany settles only matured purchases
  ok  only the offers contract may call purchaseFor
  ok  redeem burns a receipt

offers
  ok  offer below list price → seller accepts → escrowed purchase
  ok  buyer cancels; strangers only after 7-day expiry

agent pass
  ok  principal signs, agent links; identityOf shows the principal
  ok  principal revokes

pixel workshop
  ok  free design: register, collect, show on profile
  ok  paid design pays the creator directly
  ok  cannot show a design you do not own
  ok  names are 1 to 36 bytes
  ok  a free design refuses BOT; unknown ids revert
  ok  gallery pages: past the end is empty, limit caps the page
  ok  clearing the profile design
  ok  deploys alone and free-only (the first mainnet version)

bots and humans
  ok  declare a kind; the market treats a declared bot exactly like anyone

bot or not
  ok  a declared trader cannot enter; an undeclared one commits
  ok  guesses: one each, never on yourself; reveal waits a day
  ok  reveal must match the commitment; fooled counts wrong guesses
  ok  only correct guessers claim, once
  ok  an unrevealed round can be forfeited after 14 days

requests
  ok  post with escrow; cancel before assignment returns it
  ok  a bot posts, a human does the work, poster accepts, worker paid
  ok  a silent poster cannot keep work: release after review, dispute extends it
  ok  missed deadline: poster reclaims; worker can hand back

shop close
  ok  closing removes the shop from the open index

mainnet test version (capped at 0.001 BOT, no workshop)
  ok  deploys six without a workshop; every escrow contract reports the cap
  ok  listings and shop prices above the cap are refused; at the cap they work
  ok  offers above the cap are refused; an accepted offer at the cap settles
  ok  request rewards above the cap are refused

39 passed, 0 failed
```
