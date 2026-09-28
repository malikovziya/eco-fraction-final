// Recomputes a batch's data hash in the browser, byte-for-byte like the backend
// (Python json.dumps(sort_keys=True, separators=(",", ":")) + SHA-256), and reads the
// on-chain hash straight from the chain, so a verification does not rely on our server.

export const CHAIN_RPC = "http://127.0.0.1:8545";
const GET_BATCH_SELECTOR = "0x5ac44282"; // EnergyOracle.getBatch(uint256)

/** Canonical JSON with sorted keys and no spaces. Numbers and strings are copied exactly as
 *  the device wrote them: re-serialising in JavaScript would turn 300.0 into 300. */
export function canonicalJson(text: string): string {
  let i = 0;
  const fail = (): never => {
    throw new Error(`invalid JSON at ${i}`);
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const str = (): string => {
    const start = i++;
    while (text[i] !== '"') {
      if (i >= text.length) fail();
      if (text[i] === "\\") i++;
      i++;
    }
    i++;
    return text.slice(start, i);
  };
  const value = (): string => {
    ws();
    const c = text[i];
    if (c === "{" || c === "[") {
      const object = c === "{";
      const close = object ? "}" : "]";
      const items: [string, string][] = []; // [sort key, serialised item]
      i++;
      ws();
      if (text[i] === close) {
        i++;
        return object ? "{}" : "[]";
      }
      for (;;) {
        ws();
        if (object) {
          if (text[i] !== '"') fail();
          const key = str();
          ws();
          if (text[i++] !== ":") fail();
          items.push([JSON.parse(key), `${key}:${value()}`]);
        } else {
          items.push(["", value()]);
        }
        ws();
        const sep = text[i++];
        if (sep === close) break;
        if (sep !== ",") fail();
      }
      if (object) items.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return (object ? "{" : "[") + items.map((x) => x[1]).join(",") + close;
    }
    if (c === '"') return str();
    const start = i;
    while (i < text.length && !",}] \t\n\r".includes(text[i])) i++;
    if (i === start) fail();
    return text.slice(start, i);
  };
  const out = value();
  ws();
  if (i !== text.length) fail();
  return out;
}

/** SHA-256 over the batch's signed messages, in order, as a 0x-prefixed hex string. */
export async function batchFingerprint(rawMessages: string[]): Promise<string> {
  const canonical = "[" + rawMessages.map(canonicalJson).join(",") + "]";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return "0x" + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The data hash stored in EnergyOracle for a batch, read directly from the chain. */
export async function onchainBatchHash(oracle: string, chainBatchId: number): Promise<string> {
  const data = GET_BATCH_SELECTOR + chainBatchId.toString(16).padStart(64, "0");
  const res = await fetch(CHAIN_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: oracle, data }, "latest"] }),
  });
  const { result } = (await res.json()) as { result?: string };
  // Batch is a static struct, returned as 8 words; the data hash is the 5th
  if (!result || result.length < 2 + 64 * 5) throw new Error("chain read failed");
  return "0x" + result.slice(2 + 64 * 4, 2 + 64 * 5);
}
