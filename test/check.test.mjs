// Tests for the pure, network-free logic in check.mjs.
// Built-in runner only, no dependencies: node --test test/*.test.mjs
// (the bare directory form does not match on Node 22, so the glob is used everywhere)
//
// The imports below are deliberately dynamic. check.mjs is both a CLI and a module, so the
// first thing this file proves is that loading it as a module does not run the program.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "check.mjs");

// ---- Trip-wires, installed before check.mjs is loaded ----
// If the entry-point guard ever regresses, importing the module would log in to SLT and then
// exit the process. Both are captured here instead, so the failure shows up as a test failure.
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  fetchCalls++;
  throw new Error("check.mjs made a network call at import time: " + String(args[0]));
};

let exitCalls = 0;
const realExit = process.exit;
process.exit = (code) => {
  exitCalls++;
  throw new Error("check.mjs called process.exit(" + code + ") at import time");
};

const mod = await import("../check.mjs");

process.exit = realExit;
globalThis.fetch = realFetch;

const {
  mainMilestone,
  bucket,
  MAIN_STEP_GB,
  MAIN_TAIL_GB,
  MAIN_TAIL_STEP_GB,
  ADDON_STEP_GB,
} = mod;

// ---------------------------------------------------------------------------
test("importing check.mjs runs no program logic", async (t) => {
  await t.test("no network call happened during import", () => {
    assert.equal(fetchCalls, 0);
  });

  await t.test("no process.exit happened during import", () => {
    assert.equal(exitCalls, 0);
  });

  await t.test("the pure helpers are exported", () => {
    assert.equal(typeof mainMilestone, "function");
    assert.equal(typeof bucket, "function");
  });
});

// ---------------------------------------------------------------------------
test("threshold constants", async (t) => {
  // These four numbers are quoted in the README and in .env.example. Asserting them here means
  // a change to the code cannot silently leave the docs wrong.
  await t.test("have their documented values", () => {
    assert.equal(MAIN_STEP_GB, 5);
    assert.equal(MAIN_TAIL_GB, 10);
    assert.equal(MAIN_TAIL_STEP_GB, 1);
    assert.equal(ADDON_STEP_GB, 10);
  });

  await t.test("the tail step is tighter than the normal step", () => {
    assert.ok(MAIN_TAIL_STEP_GB < MAIN_STEP_GB);
  });
});

// ---------------------------------------------------------------------------
test("mainMilestone: normal 5 GB stepping", async (t) => {
  const limit = 100; // tail starts at 90

  await t.test("zero usage is milestone zero", () => {
    assert.equal(mainMilestone(0, limit), 0);
  });

  await t.test("usage below the first step stays at zero", () => {
    assert.equal(mainMilestone(0.4, limit), 0);
    assert.equal(mainMilestone(3, limit), 0);
    assert.equal(mainMilestone(4.99, limit), 0);
  });

  await t.test("lands exactly on a step boundary", () => {
    assert.equal(mainMilestone(5, limit), 5);
    assert.equal(mainMilestone(10, limit), 10);
    assert.equal(mainMilestone(85, limit), 85);
  });

  await t.test("rounds down to the last whole step", () => {
    assert.equal(mainMilestone(7.2, limit), 5);
    assert.equal(mainMilestone(12, limit), 10);
    assert.equal(mainMilestone(49.9, limit), 45);
  });
});

// ---------------------------------------------------------------------------
test("mainMilestone: tightens to 1 GB inside the tail", async (t) => {
  const limit = 100; // tail starts at limit - MAIN_TAIL_GB = 90

  await t.test("the last GB before the tail still uses the 5 GB step", () => {
    assert.equal(mainMilestone(89, limit), 85);
    assert.equal(mainMilestone(89.999, limit), 85);
  });

  await t.test("the exact tail boundary switches to the 1 GB step", () => {
    // used === limit - MAIN_TAIL_GB is already inside the tail, because the comparison in
    // mainMilestone is `used < tailStart`.
    assert.equal(mainMilestone(90, limit), 90);
  });

  await t.test("steps every 1 GB once inside the tail", () => {
    assert.equal(mainMilestone(90.4, limit), 90);
    assert.equal(mainMilestone(91, limit), 91);
    assert.equal(mainMilestone(95.7, limit), 95);
    assert.equal(mainMilestone(99.9, limit), 99);
  });

  await t.test("a fully consumed quota reports the limit", () => {
    assert.equal(mainMilestone(100, limit), 100);
  });

  await t.test("the milestone never goes backwards across the boundary", () => {
    assert.ok(mainMilestone(90, limit) > mainMilestone(89.999, limit));
  });
});

// ---------------------------------------------------------------------------
test("mainMilestone: other package sizes", async (t) => {
  await t.test("a 40 GB package tightens at 30 GB", () => {
    assert.equal(mainMilestone(29, 40), 25);
    assert.equal(mainMilestone(30, 40), 30);
    assert.equal(mainMilestone(31.5, 40), 31);
  });

  await t.test("a package smaller than the tail is entirely in the tail", () => {
    // limit 8 puts tailStart at -2, so every reading uses the 1 GB step.
    assert.equal(mainMilestone(0, 8), 0);
    assert.equal(mainMilestone(3.7, 8), 3);
    assert.equal(mainMilestone(8, 8), 8);
  });
});

// ---------------------------------------------------------------------------
test("bucket: parses SLT's string quantities", async (t) => {
  await t.test("a normal bucket", () => {
    assert.deepEqual(bucket({ limit: "100.00", used: "37.50", volume_unit: "GB" }), {
      limit: 100,
      used: 37.5,
      remaining: 62.5,
      unit: "GB",
    });
  });

  await t.test("defaults the unit to GB when SLT omits it", () => {
    assert.equal(bucket({ limit: "50", used: "10" }).unit, "GB");
  });

  await t.test("keeps a non-GB unit when SLT sends one", () => {
    assert.equal(bucket({ limit: "500", used: "100", volume_unit: "MB" }).unit, "MB");
  });

  await t.test("accepts already-numeric values", () => {
    assert.deepEqual(bucket({ limit: 25, used: 5 }), {
      limit: 25,
      used: 5,
      remaining: 20,
      unit: "GB",
    });
  });

  await t.test("parses a value with a trailing unit suffix", () => {
    // parseFloat stops at the first non-numeric character.
    assert.equal(bucket({ limit: "100 GB", used: "20 GB" }).limit, 100);
  });
});

// ---------------------------------------------------------------------------
test("bucket: remaining arithmetic and rounding", async (t) => {
  await t.test("rounds binary floating point noise away", () => {
    // 50.5 - 10.2 is 40.300000000000004 in IEEE 754.
    assert.equal(bucket({ limit: "50.5", used: "10.2" }).remaining, 40.3);
  });

  await t.test("rounds to two decimal places", () => {
    assert.equal(bucket({ limit: "100", used: "33.333" }).remaining, 66.67);
    assert.equal(bucket({ limit: "100", used: "33.334" }).remaining, 66.67);
  });

  await t.test("remaining is a number, not a string", () => {
    assert.equal(typeof bucket({ limit: "100", used: "1" }).remaining, "number");
  });

  await t.test("an exhausted bucket has zero remaining", () => {
    assert.equal(bucket({ limit: "40", used: "40" }).remaining, 0);
  });

  await t.test("an over-consumed bucket goes negative", () => {
    assert.equal(bucket({ limit: "10", used: "12.5" }).remaining, -2.5);
  });

  await t.test("a zero limit is still a valid bucket", () => {
    assert.deepEqual(bucket({ limit: "0", used: "0" }), {
      limit: 0,
      used: 0,
      remaining: 0,
      unit: "GB",
    });
  });
});

// ---------------------------------------------------------------------------
test("bucket: rejects everything it cannot trust", async (t) => {
  await t.test("null input", () => {
    assert.equal(bucket(null), null);
  });

  await t.test("undefined input, which is what a missing SLT field gives", () => {
    assert.equal(bucket(undefined), null);
  });

  await t.test("an empty object", () => {
    assert.equal(bucket({}), null);
  });

  await t.test("a null limit, meaning the account has no such bundle", () => {
    assert.equal(bucket({ limit: null, used: "5" }), null);
  });

  await t.test("an unparseable limit", () => {
    assert.equal(bucket({ limit: "unlimited", used: "5" }), null);
  });

  await t.test("an unparseable used value", () => {
    assert.equal(bucket({ limit: "100", used: "n/a" }), null);
  });

  await t.test("a missing used value", () => {
    assert.equal(bucket({ limit: "100" }), null);
  });

  await t.test("an empty string", () => {
    assert.equal(bucket({ limit: "", used: "" }), null);
  });
});

// ---------------------------------------------------------------------------
// These run the real CLI in a child process. All three paths return before any credential
// check or network call, so the suite stays offline.
test("CLI still works after the entry-point guard", async (t) => {
  // stderr is piped rather than inherited so the unknown-option case does not print the help
  // text into the test report.
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

  await t.test("--help prints usage", () => {
    const out = run(["--help"]);
    assert.match(out, /Usage:/);
    assert.match(out, /node check\.mjs --now/);
  });

  await t.test("-h is the same as --help", () => {
    assert.equal(run(["-h"]), run(["--help"]));
  });

  await t.test("--version prints the package version", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    assert.equal(run(["--version"]).trim(), pkg.version);
  });

  await t.test("an unknown option exits 2", () => {
    assert.throws(
      () => run(["--bogus"]),
      (err) => err.status === 2 && /Unknown option/.test(String(err.stderr)),
    );
  });
});
