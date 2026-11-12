import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "..");
const DIST_TYPES = resolve(ROOT, "dist", "wreq-js.d.ts");

// Checked against the built .d.ts rather than src, because that is what consumers see
// and it also catches anything the bundler mangles on the way out.
const CONFORMANCE_SOURCE = `
import { fetch, Response as WResponse } from ${JSON.stringify(DIST_TYPES.replace(/\.d\.ts$/, ".js"))};

// The whole point of the issue: usable anywhere a fetch implementation is accepted.
export const _fetch: typeof globalThis.fetch = fetch;

declare const response: WResponse;
export const _response: globalThis.Response = response;

declare const domHeaders: globalThis.Headers;
export const _headersInit = async () => {
  await fetch("https://example.dev", { headers: domHeaders });
};

declare const stream: ReadableStream<Uint8Array>;
export const _streamBody = async () => {
  await fetch("https://example.dev", { method: "POST", body: stream, duplex: "half" });
};

export const _iterableBody = async () => {
  await fetch("https://example.dev", { method: "POST", body: [new Uint8Array([1])] });
};

export const _asyncIterableBody = async () => {
  async function* chunks() {
    yield new Uint8Array([1]);
  }
  await fetch("https://example.dev", { method: "POST", body: chunks() });
};
`;

function typeCheck(lib: string[]): string[] {
  // Without this the missing bundle surfaces as an unresolved-import diagnostic, which
  // reads like a conformance failure rather than "you forgot to build".
  assert.ok(
    existsSync(DIST_TYPES),
    `${DIST_TYPES} not found. Run \`npm run build:ts\` before the suite; this test checks the published types.`,
  );

  const dir = mkdtempSync(join(tmpdir(), "wreq-conformance-"));

  try {
    const entry = join(dir, "conformance.ts");
    writeFileSync(entry, CONFORMANCE_SOURCE);

    const program = ts.createProgram([entry], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: lib.map((name) => `lib.${name}.d.ts`),
      strict: true,
      // Consumers overwhelmingly run with this on, and leaving it off would report
      // unrelated errors from other packages' declarations.
      skipLibCheck: true,
      noEmit: true,
      types: ["node"],
      typeRoots: [resolve(ROOT, "node_modules", "@types")],
    });

    return ts
      .getPreEmitDiagnostics(program)
      .filter((diag) => diag.category === ts.DiagnosticCategory.Error)
      .filter((diag) => diag.file?.fileName === entry.replace(/\\/g, "/"))
      .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, "\n").split("\n")[0] ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Fetch API type conformance", () => {
  // Node consumers: this must stay at zero. See https://github.com/sqdshguy/wreq-js/issues/167
  test("published types satisfy the Fetch API under Node lib settings", () => {
    assert.deepStrictEqual(typeCheck(["es2022"]), []);
  });

  test("published types satisfy the Fetch API with DOM.Iterable present", () => {
    assert.deepStrictEqual(typeCheck(["es2022", "dom.iterable"]), []);
  });
});
