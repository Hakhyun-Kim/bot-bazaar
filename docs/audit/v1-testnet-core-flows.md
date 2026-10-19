# Core flows on BOT Chain Testnet (968)

One run of every core flow of the market modules (test version 1.0, cap 0.001 BOT per action),
made with `scripts/core-flows.mjs` on 2026-10-19.

- seller: the deployer [`0x7cfD8d742C58D9e43A5AA20E8A786A2D193655B3`](https://scan.bohr.life/address/0x7cfD8d742C58D9e43A5AA20E8A786A2D193655B3)
- buyer / worker: a helper wallet [`0x5ff8d698416a825C1a533566D7e9Da06fcA350D3`](https://scan.bohr.life/address/0x5ff8d698416a825C1a533566D7e9Da06fcA350D3), funded for this run and emptied back to the deployer

| # | Flow | From | Call | BOT | Transaction |
|---:|---|---|---|---:|---|
| 1 | Fund the buyer wallet for this test | seller | BOT transfer | 0.056 | [0x8298c5ed…c4d0fa](https://scan.bohr.life/tx/0x8298c5edda6cdf2ca50f65d40afe8fb982ade29961ed5741d68c266b4cc4d0fa) |
| 2 | Register a project | seller | BazaarProjects.register |  | [0x4fa79d3d…ea7e47](https://scan.bohr.life/tx/0x4fa79d3d8fdd64c0703cff80c54fe2ec60c3650e3365f29831267b2d56ea7e47) |
| 3 | Open a shop in that project, one item at the cap | seller | BazaarMarket.openShop |  | [0x8e5a0538…799128](https://scan.bohr.life/tx/0x8e5a0538ee308aff0e8f7062229a0af04a7f5f86a5184aad40564d9eeb799128) |
| 4 | Buy the shop item (BOT held in escrow) | buyer | BazaarMarket.buyItem | 0.001 | [0x8cbf4534…3d7ad5](https://scan.bohr.life/tx/0x8cbf45343adef499717fbb677084dc9d4a31668ac47d2b60fb8806645e3d7ad5) |
| 5 | Buyer confirms: seller paid, receipt to buyer | buyer | BazaarMarket.confirm |  | [0xf76674cc…68c51c](https://scan.bohr.life/tx/0xf76674cc16a6880c8b081617db4780ace258c87ef60ba8f7bbaed3423a68c51c) |
| 6 | Make an offer below the price (BOT locked) | buyer | BazaarOffers.makeOffer | 0.0005 | [0xc41fdcd4…f6180b](https://scan.bohr.life/tx/0xc41fdcd4ceca76f397ed893dc0ae1b0884fc52b6712797e4b33c0bc071f6180b) |
| 7 | Seller accepts the offer (becomes an escrowed purchase) | seller | BazaarOffers.acceptOffer |  | [0x1e6e4d49…174989](https://scan.bohr.life/tx/0x1e6e4d49047953ceb99b1d8c2df96a84a132c2380d2ae0dbd06a5ffda9174989) |
| 8 | Buyer confirms the offer purchase | buyer | BazaarMarket.confirm |  | [0xb594d9fe…9e91d5](https://scan.bohr.life/tx/0xb594d9fea36440ad34f66cc7ab14c5456da409e1e44a8cf8c3e5e8f6069e91d5) |
| 9 | Make another offer | buyer | BazaarOffers.makeOffer | 0.0005 | [0x6f6514d1…2136d5](https://scan.bohr.life/tx/0x6f6514d156ea2a82a41056370a2783145d389c00cf33a3ec5d617ea6772136d5) |
| 10 | Buyer cancels it (locked BOT returned) | buyer | BazaarOffers.cancelOffer |  | [0x19695b66…e1da1c](https://scan.bohr.life/tx/0x19695b6652cd8e5e4e87bedcfdc1eca1c2a05d146c5b82e31d8804f534e1da1c) |
| 11 | Post a request with a reward (BOT held) | seller | BazaarRequests.post | 0.001 | [0xdc49cd41…02c619](https://scan.bohr.life/tx/0xdc49cd41f53887699841c31e34878144268b0fc43b99990154b0802cdf02c619) |
| 12 | Poster assigns a worker | seller | BazaarRequests.assign |  | [0xfe8db8aa…cab5f1](https://scan.bohr.life/tx/0xfe8db8aa563a29ecc291781b35c29b550e4d17ed1077c4c700741181cccab5f1) |
| 13 | Worker submits the result | buyer | BazaarRequests.submit |  | [0x3b030ec9…d763a6](https://scan.bohr.life/tx/0x3b030ec9c4c61fb0ef56f7362d36102fd4adf1fd5062c0384781fdc306d763a6) |
| 14 | Poster accepts: worker paid | seller | BazaarRequests.accept |  | [0xd467a1e4…0e22d7](https://scan.bohr.life/tx/0xd467a1e425ab46a225c8b63b7873f7cd2d0f7f600253475f0586a7c9950e22d7) |
| 15 | Post another request | seller | BazaarRequests.post | 0.001 | [0xaedef2e1…9f5a5d](https://scan.bohr.life/tx/0xaedef2e140a342fb7efc51477dfca2a91d9f888ce13debc6d0ddb428239f5a5d) |
| 16 | Poster cancels it (reward returned) | seller | BazaarRequests.cancel |  | [0x2da18044…09ff1c](https://scan.bohr.life/tx/0x2da1804486829a1fca6dd538d72d9941beca298d77436c926db9c5911709ff1c) |
| 17 | Enter Bot or Not (sealed answer) | buyer | BotOrNot.enter |  | [0x7c9ac8ac…293a40](https://scan.bohr.life/tx/0x7c9ac8ac98d66cef6827da86ab0690c6b0fe8f2858314da5a77da90186293a40) |
| 18 | Declare a kind in AgentPass | seller | AgentPass.declare |  | [0x5133a783…e30c13](https://scan.bohr.life/tx/0x5133a78378991425820d1faff487fc3178fa43eeba00d0dbd54c9c1870e30c13) |
| 19 | Close the test shop | seller | BazaarMarket.closeShop |  | [0xa2076e69…5e8814](https://scan.bohr.life/tx/0xa2076e6927afc7169a12bffdc072d9e5d1ed68be8f9818347c20012a275e8814) |
| 20 | Return the buyer wallet's remaining BOT | buyer | BOT transfer | 0.03576658 | [0x04e7a1ae…0f4913](https://scan.bohr.life/tx/0x04e7a1ae9b481be00ad335bc4365cf845ea34b55b19256c71c598753030f4913) |

All 20 transactions succeeded. Total gas fees 0.04526018 BOT.
