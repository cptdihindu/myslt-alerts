#!/usr/bin/env node
// myslt-alerts: Sri Lanka Telecom broadband usage alerter.

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, "state.json");

const API = "https://omniscapp.slt.lk/slt/ext/api";
const CLIENT_ID = "b7402e9d66808f762ccedbe42c20668e";
const LOGIN_URL = `${API}/Account/Login`;
const USAGE_URL = (sub) => `${API}/BBVAS/UsageSummary?subscriberID=${encodeURIComponent(sub)}`;

// ---- Alert thresholds: customize these ----
export const MAIN_STEP_GB = 5;      // normal alerts every 5GB used
export const MAIN_TAIL_GB = 20;     // low-data mode starts when 20GB or less remains
export const MAIN_TAIL_STEP_GB = 2; // in low-data mode, alert every 2GB used
export const ADDON_STEP_GB = 5;     // add-on alerts every 5GB used

const {
  SLT_USERNAME,
  SLT_PASSWORD,
  SLT_SUBSCRIBER_ID,

  TEXTLK_API_TOKEN,
  TEXTLK_RECIPIENT,

  GREENAPI_ID_INSTANCE,
  GREENAPI_API_TOKEN,
  GREENAPI_CHAT_ID,

  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

const GREENAPI_API_URL = process.env.GREENAPI_API_URL || "https://api.green-api.com";
const TEXTLK_SENDER_ID = process.env.TEXTLK_SENDER_ID || "TextLKDemo";

const channels = {
  sms: { ready: !!(TEXTLK_API_TOKEN && TEXTLK_RECIPIENT), label: "SMS (text.lk)", send: sendTextLk },
  whatsapp: { ready: !!(GREENAPI_ID_INSTANCE && GREENAPI_API_TOKEN && GREENAPI_CHAT_ID), label: "WhatsApp (Green API)", send: sendGreenApi },
  telegram: { ready: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID), label: "Telegram", send: sendTelegram },
};

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
      "  SMS:      TEXTLK_API_TOKEN + TEXTLK_RECIPIENT"
    );
    process.exit(1);
  }
}

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
  const body = new URLSearchParams({
    username: SLT_USERNAME,
    password: SLT_PASSWORD,
    channelID: "WEB",
  });

  const json = await sltJson(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-IBM-Client-Id": CLIENT_ID,
    },
    body,
  });

  if (!json.accessToken) {
    throw new Error("Login failed: " + (json.errorMessage || JSON.stringify(json)));
  }

  return json.accessToken;
}

export function bucket(raw) {
  if (!raw || raw.limit == null) return null;

  const limit = parseFloat(raw.limit);
  const used = parseFloat(raw.used);

  if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;

  return {
    limit,
    used,
    remaining: +(limit - used).toFixed(2),
    unit: raw.volume_unit || "GB",
  };
}

async function getUsage(token) {
  const json = await sltJson(USAGE_URL(SLT_SUBSCRIBER_ID), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-IBM-Client-Id": CLIENT_ID,
    },
  });

  if (!json.isSuccess) {
    throw new Error("Usage fetch failed: " + (json.errorMessege || json.errorMessage || JSON.stringify(json)));
  }

  const b = json.dataBundle || {};
  const main = bucket(b.my_package_summary);

  if (!main) {
    throw new Error("Could not parse main package usage from response: " + JSON.stringify(b));
  }

  const addon = bucket(b.vas_data_summary);
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

  return {
    channel: c.label,
    out: await c.send(text),
  };
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {};

  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  const prev = loadState();
  const strip = ({ updatedAt, ...rest }) => JSON.stringify(rest);

  if (existsSync(STATE_FILE) && strip(prev) === strip(state)) return false;

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  return true;
}

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
  node check.mjs --version  Show the version.`;

function version() {
  try {
    return JSON.parse(readFileSync(join(__dir, "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

function currentBalanceMessage(u) {
  const lines = [
    `📊 MySLT Balance Update`,
    ``,
    `Main package: ${u.remaining} ${u.unit} left out of ${u.limit} ${u.unit}`,
    `Used: ${u.used} ${u.unit}`,
  ];

  if (u.addon) {
    lines.push(``, `Add-on: ${u.addon.remaining} ${u.addon.unit} left out of ${u.addon.limit} ${u.addon.unit}`);
  }

  if (u.bonus && u.bonus.remaining > 0) {
    lines.push(`Bonus: ${u.bonus.remaining} ${u.bonus.unit} left out of ${u.bonus.limit} ${u.bonus.unit}`);
  }

  if (u.free && u.free.remaining > 0) {
    lines.push(`Free data: ${u.free.remaining} ${u.free.unit} left out of ${u.free.limit} ${u.free.unit}`);
  }

  if (u.extra && u.extra.remaining > 0) {
    lines.push(`Extra GB: ${u.extra.remaining} ${u.extra.unit} left out of ${u.extra.limit} ${u.extra.unit}`);
  }

  if (u.packageName) {
    lines.push(``, `Package: ${u.packageName}${u.expiry ? ` | resets ${u.expiry}` : ""}`);
  }

  return lines.join("\n");
}

function refreshedMessage(remaining, limit, unit) {
  return [
    `🔄 MySLT quota refreshed`,
    ``,
    `You now have ${remaining} ${unit} left out of ${limit} ${unit}.`,
  ].join("\n");
}

function normalMainMessage(remaining, limit, used, unit) {
  return [
    `📶 MySLT usage alert`,
    ``,
    `${remaining} ${unit} left out of ${limit} ${unit}.`,
    `Used so far: ${used} ${unit}.`,
  ].join("\n");
}

function lowMainMessage(remaining, limit, used, unit) {
  return [
    `⚠️ MySLT low data alert`,
    ``,
    `Only ${remaining} ${unit} left.`,
    `Used: ${used} ${unit} out of ${limit} ${unit}.`,
  ].join("\n");
}

function addonMessage(addon) {
  return [
    `➕ MySLT add-on alert`,
    ``,
    `${addon.remaining} ${addon.unit} left out of ${addon.limit} ${addon.unit}.`,
  ].join("\n");
}

async function main() {
  const flags = process.argv.slice(2);

  if (flags.includes("--help") || flags.includes("-h")) return console.log(HELP);
  if (flags.includes("--version") || flags.includes("-v")) return console.log(version());

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

  if (process.argv.includes("--now")) {
    const msg = currentBalanceMessage(u);
    const { channel } = await notify(msg);
    console.log(`Sent via ${channel} (manual --now):\n` + msg);
    return;
  }

  const state = loadState();
  const messages = [];

  const milestone = mainMilestone(used, limit);
  const prevMs = state.mainMilestone;
  let nextMs;

  console.log(`pkg: used=${used}${unit}/${limit}${unit} remaining=${remaining}${unit} milestone=${milestone} prev=${prevMs}`);

  if (prevMs === undefined) {
    nextMs = milestone;
    console.log("First run: baselining main package, no alert.");
  } else if (used < state.used - 5) {
    messages.push(refreshedMessage(remaining, limit, unit));
    nextMs = milestone;
  } else if (milestone > prevMs) {
    if (remaining <= MAIN_TAIL_GB) {
      messages.push(lowMainMessage(remaining, limit, used, unit));
    } else {
      messages.push(normalMainMessage(remaining, limit, used, unit));
    }
    nextMs = milestone;
  } else {
    nextMs = Math.max(prevMs, milestone);
  }

  let addonState = {};

  if (addon) {
    const aMile = Math.floor(addon.used / ADDON_STEP_GB) * ADDON_STEP_GB;
    const hadAddon = state.addonMilestone !== undefined;
    const refreshed = hadAddon && (state.addonLimit !== addon.limit || addon.used < (state.addonUsed ?? 0) - 5);
    const prevA = !hadAddon || refreshed ? undefined : state.addonMilestone;
    let nextA;

    console.log(`addon: used=${addon.used}${addon.unit}/${addon.limit}${addon.unit} remaining=${addon.remaining}${addon.unit} milestone=${aMile} prev=${prevA}`);

    if (prevA === undefined) {
      nextA = aMile;
    } else if (aMile > prevA) {
      messages.push(addonMessage(addon));
      nextA = aMile;
    } else {
      nextA = Math.max(prevA, aMile);
    }

    addonState = {
      addonMilestone: nextA,
      addonLimit: addon.limit,
      addonUsed: addon.used,
    };
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

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;

  const self = fileURLToPath(import.meta.url);

  if (entry === self) return true;

  try {
    return realpathSync(entry) === self;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    if (err && err.transient) {
      console.warn("Transient upstream issue, skipping this run: " + (err.message || err));
      process.exit(0);
    }

    console.error(err.message || err);
    process.exit(1);
  });
}
