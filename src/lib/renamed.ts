/* =========================================================================================
   CONTRACTS THE VENUE RENAMED BEFORE THIS SITE EVER PUBLISHED THEM.

   Hyperliquid delisted its TON perpetual on 15 June 2026 when Toncoin became Gram, and lists the
   same asset as GRAM. This site launched on 14 August, so /funding/ton never existed here and
   410 ("published, then withdrawn") would be a false statement about it. But a reader or a
   link asking for TON is asking for the asset now called GRAM, so it is sent there for good with
   a 301 rather than told the page never existed. Kept out of src/lib/routes.ts on purpose: the
   ingest worker bundles that file, and this changes nothing the worker decides.
   ========================================================================================= */
export const RENAMED: Readonly<Record<string, string>> = { ton: "gram" };

/** The current venue symbol (lower case) for an old one, or null. */
export const renamedTo = (symbol: string): string | null => RENAMED[symbol.trim().toLowerCase()] ?? null;
