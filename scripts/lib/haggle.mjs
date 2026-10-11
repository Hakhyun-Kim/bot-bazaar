// Offer decision rules for agent-run shops — pure, no chain and no model.
// An agent (LLM or not) may only decide inside the negotiable band; above the list price it
// always accepts and below the floor it always refuses. Keeping that invariant in one pure
// function is what lets a merchant hand pricing to an autonomous agent safely.

export const BAND = { ABOVE_LIST: "above-list", BELOW_FLOOR: "below-floor", NEGOTIABLE: "negotiable" };

/** listPrice × ratio, kept in bigint so floating point never leaks below the floor */
export function floorOf(listPrice, floorRatio) {
  return (listPrice * BigInt(Math.round(floorRatio * 1000))) / 1000n;
}

export function classify(offerAmount, listPrice, floorRatio) {
  const floor = floorOf(listPrice, floorRatio);
  if (offerAmount >= listPrice) return { band: BAND.ABOVE_LIST, floor };
  if (offerAmount < floor) return { band: BAND.BELOW_FLOOR, floor };
  return { band: BAND.NEGOTIABLE, floor };
}

/** Rule used when no model is configured: accept above the midpoint between floor and list */
export function decideDeterministic(ratio, floorRatio) {
  return { accept: ratio >= floorRatio + (1 - floorRatio) / 2 };
}

/**
 * Final decision. `agentDecide` (optional) is consulted only in the negotiable band, and its
 * answer can never move a decision outside that band.
 */
export async function decide(offerAmount, listPrice, floorRatio, agentDecide) {
  const { band, floor } = classify(offerAmount, listPrice, floorRatio);
  if (band === BAND.ABOVE_LIST) return { accept: true, band, floor };
  if (band === BAND.BELOW_FLOOR) return { accept: false, band, floor };
  const ratio = Number((offerAmount * 10000n) / listPrice) / 10000;
  const verdict = agentDecide ? await agentDecide({ ratio, floorRatio }) : decideDeterministic(ratio, floorRatio);
  return { accept: !!verdict.accept, band, floor };
}
