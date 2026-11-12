import test from "node:test";
import assert from "node:assert/strict";
import { buildWelcomeEmail } from "./mailer.ts";

test("buildWelcomeEmail greets by name when available", () => {
  const { subject, text, html } = buildWelcomeEmail("Rishi");
  assert.match(subject, /Welcome/);
  assert.match(text, /Hi Rishi/);
  assert.match(html, /Hi Rishi/);
});

test("buildWelcomeEmail falls back to a generic greeting without a name", () => {
  const { text, html } = buildWelcomeEmail(null);
  assert.match(text, /Hi there/);
  assert.match(html, /Hi there/);
});
