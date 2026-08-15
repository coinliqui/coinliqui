/**
 * Keccak-256, ~70 lines, no dependencies.
 *
 * WHY THIS IS HERE AND NOT AN npm PACKAGE. The register on /unlocks claims every figure was
 * read from a contract with a named getter. That claim is only as good as the four-byte
 * selector used to make the call — and a wrong selector does not error, it returns empty data
 * or, worse, hits a different function that happens to collide. Guessing selectors from memory
 * is exactly the "acting on a summary instead of the source" failure this session keeps
 * finding. So they are derived, and the derivation is self-tested against published vectors
 * before a single call is made.
 *
 * BigInt lanes: slow, obviously correct, and we hash a few dozen short strings.
 */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const R = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0n ? x : ((x << n) | (x >> (64n - n))) & M;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) C[x] = A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y++) A[x][y] ^= D;
    }
    const B = [[], [], [], [], []];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rotl(A[x][y], BigInt(R[x][y]));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & M & B[(x + 2) % 5][y]);
    A[0][0] ^= RC[round];
  }
  return A;
}

/** @param {Uint8Array} input @returns {string} lowercase hex, no 0x */
export function keccak256(input) {
  const RATE = 136; // 1088 bits for Keccak-256
  const pad = RATE - (input.length % RATE);
  const buf = new Uint8Array(input.length + pad);
  buf.set(input);
  buf[input.length] = 0x01;           // Keccak padding (NOT SHA3's 0x06)
  buf[buf.length - 1] |= 0x80;
  const A = [[0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n]];
  for (let off = 0; off < buf.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(buf[off + i * 8 + b]);
      A[i % 5][(i / 5) | 0] ^= lane;
    }
    keccakF(A);
  }
  let out = "";
  for (let i = 0; i < 4; i++) {
    const lane = A[i % 5][(i / 5) | 0];
    for (let b = 0; b < 8; b++) out += Number((lane >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, "0");
  }
  return out;
}

/** The four-byte selector for a Solidity signature, e.g. sel("token()") -> "0xfc0c546a". */
export const sel = (sig) => "0x" + keccak256(new TextEncoder().encode(sig)).slice(0, 8);

/** Published vectors. Called before any RPC work; throws rather than letting a bad hash ship. */
export function selfTest() {
  const vectors = [
    ["", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
    ["abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"],
    ["testing", "5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02"],
  ];
  for (const [msg, want] of vectors) {
    const got = keccak256(new TextEncoder().encode(msg));
    if (got !== want) throw new Error(`keccak256(${JSON.stringify(msg)}) = ${got}, expected ${want}`);
  }
  // Selectors whose values are independently well known, as a second, different kind of check.
  const known = { "balanceOf(address)": "0x70a08231", "totalSupply()": "0x18160ddd", "decimals()": "0x313ce567" };
  for (const [sig, want] of Object.entries(known)) {
    if (sel(sig) !== want) throw new Error(`sel(${sig}) = ${sel(sig)}, expected ${want}`);
  }
  return true;
}
