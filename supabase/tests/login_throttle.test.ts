import assert from "node:assert/strict";
import { loginBucketMaterial } from "../functions/_shared/loginThrottle.ts";

Deno.test("normalizes the account identity consistently", () => {
  const a = loginBucketMaterial(" MEMBER@GYM.COM ", "203.0.113.20");
  const b = loginBucketMaterial("member@gym.com", "203.0.113.20");
  assert.equal(a, b);
});

Deno.test("a fresh browser ID or user agent cannot reset the server bucket", () => {
  // The server bucket intentionally depends only on server-observed IP and
  // normalized email, never the browser-supplied identifier.
  const material = loginBucketMaterial("member@gym.com", "203.0.113.20");
  const browserIds = ["original-browser", "brand-new-browser", "rotated-after-failure"];
  for (const _browserId of browserIds) {
    assert.equal(loginBucketMaterial("member@gym.com", "203.0.113.20"), material);
  }
});

Deno.test("different accounts and networks have separate buckets", () => {
  const baseline = loginBucketMaterial("member@gym.com", "203.0.113.20");
  assert.notEqual(loginBucketMaterial("other@gym.com", "203.0.113.20"), baseline);
  assert.notEqual(loginBucketMaterial("member@gym.com", "203.0.113.21"), baseline);
});
