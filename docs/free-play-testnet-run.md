# Sponsored free play: testnet run

2026-10-15 12:42 UTC · BOT Chain Testnet (968) · `node scripts/sponsor-run.mjs --yes` (GitHub Actions)

A brand new browser wallet with 0 BOT asked the relayer for free gas, got 0.01 BOT from the
GasTank, and published a pixel design paying its own gas. Design and tank on BOTScan:
GasTank [0xc601085d661038cb287110abe138251e21dafe8e](https://scan.bohr.life/address/0xc601085d661038cb287110abe138251e21dafe8e),
new wallet [0x4dD8282C067Fb9554261CdF8dE0D93F7E748d7a8](https://scan.bohr.life/address/0x4dD8282C067Fb9554261CdF8dE0D93F7E748d7a8).

| # | Step | Transaction | Gas used |
|---|------|-------------|----------|
| 1 | Deploy GasTank (owner and relayer: deploy wallet) | [0xe7197ee0…](https://scan.bohr.life/tx/0xe7197ee05ed2811bed74f87cb94b67050894f32e29ee067d9d3da5a0646ab656) | 737622 |
| 2 | Fill the tank with 0.05 BOT | [0x0ee2fa32…](https://scan.bohr.life/tx/0x0ee2fa32182c90f1b3c59b5d6308ac5d958f122d74fa73aeddc2fd3abed7c686) | 44690 |
| 3 | Relayer drips 0.01 BOT to new wallet 0x4dD828… | [0x46a83e0d…](https://scan.bohr.life/tx/0x46a83e0deacc10219e9ca8369e03adfb07af43eecf2f40d563482f04c41abc08) | 131178 |
| 4 | New wallet publishes a design with the free gas | [0x9fc45e35…](https://scan.bohr.life/tx/0x9fc45e35d650674c86cfa44258ceb0e88498fc271de6e2b02f7c2ac7a1ad800a) | 142847 |
| 5 | Owner withdraws the rest (0.04 BOT) | [0x4b465049…](https://scan.bohr.life/tx/0x4b465049fbddf04980f27073c5e72563c9907c1e8a29f14db5645bd53402ae65) | 29943 |

- Publishing used 142847 gas; the new wallet still holds 0.00714306 BOT for more designs.
- A second claim by the same wallet was refused: HTTP 409, "This wallet already got its free gas.".
- Relayer status before the withdrawal: 1 drip, 0.01 BOT spent today of 0.1.
