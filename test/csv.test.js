import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, toCSV } from "../js/csv.js";

test("parses simple rows keyed by header", () => {
  const { header, rows } = parseCSV("a,b\n1,2\n3,4");
  assert.deepEqual(header, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
});

test("preserves leading/trailing whitespace in fields", () => {
  const { rows } = parseCSV("raw\n SYSYEM \n");
  assert.equal(rows[0].raw, " SYSYEM ");
});

test("handles quoted fields with commas, quotes and newlines", () => {
  const { rows } = parseCSV('a,b\n"x,y","he said ""hi""\nline2"');
  assert.equal(rows[0].a, "x,y");
  assert.equal(rows[0].b, 'he said "hi"\nline2');
});

test("handles CRLF line endings", () => {
  const { rows } = parseCSV("a,b\r\n1,2\r\n");
  assert.deepEqual(rows, [{ a: "1", b: "2" }]);
});

test("missing trailing cells become empty strings", () => {
  const { rows } = parseCSV("a,b,c\n1,2");
  assert.deepEqual(rows[0], { a: "1", b: "2", c: "" });
});

test("toCSV round-trips and quotes only when needed", () => {
  const out = toCSV(["a", "b"], [{ a: "x,y", b: "z" }]);
  assert.equal(out, 'a,b\r\n"x,y",z');
});
