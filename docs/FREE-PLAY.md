# Sponsored free play

A visitor's browser wallet starts with 0 BOT, and a first design costs about 0.003 BOT of gas. Buying
BOT before the first drawing is where most new players stop. Sponsored free play pays that first
gas from a sponsor's budget (a BOT Chain grant, or the team), with every limit enforced on-chain.

## How it works

1. The page signs one plain message with the empty browser wallet (no prompt: the key is in the page)
   and posts it to the relayer.
2. The relayer (`sponsor/relayer.mjs`) checks the signature and `GasTank.refusal(address)`, then calls
   `GasTank.drip(address)`. The tank sends the wallet a fixed amount once.
3. The page waits for the drip and carries on with the publish the player asked for.

`contracts/GasTank.sol` holds the money, not the relayer:

| Limit | Where | Why |
|---|---|---|
| One drip per address, fixed size | contract | a wallet cannot come back for more |
| Only to an address without code, holding less than the drip | contract | gas money for new players only |
| Daily cap across all drips | contract | a leaked relayer key or a swarm of fresh wallets costs at most one day |
| Owner can pause (`setRelayer(0)`) and take the rest back (`withdraw`) | contract | the sponsor stays in control |
| Signature from the wallet itself | relayer | no drips to addresses nobody controls |
| Optional Cloudflare Turnstile (`TURNSTILE_SECRET`) | relayer | slows scripted wallet farming before the daily cap does |

`dripCount`, `totalDripped` and `totalFunded` are public, so a sponsor can see on BOTScan how many
new players a grant brought in and what it cost. The GasTank is the sponsor's tank, not one of the
seven shared contracts: no trade goes through it (CLAUDE.md rule 1 is about the shared contracts).

## Cost (measured on a local chain, same bytecode)

| Step | Gas | At 20 gwei |
|---|---|---|
| Drip (paid by the relayer) | ~131k | ~0.0026 BOT |
| Publish one design (paid by the player from the drip) | ~143k | ~0.0029 BOT |

A 0.01 BOT drip covers about three designs. Per new player that is ~0.0126 BOT including the
relayer's gas: 1,000 new players ≈ 12.6 BOT. A daily cap of 0.5 BOT bounds abuse to ~50 drips a day.

## Run it

- Local: `npm run chain` starts anvil with a filled GasTank and the relayer on :8787;
  `?network=local` then starts in an empty browser wallet that gets its gas on the first publish.
- Testnet, end to end: the `sponsor-testnet` workflow (`scripts/sponsor-run.mjs`) deploys a tank,
  runs the relayer in the job, and a brand new wallet claims gas and publishes a design. The record
  goes to `docs/free-play-testnet-run.md`.
- Live: deploy `sponsor/relayer.mjs` as a Cloudflare Worker (or `node sponsor/serve.mjs` anywhere)
  with `SPONSOR_KEY`, `RPC_URL`, `TANK`, `ALLOW_ORIGIN`; add `"sponsor": { "url": …, "tank": … }` to
  `deployments/<chainId>.json`. The page shows "Free to start" only where that entry exists.

Mainnet is not switched on: deploying a mainnet tank and filling it with real BOT waits for the
sponsor's decision. The relayer key should be a new wallet used for nothing else, holding only
enough BOT for drip gas.
