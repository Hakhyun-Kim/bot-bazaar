# Internal review of the money paths

Commit `5ed0a86`. Manual line-by-line review of every function that moves BOT, plus the cap and
BotOrNot `claim`. Line numbers are per file. Low findings marked "PoC" were reproduced on a local
anvil chain (chain id 677, paris, cap `10^15` wei) with a throwaway script; nothing was deployed
anywhere else.

Severity: **High** = funds can be stolen or paid twice; **Medium** = funds of an honest party can
be lost or locked by someone else, or a core rule can be bypassed; **Low** = griefing, delay, or
unexpected behaviour without loss beyond the attacker's own funds; **Info** = design notes,
conformance, hardening.

## Summary

No High or Medium findings. Nothing found blocks the capped 0.1 mainnet deployment.

| ID | Severity | Title | Location |
|---|---|---|---|
| L-1 | Low | A payee that rejects BOT blocks its own payout; the counterparty cannot force the other outcome | BazaarMarket.sol:454, 444 · BazaarRequests.sol:195, 202 · BazaarOffers.sol:75 |
| L-2 | Low | `releaseMany` reverts as a whole if one seller rejects BOT or an id is out of range | BazaarMarket.sol:417-424 |
| L-3 | Low | Shop item can be swapped (same index, same price) between quote and `buyItem` | BazaarMarket.sol:390-400, 272-278 |
| L-4 | Low | Market `dispute` is allowed after the 24 h deadline, so a buyer can delay an overdue release by 7 days | BazaarMarket.sol:428-436 |
| L-5 | Low | Seller can front-run a buyer's `cancelOffer` with `acceptOffer` | BazaarOffers.sol:70-88 |
| L-6 | Low | A principal cannot invalidate a signed but unused AgentPass permission before its deadline | AgentPass.sol:71-83 |
| I-1 | Info | Disputes only delay: no arbiter, buyer/poster recourse depends on the counterparty | BazaarMarket.sol:428-447 · BazaarRequests.sol:143-166 |
| I-2 | Info | The cap is per transaction, not aggregate; offers and market caps are separate immutables | BazaarMarket.sol:118, 127-129 · BazaarOffers.sol:44, 58 · BazaarRequests.sol:48, 73 |
| I-3 | Info | ERC-1155: `safeBatchTransferFrom` skips `onERC1155BatchReceived` while `supportsInterface` claims ERC-1155 | BazaarMarket.sol:85-98 |
| I-4 | Info | Receipt `uri` is unencoded JSON in a `data:` URI (`#`, `%` and non-ASCII names may break parsers) | BazaarMarket.sol:144-170 |
| I-5 | Info | Payees get all remaining gas and their return data is copied (gas griefing of whoever calls `release`) | all `.call{value}` sites |
| I-6 | Info | BotOrNot web client sends the secret answer and salt to the RPC node via `eth_call commitmentOf` | web/src/main.ts (`commitmentOf` read before `enter`) |
| I-7 | Info | BotOrNot scores can be farmed with sybil guessers; `claim` itself is sound | BotOrNot.sol:78-135 |
| I-8 | Info | `BazaarProjects.transfer` has no acceptance step; `featuredOf` returns an unbounded array | BazaarProjects.sol:43-48, 96-98 |

## Function-by-function

Each money path checked for: caller restriction · state written before the external call ·
double payment · stuck funds · behaviour with a payee contract that rejects BOT.

### BazaarMarket

| Function | Who | State before call | Pay twice? | Stuck funds? | Rejecting counterparty |
|---|---|---|---|---|---|
| `buy` (368) | anyone ≠ seller | push only, no call | n/a | no | n/a |
| `buyItem` (390) | anyone ≠ seller | push only | n/a | no | n/a |
| `purchaseFor` (379) | `offers` only (immutable) | push only | n/a | no | n/a |
| `confirm` (403) | buyer | `settled = true`, receipt minted, then `seller.call` | no, `settled` checked in `_settle` (450) | see L-1 | seller rejects → reverts; buyer cannot force it |
| `release` (410) | anyone after `releaseAt` | same `_settle` | no | see L-1 | same |
| `releaseMany` (417) | anyone | skips settled/early, then `_settle` | no | no | one rejecting seller reverts the batch (L-2) |
| `dispute` (428) | buyer, once, unsettled | no call | n/a | n/a | n/a (L-4) |
| `refund` (439) | seller, unsettled | `settled = true`, then `buyer.call` | no, same flag as `_settle` | no | buyer rejects → seller cannot refund; the seller is paid at `release` instead |
| `_settle` (449) | internal | `settled`, receipt, then call | no | | receipt mint has no callback, so a buyer contract cannot block the seller (comment at 457) |

`settled` is the single terminal flag for both outcomes, set before the transfer in both
`_settle` and `refund`; a reentrant seller or buyer hits `require(!p.settled)`. Amounts fit in
`uint128`: `buy`/`buyItem` require `msg.value` to equal a `uint128` price, `purchaseFor`
checks `<= type(uint128).max` (385) and `_capped` runs before the cast (349, 357).
`seller != buyer` and `seller != 0` are enforced (348). `safeTransferFrom` calls the receiver hook
after balances are updated and moves no BOT.

### BazaarOffers

| Function | Who | State before call | Pay twice? | Stuck funds? | Rejecting counterparty |
|---|---|---|---|---|---|
| `makeOffer` (51) | anyone ≠ seller | push, no call | n/a | no | n/a |
| `cancelOffer` (70) | buyer any time; anyone after `expiresAt` | `_close` (active = false) then `buyer.call` | no, `active` checked (72) | only if the buyer rejects BOT (own choice) | buyer rejects → reverts; seller may still accept |
| `acceptOffer` (81) | seller, until `expiresAt` inclusive | `_close` then `market.purchaseFor{value}` | no | no | a reverting `purchaseFor` (e.g. cap mismatch, wrong `offers` wiring) reverts the accept; the buyer can still cancel |

The `<= expiresAt` (accept) and `> expiresAt` (anyone cancels) boundaries do not overlap. The
buyer can cancel at any time, including the same block as an accept (see L-5).

### BazaarRequests

State machine: OPEN → ASSIGNED → SUBMITTED → PAID, with RETURNED reachable from OPEN (`cancel`),
ASSIGNED (`reclaim` after deadline, `handBack`) and SUBMITTED (`handBack`). Every transition
checks the current state and writes the new one before the transfer (`_pay` 194, `_return` 201).

| Function | Who | Guard | Pay twice? | Stuck funds? | Rejecting counterparty |
|---|---|---|---|---|---|
| `post` (66) | anyone | reward > 0, `<= cap`, deadline in future | n/a | no | n/a |
| `cancel` (108) | poster | OPEN | no | only if poster rejects | own choice |
| `assign` (96) | poster | OPEN, before deadline, worker ≠ 0/poster | n/a | no | worker never consents; poster reclaims after deadline |
| `submit` (116) | worker | ASSIGNED, `<= deadline` | n/a | n/a | n/a |
| `accept` (136) | poster | SUBMITTED | no | L-1 | worker rejects → reverts |
| `dispute` (143) | poster, once | SUBMITTED, before `releaseAt` | n/a | n/a | n/a |
| `release` (162) | anyone | SUBMITTED, `>= releaseAt` | no | L-1 | worker rejects → reverts |
| `reclaim` (129) | poster | ASSIGNED, `> deadline` | no | only if poster rejects | own choice |
| `handBack` (154) | worker | ASSIGNED or SUBMITTED | no | only if poster rejects | poster rejects → reverts; worker may wait for `release` |

`submit` (`<= deadline`) and `reclaim` (`> deadline`) do not overlap. Request `dispute` has a
"late" check (`block.timestamp < releaseAt`), unlike the market (L-4).

### BotOrNot `claim` (126-135)

Requires the round to be revealed (forfeited rounds have `revealed = false`), the caller to have
voted, and the vote to match `wasBot`; then the vote is overwritten with `CLAIMED = 3`, so a
second claim fails the `v == VOTE_HUMAN || v == VOTE_BOT` check. An out-of-range `round` reverts
on the array access. No BOT is involved. Sound.

### The cap

Checked on every entry point that can create an escrow (`list`, `openShop`, `_pushPurchase`,
`makeOffer`, `post`); there is no other way to put BOT into these contracts except forced sends
(`selfdestruct` from another contract), which no accounting reads. `maxAmount = 0` disables the
cap; the deploy script refuses that on mainnet. The 4 cap scenarios in `npm run test:local` cover
"above the cap reverts, at the cap works" for listings, shop prices, offers and rewards.

## Findings in detail

### L-1: A payee that rejects BOT blocks its own payout

`BazaarMarket._settle` (454), `refund` (444), `BazaarRequests._pay` (195), `_return` (202) and
`BazaarOffers.cancelOffer` (75) push BOT with `require(ok)`.

Scenario (PoC): a seller contract lists an item, the buyer pays, the seller contract switches its
`receive()` to revert. `confirm` and `release` revert; the purchase stays unsettled. The buyer has
no function that returns the money. The seller contract can still call `refund` (PoC: succeeds).
The same holds for a worker contract after `submit`.

Why Low and not Medium: in this design the buyer's (poster's) only route back to their money is
the counterparty's `refund` (`handBack`) anyway, and a rejecting payee can still call it. The money
is locked against the party that rejects it; no third party gains. Under the 0.001 BOT cap the
amount is negligible.

Option (not required for 0.1): on a failed transfer, credit `owed[payee]` and add a
`withdraw()`; the purchase then always settles.

### L-2: `releaseMany` reverts as a whole

`releaseMany` (417-424) calls `_settle` per id. If any seller in the list rejects BOT (L-1), or any
id is `>= purchaseCount`, the whole transaction reverts. PoC: `releaseMany([good, bad])` reverted
and the good purchase stayed unsettled. Workaround: call `release(id)` individually. Option: wrap
each settlement in a self-call with `try`, or skip ids that are out of range.

### L-3: Shop item swap before `buyItem`

`buyItem(seller, index)` pays the current price at `index` and uses the current item name as the
receipt id. The seller can call `openShop` at any time and replace the item list (272-278). If the
seller swaps item `index` for a different item **at the same price**, a pending `buyItem` goes
through and the buyer escrows money for the new item. PoC: shop item 0 changed from "A" to "B" at
the same price; the purchase's `tokenId` is the one for "B".

Impact is bounded: the price cannot change (exact `msg.value` check), the money is still escrowed
for 24 h, and the buyer can dispute. `buy(seller, itemId)` is not affected because the buyer names
the item. Option: add an expected-name hash parameter to `buyItem`.

### L-4: Market `dispute` after the deadline

`dispute` (428-436) only requires `!settled && !disputed`. Once the 24 h deadline has passed, a
buyer can still dispute as long as nobody has called `release`, pushing `releaseAt` to
`now + 7 days`. PoC: dispute at 48 h succeeded, the following `release` reverted with "early".

One extension per purchase (the `disputed` flag), and the seller is still paid at the end, so
the cost to the seller is up to 7 more days of waiting. `BazaarRequests.dispute` has the
equivalent "late" check (147). Option: `require(block.timestamp < p.releaseAt)` in the market too,
if that matches the intended rule.

### L-5: `acceptOffer` can front-run `cancelOffer`

A seller who sees a buyer's `cancelOffer` in the mempool can include `acceptOffer` first. The
buyer's money then becomes a normal escrowed purchase (24 h, disputable, refundable only by the
seller) instead of returning. This is an inherent race between two valid actions; the buyer is no
worse off than if the seller had accepted a minute earlier. Documented for users.

### L-6: Unused AgentPass permission cannot be revoked

`link` consumes `nonces[principal]` only when used (71-83). A principal who signs a permission and
changes their mind cannot cancel it before `deadline`; `revoke` only works after linking (they can
revoke immediately after the agent links). There is no "bump nonce" function. Mitigation today:
short deadlines in the client. No funds are involved.

### I-1: Disputes only delay

Market: after `dispute` the seller is paid after 7 days unless the seller refunds. Requests: after
`dispute` the worker is paid after 10 days unless the worker hands back. There is no arbiter
(consistent with "no admin key"). A seller or worker acting in bad faith keeps the money. The web
client and user docs must say this plainly; it is the main trust assumption of the escrow.
`submit` accepts any non-empty `resultURI`, so a worker can submit nothing of value and still be
paid after the review window if the poster does not get a hand-back.

### I-2: The cap

Per transaction, not aggregate (see README). `BazaarOffers.maxAmount` and
`BazaarMarket.maxAmount` are separate immutables; the deploy script passes the same value. If they
differed, offers between the two caps could be made but not accepted (the buyer can still cancel).

### I-3: ERC-1155 batch transfers skip the receiver hook

`safeBatchTransferFrom` (85-94) does not call `onERC1155BatchReceived`, and `supportsInterface`
returns true for ERC-1155 (`0xd9b67a26`). A batch transfer to a contract that cannot handle
receipts will strand those receipts. Receipts carry no BOT. Option: implement the batch hook or
document receipts as "ERC-1155-like".

### I-4: Receipt metadata encoding

`uri` returns `data:application/json;utf8,{...}` with only `"`, `\` escaped and control
characters dropped. Item names are free text (up to 48 bytes, and buyer-chosen in the offers
path). Characters such as `#` or `%` are not percent-encoded, so some wallets/parsers will cut or
misread the JSON. Display-only.

### I-5: Gas and return data of payees

Payees receive all forwarded gas, and Solidity copies their return data even though it is unused.
A hostile payee can make the `release` caller pay a lot of gas or run out. It only hurts the
payee's own settlement and the caller's gas (the caller can stop calling). Not exploitable for
funds.

### I-6: BotOrNot commitment computed via RPC

The web client computes the commitment with `read("BotOrNot", "commitmentOf", [me, isBot, salt])`,
an `eth_call` that sends the answer and the salt to the RPC provider before `enter`. A logging RPC
could learn the answer. Compute `keccak256(abi.encode(trader, isBot, salt))` locally with viem
instead. Salts themselves are 32 random bytes from `crypto.getRandomValues` (good).

### I-7: BotOrNot score farming

Anyone can create addresses to guess on their own rounds, or collude, and inflate `correct` /
`fooled`. Scores carry no value; leaderboards should be presented as such.

### I-8: BazaarProjects

`transfer(id, to)` moves ownership immediately (a typo loses curation rights). `featuredOf`
returns the whole featured list; a project owner who features thousands of shops makes their
own view expensive. Neither touches funds.

## Invariants

These held in the existing tests and in the scratch PoC (the market balance equalled the sum of
unsettled purchase amounts after mixed settle/refund/dispute/failed-release steps). They are the
recommended properties for fuzzing.

**BazaarMarket**
1. `address(this).balance >= Σ amount` over purchases with `settled == false` (equality, if nobody force-sends BOT).
2. Each purchase transitions `settled: false → true` at most once, through exactly one of `_settle` or `refund`; BOT leaves for it at most once.
3. A receipt for purchase `p` is minted iff `p` settled via `_settle` (never on `refund`); total minted for `p` is 1.
4. `amount > 0`, `amount <= maxAmount` when `maxAmount != 0`, `seller != buyer`, `seller != 0` for every purchase.
5. `releaseAt` only increases, and only through `dispute`, at most once (`disputed` false → true).
6. Only the buyer can `confirm`/`dispute`, only the seller can `refund`; anyone can settle only when `block.timestamp >= releaseAt`.

**BazaarOffers**
7. `address(this).balance >= Σ amount` over offers with `active == true`.
8. Each offer goes `active: true → false` once; its amount goes either back to the buyer or into exactly one market purchase with the same buyer, seller and amount.
9. `_activeOf[seller]` contains exactly the active offers for that seller (index map consistent).

**BazaarRequests**
10. `address(this).balance >= Σ reward` over requests in OPEN, ASSIGNED or SUBMITTED.
11. PAID and RETURNED are terminal; each request pays out at most once.
12. `_open` contains exactly the OPEN requests.
13. Only the worker can move ASSIGNED → SUBMITTED, and only up to `deadline`; the poster can reclaim only after it.

**All three:** no function sends BOT to an address other than the recorded buyer/seller,
poster/worker of the item being settled; no contract keeps any BOT once everything is settled.
