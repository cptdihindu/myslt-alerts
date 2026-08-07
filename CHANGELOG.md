# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 - 2026-08-06

Initial public release. `check.mjs` signs into the MySLT backend, reads your broadband usage,
and messages you as the quota drains.

### Added

- **Main package alerts** that lead with GB remaining. One message every 5 GB used
  (`MAIN_STEP_GB`), tightening to every 1 GB (`MAIN_TAIL_STEP_GB`) once usage reaches the last
  10 GB of the limit (`MAIN_TAIL_GB`), with LOW wording while 10 GB or less is left. The first
  run records a baseline and stays silent, so you are never told about milestones you crossed
  before the tool existed.
- **Billing cycle detection.** A large drop in recorded usage is read as a quota reset and
  produces a single "quota refreshed" message instead of a run of stale milestones.
- **Add-on (VAS) bundle tracking**, alerting every 10 GB used (`ADDON_STEP_GB`). A changed
  bundle limit or a usage reset is treated as a new or topped-up bundle, and the tool
  re-baselines against it without sending anything.
- **Three notification channels:** WhatsApp through Green API, Telegram, and SMS through text.lk
  (emoji and newlines stripped so an alert stays one segment). Exactly one channel sends, chosen
  by the `PRECEDENCE` order in `check.mjs`: SMS, WhatsApp, Telegram. Configure a single channel
  and that order never comes up.
- **Green API as the recommended path.** It is the configuration this project runs on in
  production every day and the only channel with a delivery confirmed end to end. The costs are
  real and stated in `.env.example`: the free tier caps at 3 distinct chat contacts per month,
  and because it links a real WhatsApp account as a linked device, repeated re-linking can get a
  number flagged by WhatsApp. Telegram is the alternative when either of those matters, with the
  caveat that its path here has not had a confirmed delivery yet.
- CallMeBot, which the original private version used for WhatsApp, was dropped before this
  release. Its relay is unreliable.
- **On-demand check** with `node check.mjs --now`, which ignores thresholds and saved state and
  sends a snapshot: main balance, add-on balance, any bonus, free or extra GB buckets that still
  have something left, and the package name with its reset date. It is the quickest way to prove
  the delivery path works.
- **`--help` and `--version` flags.** An unrecognised flag prints the help text and exits with
  status 2 rather than starting a live run.
- **Zero npm dependencies.** One source file, no build step, no lockfile. Node 18 or newer,
  using the built-in `fetch`.
- **A test suite** in `test/`, using the built-in `node:test` runner so it stays dependency free.
  It covers the milestone stepping, the tightening near the cap, bucket parsing of SLT's string
  values, and asserts the threshold constants match what the docs claim, so the two cannot drift
  apart silently.
- **Continuous integration** in `.github/workflows/ci.yml`, running the syntax check and the test
  suite on Node 18, 20 and 22. It needs no secrets and makes no network calls.
- **GitHub Actions scheduling** in `.github/workflows/slt-check.yml`, on an escalating cadence
  across the billing month (every 6 hours early, every 15 minutes near month end) plus a manual
  `workflow_dispatch` with a toggle that runs `--now`. Threshold state lives in `state.json`,
  which the workflow restores from and saves to the Actions cache, and it is only re-saved when
  the file actually changed. A lost cache entry costs at most one alert, because the next run
  re-baselines.
- **Retries on SLT's flaky gateway.** Transient upstream failures are attempted three times with
  a 2 second then 4 second backoff, after which the run exits 0 with a warning so a bad few
  minutes at SLT does not fail the workflow or send failure email.
- **`docs/myslt-api.md`**, an unofficial reference for the MySLT endpoints this tool depends on:
  the login and usage summary calls, the `X-IBM-Client-Id` gateway header, a verified response
  body, and the field quirks that catch people out (every quantity is a string, most buckets can
  be `null`, `errorMessege` is misspelled by SLT, `percentage` tracks the share remaining).
- Project docs: `README.md` with setup and troubleshooting, `CONTRIBUTING.md`, `SECURITY.md`,
  `.env.example`, and issue templates for bugs and MySLT API changes.

### Security

- The workflow declares `permissions: contents: read` and never writes to the repository.
  Credentials are read from environment variables only, state stays in the Actions cache, and
  nothing sensitive is printed in the run log. `SECURITY.md` covers the trade-off of holding a
  MySLT password as a CI secret.
