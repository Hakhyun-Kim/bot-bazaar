// Pure checks — no chain, under a second. Run on every save: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BAND, classify, decide, floorOf } from "../scripts/lib/haggle.mjs";
import { NETWORKS } from "../scripts/lib/networks.mjs";
import { CONTRACTS } from "../scripts/lib/compile.mjs";

test("networks match the BOT Chain quick guide", () => {
  assert.equal(NETWORKS.mainnet.id, 677);
  assert.equal(NETWORKS.testnet.id, 968);
  const web = fs.readFileSync(new URL("../web/src/networks.ts", import.meta.url), "utf8");
  for (const n of [NETWORKS.mainnet, NETWORKS.testnet]) {
    assert.ok(web.includes(`def(${n.id}, `), `web/src/networks.ts lacks ${n.id}`);
    assert.ok(web.includes(n.rpc), `web/src/networks.ts lacks ${n.rpc}`);
  }
});

test("the floor never leaks: a hostile agent cannot accept below it or refuse above list", async () => {
  const list = 10n ** 18n;
  const yes = async () => ({ accept: true });
  const no = async () => ({ accept: false });
  assert.equal((await decide(floorOf(list, 0.7) - 1n, list, 0.7, yes)).accept, false);
  assert.equal((await decide(list, list, 0.7, no)).accept, true);
  assert.equal(classify(floorOf(list, 0.7), list, 0.7).band, BAND.NEGOTIABLE);
});

test("deterministic rule accepts above the midpoint only", async () => {
  const list = 1000n;
  assert.equal((await decide(860n, list, 0.7)).accept, true);
  assert.equal((await decide(840n, list, 0.7)).accept, false);
});

test("web ABIs are compiled from the current contracts", () => {
  const abi = JSON.parse(fs.readFileSync(new URL("../web/src/abi.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(abi).sort(), [...CONTRACTS].sort());
});

test("contracts carry English-only comments", () => {
  for (const n of CONTRACTS) {
    const src = fs.readFileSync(new URL(`../contracts/${n}.sol`, import.meta.url), "utf8");
    assert.ok(!/[가-힣]/.test(src), `${n}.sol has Korean text`);
  }
});
