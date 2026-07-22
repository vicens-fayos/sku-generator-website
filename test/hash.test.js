import { test } from "node:test";
import assert from "node:assert/strict";
import { sha1Hex, hash6, hash4 } from "../js/sku/hash.js";

test("sha1Hex matches known digests", () => {
  assert.equal(sha1Hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
  assert.equal(sha1Hex("test"), "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
});

test("sha1Hex hashes UTF-8 bytes (multibyte)", () => {
  // sha1 of "café" UTF-8 bytes
  assert.equal(sha1Hex("café"), "f424452a9673918c6f09b0cdd35b20be8e6ae7d7");
});

test("hash6 and hash4 are upper-cased prefixes", () => {
  assert.equal(hash6("test"), "A94A8F");
  assert.equal(hash4("test"), "A94A");
});
