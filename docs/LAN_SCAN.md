# LAN Scan — verifiable scan lifecycle

The IP Scanner (native `scanLAN` bridge + `NetScannerTool` UI) is built so a
single scan has an auditable start/end boundary, can be cancelled mid-flight,
and never confuses an empty network with bad input.

## Files

| File | Role |
| --- | --- |
| `src/shared/lanScan.ts` | **Pure, platform-independent rule module** — subnet validation, prefix derivation, host sort/dedup, status merge and the one-shot `LanScanSession` state machine. No DOM/Capacitor/Android imports, runs under plain Node. |
| `src/shared/lanScan.test.ts` | Unit tests for the shared rules (Node built-in test runner). |
| `src/utils/nativeShell.ts` | Capacitor bridge types: `scanLAN()` resolves a `ScanResult`; new `cancelScan()`. |
| `src/views/ScannerTools.tsx` (`NetScannerTool`) | Frontend: validation before bridge call, Cancel button, `found` count + sorted host list, scan-again after cancel. |
| `android/app/src/main/java/com/k4n3co/pwnnet/NativeShellPlugin.java` | Native side. Mirrors every rule in `lanScan.ts` 1:1 (Java cannot import TypeScript); comments mark the mirrored functions. |

## Contract of one scan

### Input validation (before any work starts)

`validateSubnet(subnet)` rejects immediately — on both the web side and again
natively, so no thread pool is ever created for bad input — when:

1. the value is empty / not a string, or does not contain `/`;
2. the dotted prefix before `/` cannot produce at least three numeric octets
   (e.g. `192.168/16`, `192.abc.1.0/24`).

A rejection surfaces as an explicit error message in the UI and a rejected
plugin call. It is distinct from a **valid scan with zero alive hosts**, which
still resolves normally.

### Result object

```ts
interface ScanResult {
  status: 'completed' | 'cancelled';
  hosts: string[];   // unique IPs, sorted ascending by last-octet number
  found: number;     // always hosts.length
}
```

- Normal finish with no alive hosts → `{ status: 'completed', hosts: [], found: 0 }`.
- Cancel → `{ status: 'cancelled', hosts: [...hosts found before cancel], found: n }`.
- After cancellation no new `hostFound` event is emitted (native worker tasks
  no-op; the frontend also detaches its listener first).
- The native plugin resolves the `scanLAN` call **exactly once** via a single
  synchronized finalization path (`finishScan`), regardless of how many paths
  (completion, timeout, cancel, error) race to it.

### Frontend behavior

- Running state shows **SCANNING** with a Cancel button; the input accepts a
  gateway IP (`192.168.1.1`) or a full subnet (`192.168.1.0/24`).
- The status panel shows the live **Found** count; the host list is sorted by
  last octet and each IP appears once.
- After completion/cancellation the button returns to a scan action (plus an
  explicit **Scan again** link), so a cancelled scan can immediately be rerun.

## Running the tests

No device or emulator is needed. The tests use Node's built-in test runner
through `tsx`, both already in the repo's toolchain (requires Node >= 20):

```bash
npm install   # only if node_modules is missing
npm test
```

Equivalent direct invocation:

```bash
node --import tsx --test src/shared/lanScan.test.ts
```

### Covered scenarios

1. **Normal scan with hosts** — out-of-order/duplicate `hostFound` events come
   out unique and sorted by numeric last octet; `found === hosts.length`.
2. **Normal scan with zero hosts** — result stays `completed` with
   `hosts: []` / `found: 0`, proving an empty network is not a rejection.
3. **Illegal subnet** — missing `/`, fewer than three octets, non-numeric
   octet and empty input are all rejected with a reason, and `derivePrefix`
   throws instead of producing a prefix.
4. **Cancellation** — `LanScanSession.cancel()` keeps hosts found so far,
   marks the result `cancelled`, and every later `addHost()` is ignored;
   repeated `cancel()`/`finish()` return the same snapshot (single
   finalization, matching the native "resolve exactly once" guarantee).

Type checking and the production bundle remain available as before:

```bash
npm run lint     # tsc --noEmit
npm run build    # vite + esbuild
```
