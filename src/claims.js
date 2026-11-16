// Decide Claims: race-safe "claim before send" for the daily digest.
//
// n8n Data Tables cannot make user columns unique (only table/column names are), so "check, then insert" can race
// when two executions overlap. Instead every execution INSERTS its own claim
// row (status=pending, random claim_token), then READS BACK all rows for the
// same digest_key. Row ids are assigned by the database in insert order, so
// every execution sees the same ordering and agrees on one winner:
//   * an already-'sent' row always wins (someone delivered today's digest)
//   * otherwise the live 'pending' claim with the lowest id wins
//   * pending claims older than staleClaimMinutes are treated as crashed runs
//     and ignored, so a crash between claim and send can't block the digest forever
// Losers mark their row 'lost' and send nothing.

function decideClaims({ myClaims, rows, nowMs, staleClaimMinutes, force }) {
  const staleMs = staleClaimMinutes * 60e3;
  const byKey = new Map();
  for (const r of rows) {
    if (!r || r.digest_key == null || r.id == null) continue;
    if (!byKey.has(r.digest_key)) byKey.set(r.digest_key, new Map());
    byKey.get(r.digest_key).set(r.id, r); // de-duplicate by id
  }
  return myClaims.map((mine) => {
    const all = [...((byKey.get(mine.digest_key) || new Map()).values())];
    const others = all.filter((r) => r.id !== mine.id);
    const sentElsewhere = others.find((r) => r.status === 'sent');
    if (sentElsewhere && !force) {
      return { id: mine.id, digest_key: mine.digest_key, claim_token: mine.claim_token, won: false, reason: `already sent by row ${sentElsewhere.id}` };
    }
    const live = all.filter((r) => r.status === 'pending'
      && (r.id === mine.id || nowMs - Date.parse(r.claimed_at) < staleMs));
    const winner = live.reduce((min, r) => (min == null || r.id < min.id ? r : min), null);
    const won = !!winner && winner.id === mine.id;
    return {
      id: mine.id,
      digest_key: mine.digest_key,
      claim_token: mine.claim_token,
      won,
      reason: won ? 'lowest live claim' : `lost to row ${winner ? winner.id : '?'}`,
    };
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { decideClaims };
