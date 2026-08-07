#!/usr/bin/env node
// myslt-alerts: Sri Lanka Telecom broadband usage alerter.
//
// Logs into the MySLT backend, reads how much of your quota is left, and messages you as you
// burn through it, so you never have to open the app. Designed to run free on GitHub Actions
// cron, so there is no server to keep alive.
//
// Zero npm dependencies: uses Node 18+ built-in fetch. Threshold state is kept in state.json
// so you are never double-pinged for the same milestone.
//
// API reference: docs/myslt-api.md
// Licence: MIT

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, "state.json");

// ---- MySLT backend (undocumented; the same calls SLT's own web portal makes) ----
const API = "https://omniscapp.slt.lk/slt/ext/api";
// Gateway key taken from SLT's own public web client, which serves it to the browser before
// login and carries no account identifier, so it reads as an application id rather than a
// per-user secret. That is an inference from one capture, not something tested. Assume SLT can
// change it, in which case every third-party client breaks at once and this line needs updating.
const CLIENT_ID = "b7402e9d66808f762ccedbe42c20668e";
const LOGIN_URL = `${API}/Account/Login`;
const USAGE_URL = (sub) => `${API}/BBVAS/UsageSummary?subscriberID=${encodeURIComponent(sub)}`;

// ---- Alert thresholds (tune these) ----
// Exported so the test suite can assert them, which keeps the documented numbers and the
// code from drifting apart.
export const MAIN_STEP_GB = 5;      // main package: alert every 5 GB used ...
export const MAIN_TAIL_GB = 10;     // ... but once you are inside the last 10 GB ...
export const MAIN_TAIL_STEP_GB = 1; // ... tighten to every 1 GB.
export const ADDON_STEP_GB = 10;    // add-on (VAS) bundle: alert every 10 GB used.

// ---- Config from env (GitHub Actions secrets, or a local .env) ----
const {
  SLT_USERNAME,        // your MySLT login, often an email address
  SLT_PASSWORD,
  SLT_SUBSCRIBER_ID,   // your account number, e.g. 94XXXXXXXXX

  // SMS via text.lk (Sri Lanka gateway; needs a paid top-up after the trial credits)
  TEXTLK_API_TOKEN,
  TEXTLK_RECIPIENT,

  // WhatsApp via Green API. This is the setup this project actually runs on.
  GREENAPI_ID_INSTANCE,
  GREENAPI_API_TOKEN,
  GREENAPI_CHAT_ID,    // recipient: 947XXXXXXXX or 947XXXXXXXX@c.us

  // Telegram (official API, no contact cap)
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

// These two need `||` rather than a destructuring default. GitHub Actions passes an unset
// repository variable through as an empty string, and a destructuring default only fires on
// `undefined`, so an unset `vars.GREENAPI_API_URL` would otherwise leave this blank.
const GREENAPI_API_URL = process.env.GREENAPI_API_URL || "https://api.green-api.com";
const TEXTLK_SENDER_ID = process.env.TEXTLK_SENDER_ID || "TextLKDemo";

const channels = {
  sms:      { ready: !!(TEXTLK_API_TOKEN && TEXTLK_RECIPIENT), label: "SMS (text.lk)", send: sendTextLk },
  whatsapp: { ready: !!(GREENAPI_ID_INSTANCE && GREENAPI_API_TOKEN && GREENAPI_CHAT_ID), label: "WhatsApp (Green API)", send: sendGreenApi },
  telegram: { ready: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID), label: "Telegram", send: sendTelegram },
};
// Order used when more than one channel happens to be configured. Configure exactly one and
// this never comes up.
const PRECEDENCE = ["sms", "whatsapp", "telegram"];

function pickChannel() {
  const key = PRECEDENCE.find((k) => channels[k].ready);
  return key ? channels[key] : null;
}

function requireEnv() {
  const missing = ["SLT_USERNAME", "SLT_PASSWORD", "SLT_SUBSCRIBER_ID"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Missing env vars: " + missing.join(", "));
    process.exit(1);
  }
  if (!PRECEDENCE.some((k) => channels[k].ready)) {
    console.error(
      "No notification channel configured. Set one of:\n" +
      "  WhatsApp: GREENAPI_ID_INSTANCE + GREENAPI_API_TOKEN + GREENAPI_CHAT_ID\n" +
      "  Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID\n" +
      "  SMS:      TEXTLK_API_TOKEN + TEXTLK_RECIPIENT\n" +
      "See .env.example for details."
    );
    process.exit(1);
  }
}

// SLT's gateway throws the occasional transient 500 ("URL Open error"). Retry those, and mark
// a genuinely unreachable API as `transient` so a run skips quietly instead of failing the
// workflow and emailing you. Real errors (bad credentials and the like) still throw loudly.
const TRANSIENT = /URL Open error|Could not connect|httpCode.{0,4}5\d\d|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|network|socket|timeout|terminated/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sltJson(url, opts) {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, opts);
      const json = await res.json().catch(() => ({}));
      if (res.status < 500 && !TRANSIENT.test(JSON.stringify(json))) return json;
      last = `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 140)}`;
    } catch (e) {
      last = e.message || String(e);
    }
    if (attempt < 3) await sleep(2000 * attempt);
  }
  const err = new Error("SLT API unreachable after 3 tries. " + last);
  err.transient = true;
  throw err;
}

async function login() {
  const body = new URLSearchParams({ username: SLT_USERNAME, password: SLT_PASSWORD, channelID: "WEB" });
  const json = await sltJson(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-IBM-Client-Id": CLIENT_ID },
    body,
  });
  if (!json.accessToken) throw new Error("Login failed: " + (json.errorMessage || JSON.stringify(json)));
  return json.accessToken;
}

// The volume figures come back as strings ("80.0"), though some other fields are real numbers,
// so parse defensively rather than trusting either.
export function bucket(raw) {
  if (!raw || raw.limit == null) return null;
  const limit = parseFloat(raw.limit);
  const used = parseFloat(raw.used);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;
  return { limit, used, remaining: +(limit - used).toFixed(2), unit: raw.volume_unit || "GB" };
}

async function getUsage(token) {
  const json = await sltJson(USAGE_URL(SLT_SUBSCRIBER_ID), {
    headers: { Authorization: `Bearer ${token}`, "X-IBM-Client-Id": CLIENT_ID },
  });
  // Note: SLT misspells this field as "errorMessege" in their own API.
  if (!json.isSuccess) {
    throw new Error("Usage fetch failed: " + (json.errorMessege || json.errorMessage || JSON.stringify(json)));
  }
  const b = json.dataBundle || {};

  const main = bucket(b.my_package_summary);
  if (!main) throw new Error("Could not parse main package usage from response: " + JSON.stringify(b));

  // Add-on (VAS) bundle, only meaningful alongside a real main package.
  const addon = bucket(b.vas_data_summary);

  // Extra buckets that may or may not be present on a given account.
  const bonus = bucket(b.bonus_data_summary);
  const free = bucket(b.free_data_summary);
  const extra = bucket(b.extra_gb_data_summary);

  const info = b.my_package_info || {};
  const detail = (info.usageDetails || [])[0] || {};

  return {
    ...main,
    addon,
    bonus,
    free,
    extra,
    packageName: info.package_name || null,
    expiry: detail.expiry_date || null,
    reportedTime: b.reported_time || info.reported_time || null,
  };
}

// ---- Notification channels ----
async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
  const out = await res.text();
  if (!res.ok) throw new Error("Telegram send failed: " + out.slice(0, 200));
  return out;
}

async function sendGreenApi(text) {
  const base = GREENAPI_API_URL.replace(/\/+$/, "");
  const url = `${base}/waInstance${GREENAPI_ID_INSTANCE}/sendMessage/${GREENAPI_API_TOKEN}`;
  const chatId = GREENAPI_CHAT_ID.includes("@") ? GREENAPI_CHAT_ID : `${GREENAPI_CHAT_ID}@c.us`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message: text }),
  });
  const out = await res.text();
  if (!res.ok) throw new Error("Green API send failed: " + out.slice(0, 200));
  return out;
}

async function sendTextLk(text) {
  // SMS: strip emoji and non-GSM characters, collapse newlines, so it stays one cheap segment.
  const sms = text.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
  const url = new URL("https://app.text.lk/api/http/sms/send");
  url.searchParams.set("recipient", TEXTLK_RECIPIENT);
  url.searchParams.set("sender_id", TEXTLK_SENDER_ID);
  url.searchParams.set("type", "plain");
  url.searchParams.set("message", sms);
  url.searchParams.set("api_token", TEXTLK_API_TOKEN);
  const res = await fetch(url);
  const out = await res.text();
  if (!res.ok) throw new Error("text.lk send failed: " + out.slice(0, 200));
  return out;
}

async function notify(text) {
  const c = pickChannel();
  if (!c) throw new Error("No notification channel configured.");
  return { channel: c.label, out: await c.send(text) };
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Only rewrite state.json when something meaningful actually changed. `updatedAt` alone is not
// meaningful: rewriting on every run would make the file look changed each time, which defeats
// the workflow's "only re-save the cache when state moved" check.
function saveState(state) {
  const prev = loadState();
  const strip = ({ updatedAt, ...rest }) => JSON.stringify(rest);
  if (existsSync(STATE_FILE) && strip(prev) === strip(state)) return false;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  return true;
}

// Highest usage milestone reached on the main package: every MAIN_STEP_GB normally, but every
// MAIN_TAIL_STEP_GB once you are inside the last MAIN_TAIL_GB.
export function mainMilestone(used, limit) {
  const tailStart = limit - MAIN_TAIL_GB;
  const step = used < tailStart ? MAIN_STEP_GB : MAIN_TAIL_STEP_GB;
  return Math.floor(used / step) * step;
}

const HELP = `myslt-alerts: alerts you on Sri Lanka Telecom broadband usage.

Usage:
  node check.mjs            Check usage and alert only if a threshold was crossed.
  node check.mjs --now      Send current balances immediately, ignoring thresholds.
  node check.mjs --help     Show this help.
  node check.mjs --version  Show the version.

Configuration is read from environment variables. See .env.example for the full list.
Docs: https://github.com/ri7in/myslt-alerts`;

function version() {
  try {
    return JSON.parse(readFileSync(join(__dir, "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.includes("--help") || flags.includes("-h")) return console.log(HELP);
  if (flags.includes("--version") || flags.includes("-v")) return console.log(version());

  // Fail loudly on a typo instead of silently doing a full live run.
  const known = new Set(["--now", "--help", "-h", "--version", "-v"]);
  const unknown = flags.filter((f) => !known.has(f));
  if (unknown.length) {
    console.error(`Unknown option: ${unknown.join(", ")}\n\n${HELP}`);
    process.exit(2);
  }

  requireEnv();
  const token = await login();
  const u = await getUsage(token);
  const { limit, used, remaining, unit, addon } = u;

  // On-demand check: `node check.mjs --now`. Ignores thresholds and state entirely.
  if (process.argv.includes("--now")) {
    const lines = [`📊 SLT: ${remaining} ${unit} remaining of ${limit} ${unit}.`];
    if (addon) lines.push(`➕ Add-on: ${addon.remaining} ${addon.unit} remaining of ${addon.limit} ${addon.unit}.`);
    // Only worth showing these optional buckets while they still have something left in them.
    if (u.bonus && u.bonus.remaining > 0) lines.push(`🎁 Bonus: ${u.bonus.remaining} ${u.bonus.unit} remaining of ${u.bonus.limit} ${u.bonus.unit}.`);
    if (u.free && u.free.remaining > 0) lines.push(`🆓 Free data: ${u.free.remaining} ${u.free.unit} remaining of ${u.free.limit} ${u.free.unit}.`);
    if (u.extra && u.extra.remaining > 0) lines.push(`📦 Extra GB: ${u.extra.remaining} ${u.extra.unit} remaining of ${u.extra.limit} ${u.extra.unit}.`);
    if (u.packageName) lines.push(`📋 Package: ${u.packageName}${u.expiry ? ` (resets ${u.expiry})` : ""}`);
    const msg = lines.join("\n");
    const { channel } = await notify(msg);
    console.log(`Sent via ${channel} (manual --now):\n` + msg);
    return;
  }

  const state = loadState();
  const messages = [];

  // ---- Main package: every 5 GB used; every 1 GB inside the last 10 GB ----
  const milestone = mainMilestone(used, limit);
  const prevMs = state.mainMilestone;
  let nextMs;
  console.log(`pkg: used=${used}${unit}/${limit}${unit} remaining=${remaining}${unit} milestone=${milestone} prev=${prevMs}`);
  if (prevMs === undefined) {
    nextMs = milestone; // first run: baseline only, stay silent
    console.log("First run: baselining main package, no alert.");
  } else if (used < state.used - 5) {
    // A large drop in usage means the quota refreshed, so a new billing cycle started.
    messages.push(`🔄 SLT quota refreshed: ${remaining} ${unit} remaining (of ${limit} ${unit}).`);
    nextMs = milestone;
  } else if (milestone > prevMs) {
    if (remaining <= MAIN_TAIL_GB) {
      messages.push(`⚠️ SLT data LOW: only ${remaining} ${unit} remaining!`);
    } else {
      messages.push(`📶 SLT data: ${remaining} ${unit} remaining (of ${limit} ${unit}).`);
    }
    nextMs = milestone;
  } else {
    nextMs = Math.max(prevMs, milestone); // no new milestone; hold the high-water mark
  }

  // ---- Add-on (VAS): alert every 10 GB used ----
  let addonState = {};
  if (addon) {
    const aMile = Math.floor(addon.used / ADDON_STEP_GB) * ADDON_STEP_GB;
    const hadAddon = state.addonMilestone !== undefined;
    // A changed limit or a big usage reset means a new or topped-up bundle: rebaseline quietly.
    const refreshed = hadAddon && (state.addonLimit !== addon.limit || addon.used < (state.addonUsed ?? 0) - 5);
    const prevA = !hadAddon || refreshed ? undefined : state.addonMilestone;
    let nextA;
    console.log(`addon: used=${addon.used}${addon.unit}/${addon.limit}${addon.unit} remaining=${addon.remaining}${addon.unit} milestone=${aMile} prev=${prevA}`);
    if (prevA === undefined) {
      nextA = aMile; // baseline, no alert
    } else if (aMile > prevA) {
      messages.push(`➕ SLT add-on: ${addon.remaining} ${addon.unit} remaining (of ${addon.limit} ${addon.unit}).`);
      nextA = aMile;
    } else {
      nextA = Math.max(prevA, aMile);
    }
    addonState = { addonMilestone: nextA, addonLimit: addon.limit, addonUsed: addon.used };
  }

  for (const m of messages) {
    const { channel } = await notify(m);
    console.log(`Sent via ${channel}:\n${m}\n`);
  }
  if (!messages.length) console.log("No new threshold crossed.");

  saveState({
    mainMilestone: nextMs,
    used,
    limit,
    remaining,
    unit,
    ...addonState,
    updatedAt: new Date().toISOString(),
  });
}

// True only when this file is the script node was told to run. Importing it (the test suite
// does exactly that) must not log in, hit the network or call process.exit.
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  // Installing the package puts a symlink in node_modules/.bin. argv[1] is then the symlink
  // while import.meta.url is already the real path, so compare real paths too.
  try {
    return realpathSync(entry) === self;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    if (err && err.transient) {
      console.warn("Transient upstream issue, skipping this run (the next run recovers): " + (err.message || err));
      process.exit(0); // do not fail the workflow over a passing SLT hiccup
    }
    console.error(err.message || err);
    process.exit(1);
  });
}
