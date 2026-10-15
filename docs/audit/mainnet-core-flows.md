# Core flows on BOT Chain (677)

One run of every core flow of the market modules (test version 0.1, cap 0.001 BOT per action),
made with `scripts/core-flows.mjs` on 2026-10-15.

- seller: the deployer [`0x7cfD8d742C58D9e43A5AA20E8A786A2D193655B3`](https://scan.botchain.ai/address/0x7cfD8d742C58D9e43A5AA20E8A786A2D193655B3)
- buyer / worker: a helper wallet [`0x5ff8d698416a825C1a533566D7e9Da06fcA350D3`](https://scan.botchain.ai/address/0x5ff8d698416a825C1a533566D7e9Da06fcA350D3), funded for this run and emptied back to the deployer

| # | Flow | From | Call | BOT | Transaction |
|---:|---|---|---|---:|---|
| 1 | Fund the buyer wallet for this test | seller | BOT transfer | 0.056 | [0x46ae3a3f…9a6912](https://scan.botchain.ai/tx/0x46ae3a3f1a78ce2d0f5a713d916e0c3184353ac45c09c997f8766e76169a6912) |
| 2 | Register a project | seller | BazaarProjects.register |  | [0xcb5b6b6f…bf28e3](https://scan.botchain.ai/tx/0xcb5b6b6f0bb8adc19ce4a109e4ac1317663750595735414c8ad5f26351bf28e3) |
| 3 | Open a shop in that project, one item at the cap | seller | BazaarMarket.openShop |  | [0x70adbd83…051e0a](https://scan.botchain.ai/tx/0x70adbd8365e9b51744f01f5a0d166de78886e444a9b95da514904b7163051e0a) |
| 4 | Buy the shop item (BOT held in escrow) | buyer | BazaarMarket.buyItem | 0.001 | [0x1ad2444c…e83234](https://scan.botchain.ai/tx/0x1ad2444cd5c96d3398aa1f102537a0a8a33a654bba786db6583bfc8d10e83234) |
| 5 | Buyer confirms: seller paid, receipt to buyer | buyer | BazaarMarket.confirm |  | [0x76e86a12…ff2b95](https://scan.botchain.ai/tx/0x76e86a121132018470206d3c8df15c7fde05ab14f9b87229e89046f262ff2b95) |
| 6 | Make an offer below the price (BOT locked) | buyer | BazaarOffers.makeOffer | 0.0005 | [0xc8b0ecf4…f5aafd](https://scan.botchain.ai/tx/0xc8b0ecf46db90576edcb9517b37faa3eb3938deca5bc4f069a2aaae2cdf5aafd) |
| 7 | Seller accepts the offer (becomes an escrowed purchase) | seller | BazaarOffers.acceptOffer |  | [0xfbaeada7…d54b0e](https://scan.botchain.ai/tx/0xfbaeada7717c642b9e993598ecf867c5fe319fdb4e231d31aa13965370d54b0e) |
| 8 | Buyer confirms the offer purchase | buyer | BazaarMarket.confirm |  | [0x9d2ada6a…d6e935](https://scan.botchain.ai/tx/0x9d2ada6acc7d86e7da9ab47ab69af6d91c1b8c8bcc07c8e001730f3485d6e935) |
| 9 | Make another offer | buyer | BazaarOffers.makeOffer | 0.0005 | [0x2a8fc6b8…f2a157](https://scan.botchain.ai/tx/0x2a8fc6b82b46a71b90eec62841c63a6e45dc476ca6ec283c20c6846c4af2a157) |
| 10 | Buyer cancels it (locked BOT returned) | buyer | BazaarOffers.cancelOffer |  | [0x0a6bb0e7…a76a74](https://scan.botchain.ai/tx/0x0a6bb0e71816a206e33b079b0c926ee305d32c3e165f80461af31c6313a76a74) |
| 11 | Post a request with a reward (BOT held) | seller | BazaarRequests.post | 0.001 | [0xe3d11947…ed8284](https://scan.botchain.ai/tx/0xe3d119478a460d51a9d25ab1b9b04b40ce3ff81e393ab7f2b23ab87d2bed8284) |
| 12 | Poster assigns a worker | seller | BazaarRequests.assign |  | [0x950d647d…bb0b42](https://scan.botchain.ai/tx/0x950d647d642cb491bbbc8e9570c3cfd9da9fbd40a19fac2070d9b0d12dbb0b42) |
| 13 | Worker submits the result | buyer | BazaarRequests.submit |  | [0x1df6504d…d081c9](https://scan.botchain.ai/tx/0x1df6504d383a7e82a87f0c733b7017adae84c4fc5b332e826917d9832fd081c9) |
| 14 | Poster accepts: worker paid | seller | BazaarRequests.accept |  | [0x7f702a68…db28ac](https://scan.botchain.ai/tx/0x7f702a680829a2bf1a13cb3ad66a4e1183985ce4f27fc6ee756d1420d5db28ac) |
| 15 | Post another request | seller | BazaarRequests.post | 0.001 | [0x6778077d…b68b06](https://scan.botchain.ai/tx/0x6778077d6cdc86e2e59943a1a9c48fc5b094d72d21391cf0c90849740eb68b06) |
| 16 | Poster cancels it (reward returned) | seller | BazaarRequests.cancel |  | [0x0e7cd28c…84c1cc](https://scan.botchain.ai/tx/0x0e7cd28c86e2aaf721bd32ada13effc9b58b482ddf8880ac8cdb6ff7f884c1cc) |
| 17 | Enter Bot or Not (sealed answer) | buyer | BotOrNot.enter |  | [0xf7ed9178…ade045](https://scan.botchain.ai/tx/0xf7ed9178b16deb16a1f2cdef72f6001fb62ecfbb15d1a70ae0c526d6f7ade045) |
| 18 | Declare a kind in AgentPass | seller | AgentPass.declare |  | [0x6e430f5d…44e6b3](https://scan.botchain.ai/tx/0x6e430f5d4bc165c9410756c6cb676d7ac74ae3251aa172cc4a44100b7344e6b3) |
| 19 | Close the test shop | seller | BazaarMarket.closeShop |  | [0x225de3eb…5cb02c](https://scan.botchain.ai/tx/0x225de3ebf4f979b7e21935203ef88f8b83cc776b4bd121f54207cfdf425cb02c) |
| 20 | Return the buyer wallet's remaining BOT | buyer | BOT transfer | 0.03580304 | [0x8b8dfe52…faabe2](https://scan.botchain.ai/tx/0x8b8dfe52e268a49db79262589b6c547bd48990408bf76cce92b4b4927cfaabe2) |

All 20 transactions succeeded. Total gas fees 0.04522718 BOT.
