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

// CLAUDE.md rule 7: the 3D bazaar never disappears, whatever a network has deployed.
test("every deployment, mainnet's workshop-only set included, opens on the 3D bazaar", async () => {
  const { tabsFor } = await import("../web/src/screens.ts");
  const dir = new URL("../deployments/", import.meta.url);
  const sets = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(new URL(f, dir), "utf8")));
  assert.ok(sets.some((d) => d.chainId === 677), "mainnet deployment present");
  for (const contracts of [...sets.map((d) => d.contracts), { PixelWorkshop: {} }, {}]) {
    const tabs = tabsFor(contracts);
    assert.equal(tabs[0], "bazaar", `3D bazaar first for ${Object.keys(contracts).join(",") || "nothing"}`);
    assert.ok(tabs.includes("workshop"));
  }
  const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="stage"') && html.includes('id="world"'), "index.html keeps the 3D stage");
  assert.ok(html.includes('id="to-workshop"'), "the 3D stage keeps its Pixel Workshop button");
});
