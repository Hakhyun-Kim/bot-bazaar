# Static analysis

## In CI (since 2026-10-19)

Every push runs Slither over **all** of `contracts/` (the seven deployed contracts plus `GasTank`)
in the `slither` job of `.github/workflows/ci.yml`: `npm run slither` (`scripts/slither-check.mjs`).
It compiles through `scripts/slither/solc`, a small `solc` command backed by the repo's npm solc
with the settings of `scripts/lib/compile.mjs`, so no compiler download is needed and the analysed
bytecode settings match the deployed ones. The job **fails on any High or Medium result** that is
not one of the three reviewed false positives listed in the script (`REVIEWED`) and below.

Run on 2026-10-19 (Slither 0.11.3, 11 contracts incl. interfaces, 100 detectors): 59 results,
High 2, Medium 1, Low 45, Informational 11; no unreviewed High or Medium.

### GasTank results

| Detector | Hits | Verdict | Reason |
|---|---:|---|---|
| `incorrect-equality` (Medium) | 1 | False positive | `refusal` compares `block.timestamp / 1 days == day`, two day numbers, to reset the daily cap. The "dangerous strict equality" pattern is about balances someone can push; nobody can make a day number skip. |
| `missing-zero-check` | 3 | By design | `relayer = 0` is the documented pause; `drip(0)` cannot pass `refusal` twice and only the relayer can call it. |
| `reentrancy-events` | 2 | Info | `dripped[to]`, `dripCount` and the cap are written before the call; reentry can only reorder events. `withdraw` is owner-only and sends to the owner. |
| `timestamp` | 2 | By design | Day buckets for the daily cap; a few seconds of drift only moves the reset by seconds. |
| `low-level-calls` | 2 | By design | `.call{value}` with `ok` checked, as in the other contracts. |

The rest of this page is the first, manual run on the seven contracts (commit `5ed0a86`).

## Tool and environment

| Item | Version |
|---|---|
| Slither | 0.11.6 (`pip install slither-analyzer`, Python 3.13 venv) |
| crytic-compile | 0.4.2 |
| Compiler | solc **0.8.28+commit.7893614a** (the npm `solc` package in `node_modules`, the same one `scripts/lib/compile.mjs` uses) |
| Settings | `evmVersion: paris`, optimizer enabled, 200 runs (forced by the shim, identical to `SETTINGS` in `scripts/lib/compile.mjs`) |
| Target | all 7 files in `contracts/` in one standard-JSON compilation, commit `5ed0a86` |

`solc-select install 0.8.28` could not download the native binary in the review environment
(binaries.soliditylang.org was blocked by the network proxy), so Slither was pointed at a small
shim that exposes the npm `solc` as a `solc` CLI. It only implements `--version` and
`--standard-json`, which is all crytic-compile needs with `--solc-standard-json`.

Shim (`solc`, an executable shell script, plus `solcjs-wrap.mjs` next to it, kept outside the repo):

```sh
#!/bin/sh
exec node /path/to/solcjs-wrap.mjs "$@"
```

```js
// solcjs-wrap.mjs: minimal solc CLI over the repo's npm solc for crytic-compile.
import { createRequire } from "node:module";
const require = createRequire("/path/to/bot-bazaar/package.json");
const solc = require("solc");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(`solc, the solidity compiler commandline interface\nVersion: ${solc.version()}`);
  process.exit(0);
}
if (!args.includes("--standard-json")) { console.error("shim: only --version / --standard-json"); process.exit(1); }
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const j = JSON.parse(input);
  j.settings = j.settings || {};
  j.settings.evmVersion = "paris";
  j.settings.optimizer = { enabled: true, runs: 200 };
  const fs = require("fs");
  process.stdout.write(solc.compile(JSON.stringify(j), {
    import: (p) => { try { return { contents: fs.readFileSync(p, "utf8") }; } catch { return { error: "not found" }; } },
  }));
});
```

With a native solc available, the shim is unnecessary:
`solc-select install 0.8.28 && solc-select use 0.8.28`, then the same command without `--solc`.

## Command

```sh
python3 -m venv .venv && .venv/bin/pip install slither-analyzer solc-select
cd bot-bazaar
slither contracts/ --solc /path/to/solc --solc-standard-json \
  --solc-args "--optimize --optimize-runs 200 --evm-version paris" > static-analysis-raw.txt 2>&1
# exit code 255 = findings present (normal)
```

Result: `contracts/ analyzed (10 contracts with 102 detectors), 49 result(s) found`
(10 = 7 contracts + 3 interfaces). Raw output: [static-analysis-raw.txt](static-analysis-raw.txt)
(the scratch path of the shim is replaced with `<scratch>`).

The only High-impact detector that fired is `uninitialized-state`, and both hits are false
positives (below). None of `reentrancy-eth`, `reentrancy-no-eth`, `arbitrary-send-eth`,
`unchecked-lowlevel`, `incorrect-equality`, `locked-ether`, `uninitialized-storage`,
`controlled-delegatecall`, `tx-origin` or `divide-before-multiply` fired. All other hits are
Low/Informational detectors.

## Triage

| Detector | Hits | Verdict | Reason |
|---|---:|---|---|
| `uninitialized-state` | 2 | False positive | `BazaarProjects._featuredList` and `BotOrNot._rounds` are `mapping(… => T[])`; mappings need no initialisation and are written via `push` (`setFeatured`, `enter`). Known Slither false positive for mapping-of-array state. |
| `missing-zero-check` | 1 | True positive, Info | `BazaarMarket` constructor stores `offers_` unchecked (BazaarMarket.sol:123). A zero address would only disable `purchaseFor`; the deploy script passes a nonce-predicted address and aborts if `BazaarOffers` lands elsewhere. A zero check would not catch a *wrong* non-zero address anyway. |
| `calls-loop` | 1 | True positive, Low | `releaseMany` calls `seller.call{value}` in a loop; one reverting seller reverts the whole batch. See internal-review.md **L-2**. Funds are never at risk; callers can fall back to `release(id)` per purchase. |
| `reentrancy-events` | 7 | True positive, Info | `Settled`, `Refunded`, `OfferCancelled`, `OfferAccepted`, `Paid`, `Returned`, `DesignCollected` are emitted after the value transfer. In every case the state flag (`settled`, `active`, `state`) is written before the call, so reentry cannot repeat the payment; it can only reorder events when a payee reenters and settles another item. Indexers should key on ids, not on log order. |
| `timestamp` | 29 | False positive (28) / By design (1 group) | Most hits are plain equality/boolean checks that Slither attributes to timestamp because the function also touches a timestamp. The real timestamp comparisons (escrow deadlines, offer expiry, request deadline/review, AgentPass `deadline`, BotOrNot round length) use windows of 1 day or more; a few seconds of validator drift is irrelevant. |
| `assembly` | 1 | False positive | `BazaarMarket._jsonEscape` (BazaarMarket.sol:166-168) only shrinks the length word of a freshly allocated `bytes` buffer (`mstore(out, n)` with `n <= capacity`). Memory-safe. |
| `low-level-calls` | 6 | By design | Value transfers use `.call{value}` and check `ok` every time (`refund`, `_settle`, `cancelOffer`, `_pay`, `_return`, `collect`). `transfer`/`send` would break smart-contract wallets. Return data is not used. |
| `missing-inheritance` | 1 | False positive | `BazaarMarket` already matches `IBazaarMarket` (declared in BazaarOffers.sol); inheriting it is cosmetic. |
| `redundant-statements` | 1 | True positive, Info | `data;` in `safeBatchTransferFrom` (BazaarMarket.sol:93) silences the unused-parameter warning. The related conformance gap (no batch receiver hook) is internal-review.md **I-3**. |

Net: no static-analysis result is a vulnerability. The two items carried into the manual review
are L-2 (`releaseMany` batch revert) and I-3 (ERC-1155 batch hook).

## Not run

- Mythril / symbolic execution and Echidna / Foundry fuzzing (no `forge` in the environment).
- Invariant testing is covered since 2026-10-19 by `scripts/fuzz-local.mjs` (`npm run test:fuzz`,
  three seeds in CI on every push): random buys, confirms, releases, disputes, refunds, offers and
  requests by four wallets with time jumps, checking after every step that BOT is conserved and that
  each escrow contract holds exactly what it owes. See [test-results.md](test-results.md).
