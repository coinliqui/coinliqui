#!/usr/bin/env node
/**
 * Read vesting and lock contracts on Ethereum mainnet, so /unlocks can say "read from the
 * contract" and mean it.
 *
 * THE METHOD, which is the register's own and is not negotiable:
 *   1. The ADDRESS comes from the project's primary source (repo, docs, governance record),
 *      or the row says out loud that it was found by reading the chain instead.
 *   2. The contract must answer the getters its claimed pattern defines.
 *   3. Its token()/uni() must return the token it claims to vest. An address that holds a
 *      balance but exposes no schedule is NOT a vesting contract; it goes in `unverified`,
 *      because "there is nothing readable here" is itself a finding.
 *   4. Every number is read at one stated block, so the whole page is one consistent moment.
 *
 * Selectors are DERIVED (scripts/lib/keccak.mjs), never remembered. A wrong selector does not
 * throw — it returns empty, or collides with another function — which is the same silent-wrong
 * failure mode this codebase keeps producing.
 *
 *   node scripts/probe-vesting.mjs            probe the register + candidates, print a report
 *   node scripts/probe-vesting.mjs --json     machine-readable, for updating the data file
 */
import { sel, selfTest } from "./lib/keccak.mjs";

selfTest(); // refuse to make a single call on unverified selectors

const RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://1rpc.io/eth"];
const JSONOUT = process.argv.includes("--json");

let rpcIdx = 0;
async function rpc(method, params) {
  let lastErr;
  for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
    const url = RPCS[rpcIdx % RPCS.length];
    rpcIdx++;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await r.json();
      if (j.error) { lastErr = new Error(`${url}: ${j.error.message}`); continue; }
      /* VALIDATE AT THE BOUNDARY. These are public endpoints and their answers are foreign
         data, not a contract. At least one of the three returns an OBJECT under `result` for
         some calls rather than the hex string JSON-RPC specifies, which then flows downstream
         and dies inside BigInt() with a message that names neither the endpoint nor the call.
         Anything that is not 0x-hex is treated as that endpoint failing, and the next one is
         asked — the same question, a different answer, which is the whole point of a list. */
      if (typeof j.result !== "string" || !/^0x[0-9a-f]*$/i.test(j.result)) {
        lastErr = new Error(`${url}: ${method} returned ${typeof j.result}, not a hex string`);
        continue;
      }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("all RPC endpoints failed");
}

const pad = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
/** eth_call at a pinned block. Returns null for a revert or empty return — i.e. "no such getter". */
async function call(to, sig, args = [], block = "latest") {
  try {
    const data = sel(sig) + args.map(pad).join("");
    const out = await rpc("eth_call", [{ to, data }, block]);
    return out && out !== "0x" ? out : null;
  } catch { return null; }
}
const asNum = (hex, dec = 0) => (hex === null ? null : Number(BigInt(hex)) / 10 ** dec);
const asAddr = (hex) => (hex === null ? null : "0x" + hex.slice(-40));
const asDate = (hex) => {
  const n = hex === null ? null : Number(BigInt(hex));
  if (n === null || n === 0 || n > 4e10) return null; // 0 or a sentinel far future
  return new Date(n * 1000).toISOString().slice(0, 10);
};

/** The three patterns already in the register, each a named getter set. */
const PATTERNS = {
  uniswapTreasuryVester: {
    token: "uni()",
    fields: { amount: ["vestingAmount()", "num"], begin: ["vestingBegin()", "date"], cliff: ["vestingCliff()", "date"], end: ["vestingEnd()", "date"], lastUpdate: ["lastUpdate()", "date"], recipient: ["recipient()", "addr"] },
  },
  curveVestingEscrow: {
    token: "token()",
    fields: { amount: ["initial_locked_supply()", "num"], unallocated: ["unallocated_supply()", "num"], begin: ["start_time()", "date"], end: ["end_time()", "date"] },
  },
  ensTokenLock: {
    token: "token()",
    fields: { begin: ["unlockBegin()", "date"], cliff: ["unlockCliff()", "date"], end: ["unlockEnd()", "date"] },
  },
  /* Compound's Reservoir: a rate per BLOCK rather than a schedule with an end. It is here
     because it is the cleanest example on chain of the distinction this register is built
     around — a published rate is not the same as a funded one. See the note in the data file. */
  compoundReservoir: {
    token: "token()",
    fields: { target: ["target()", "addr"], ratePerBlock: ["dripRate()", "num18"], startBlock: ["dripStart()", "raw"], drippedToDate: ["dripped()", "num18"] },
  },
};

async function probe(addr, patternName, tokenAddr, decimals, block) {
  const p = PATTERNS[patternName];
  const out = { address: addr, pattern: patternName, readable: {}, missing: [] };

  // Does it point at the token it claims to vest? This is the test that rejects lookalikes.
  const tk = asAddr(await call(addr, p.token, [], block));
  out.tokenGetter = tk;
  out.tokenMatches = tk !== null && tk.toLowerCase() === tokenAddr.toLowerCase();

  for (const [name, [sig, kind]] of Object.entries(p.fields)) {
    const raw = await call(addr, sig, [], block);
    if (raw === null) { out.missing.push(sig); continue; }
    out.readable[name] =
      kind === "num" ? asNum(raw, decimals)
      : kind === "num18" ? asNum(raw, 18)
      : kind === "raw" ? asNum(raw, 0)
      : kind === "date" ? asDate(raw)
      : asAddr(raw);
  }

  // The question the register exists to answer: is it still holding anything?
  out.heldNow = asNum(await call(tokenAddr, "balanceOf(address)", [addr], block), decimals);
  return out;
}

/* ── what to probe ────────────────────────────────────────────────────────────────────────
   Every address below is either already in src/data/vesting-contracts.json or carries a
   primarySource. Nothing is included on the strength of "I think this is the one". */
const TOKENS = {
  UNI:  { addr: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", dec: 18, supply: 1_000_000_000 },
  CRV:  { addr: "0xd533a949740bb3306d119cc777fa900ba034cd52", dec: 18, supply: 2_409_636_911 },
  COMP: { addr: "0xc00e94cb662c3520282e6f5717214004a7f26888", dec: 18, supply: 10_000_000 },
  ENS:  { addr: "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72", dec: 18, supply: 100_000_000 },
};

const TARGETS = [
  // Already in the register — re-read to answer the one question the data file cannot:
  // the schedules ended, but did the tokens actually leave?
  { sym: "UNI", label: "Treasury Vester 1", addr: "0x4750c43867ef5f89869132eccf19b9b6c4286e1a", pattern: "uniswapTreasuryVester" },
  { sym: "UNI", label: "Treasury Vester 2", addr: "0xe3953d9d317b834592ab58ab2c7a6ad22b54075d", pattern: "uniswapTreasuryVester" },
  { sym: "UNI", label: "Treasury Vester 3", addr: "0x4b4e140d1f131fdad6fb59c13af796fd194e4135", pattern: "uniswapTreasuryVester" },
  { sym: "UNI", label: "Treasury Vester 4", addr: "0x3d30b1ab88d487b0f3061f40de76845bec3f1e94", pattern: "uniswapTreasuryVester" },
  { sym: "CRV", label: "pre-CRV liquidity providers", addr: "0x575ccd8e2d300e2377b43478339e364000318e2c", pattern: "curveVestingEscrow" },
  { sym: "ENS", label: "DAO treasury lock", addr: "0xd7a029db2585553978190db5e85ec724aa4df23f", pattern: "ensTokenLock" },
  // Addresses recorded as unreadable — re-probed so the claim stays true rather than inherited.
  { sym: "CRV", label: "Community Funds", addr: "0xe3997288987e6297ad550a69b31439504f513267", pattern: "curveVestingEscrow" },
  { sym: "CRV", label: "Investors 1", addr: "0xf22995a3ea2c83f6764c711115b23a88411cafdd", pattern: "curveVestingEscrow" },
  // Primary source: compound-finance/compound-protocol/contracts/Reservoir.sol.
  { sym: "COMP", label: "Reservoir", addr: "0x2775b1c75658be0f640272ccb8c72ac986009e38", pattern: "compoundReservoir" },
];

const block = await rpc("eth_blockNumber", []);
const blockNum = parseInt(block, 16);
const results = [];
for (const t of TARGETS) {
  const tk = TOKENS[t.sym];
  const r = await probe(t.addr, t.pattern, tk.addr, tk.dec, block);
  results.push({ ...t, ...r, shareOfSupply: r.heldNow ? r.heldNow / tk.supply : 0 });
}

if (JSONOUT) {
  console.log(JSON.stringify({ block: blockNum, at: new Date().toISOString(), results }, null, 2));
} else {
  console.log(`\nEthereum mainnet, block ${blockNum.toLocaleString("en-US")}\n`);
  for (const r of results) {
    const held = r.heldNow === null ? "unreadable" : r.heldNow.toLocaleString("en-US", { maximumFractionDigits: 0 });
    console.log(`${r.sym.padEnd(4)} ${r.label}`);
    console.log(`     ${r.address}`);
    console.log(`     token() -> ${r.tokenGetter ?? "no getter"} ${r.tokenMatches ? "MATCHES" : r.tokenGetter ? "MISMATCH" : ""}`);
    const fmtN = (v) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1000 ? 6 : 0 });
    console.log(`     schedule: ${Object.entries(r.readable).map(([k, v]) => `${k}=${typeof v === "number" ? fmtN(v) : v}`).join("  ") || "none readable"}`);
    if (r.missing.length) console.log(`     no getter: ${r.missing.join(", ")}`);
    console.log(`     HELD NOW: ${held}  (${(r.shareOfSupply * 100).toFixed(2)}% of supply)`);
    console.log();
  }
}
