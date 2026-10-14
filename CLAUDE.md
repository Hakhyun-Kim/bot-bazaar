# Working rules for this repository (people and AI agents)

1. **Goods and services only.** No token, no order book, no financial products. Receipts are proof
   of purchase. No platform fee and no admin key in the shared contracts.
2. **One table per fact.** Networks: `scripts/lib/networks.mjs` (mirrored in `web/src/networks.ts`,
   `npm test` checks they agree). Compiler settings: `scripts/lib/compile.mjs`. ABIs for the web are
   generated (`npm run compile`), never edited by hand.
3. **Before pushing:** `npm run compile` · `npm test` · `npm run test:local` · `npm run build`.
   Work on `main` directly (solo repository).
4. **Keys:** deploy keys come from `DEPLOYER_KEY` in the environment only. Never commit, log or print a key.
5. **Scale work waits for users.** Indexers and caches are designed in docs/DESIGN.md §7, not built,
   unless the change makes the code smaller.
6. Commit messages: what changed, why, and how it was verified.
7. **The 3D bazaar never disappears.** It is the first screen on every network and deployment set
   (mainnet included). Add new features as an entrance from the 3D screen (a stand, a button, a tab
   next to it); a feature a network lacks shows disabled or "coming soon", never by hiding the 3D
   screen. `npm test` checks this (`web/src/screens.ts`). (harry, 2026-10-14)
