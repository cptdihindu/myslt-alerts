# myslt-alerts

[![CI](https://github.com/ri7in/myslt-alerts/actions/workflows/ci.yml/badge.svg)](https://github.com/ri7in/myslt-alerts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

Get a message as your Sri Lanka Telecom broadband quota drains, so you are not opening the MySLT app to find out where you stand.

A single Node file with zero npm dependencies. It signs into the MySLT backend, reads your usage, and pings you when you cross a threshold. It runs on GitHub Actions cron, so there is no server to rent and nothing to keep running at home.

## What you get

Messages that lead with **GB remaining**, because that is the number you actually care about:

```
📶 SLT data: 75 GB remaining (of 100 GB).
⚠️ SLT data LOW: only 8 GB remaining!
➕ SLT add-on: 28 GB remaining (of 40 GB).
🔄 SLT quota refreshed: 100 GB remaining (of 100 GB).
```

**The very first run sends nothing.** It records where you are and exits. [When alerts fire](docs/scheduling.md#when-alerts-fire) covers the thresholds behind each message, and `node check.mjs --now` sends a snapshot whenever you want one.

## Quick start

1. Fork this repository on GitHub, then clone your fork.
2. Set up a notification channel, then add your MySLT login and the channel's credentials under **Settings → Secrets and variables → Actions**.
3. Open the **Actions** tab, enable workflows on the fork, and run **SLT data check** once to baseline.

Each of those has detail worth reading, including the route to a private repository, testing locally first, and which settings are repository variables rather than secrets: [docs/setup.md](docs/setup.md).

## Make it yours

Alert whenever suits you. The thresholds are four constants at the top of `check.mjs`:

| Constant | Default | What it controls |
| --- | --- | --- |
| `MAIN_STEP_GB` | `5` | Normal spacing on the main package. Set it to `2` to hear from it every 2 GB. |
| `MAIN_TAIL_GB` | `10` | Where the LOW warnings begin, counted back from your limit. Set it to `20` to start warning with 20 GB left. |
| `MAIN_TAIL_STEP_GB` | `1` | Spacing once you are inside that last stretch. |
| `ADDON_STEP_GB` | `10` | The same idea for the add-on (VAS) bundle. |

How often it checks is the `cron` lines in `.github/workflows/slt-check.yml`. Delete the tiers you do not want, or replace all four with a single flat `0 */3 * * *`.

Changing a constant also changes how the saved state is read on the next run, and the thresholds assume the API reports GB. Both are covered in [Tuning](docs/scheduling.md#tuning).

## Documentation

| Page | Covers |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Requirements, getting the code, channel setup, testing locally, credentials, baselining, the configuration reference, and the caveats and risks. |
| [docs/scheduling.md](docs/scheduling.md) | When alerts fire, the state file, how often the workflow checks, running it from your own cron, and tuning the thresholds. |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Every error message and what it means, plus how to tell a healthy run from a skipped one. |
| [docs/myslt-api.md](docs/myslt-api.md) | Unofficial reference for the two MySLT calls this makes, the response fields that catch people out, and the legal and ethical note. |
| [SECURITY.md](SECURITY.md) | Where your credentials sit, what they are sent to, what lands on disk, the known limitations, and what to do if you leak one. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Getting a test run going, reporting an API change, adding a notification channel, and what to redact. |

## Good to know

- **WhatsApp via Green API is the only channel whose delivery has been confirmed end to end.** Telegram and SMS via text.lk are supported and their code is in `check.mjs`, but nobody has watched a message arrive through either. See [Channel notes](docs/setup.md#channel-notes).
- **Silence is not proof it worked.** The first run is a baseline and stays quiet, and a green workflow run does not mean your usage was checked either: when SLT is unreachable the script exits 0 on purpose. Read the log lines rather than the tick, as in [docs/troubleshooting.md](docs/troubleshooting.md#telling-a-healthy-run-from-a-skipped-one).
- **This uses an undocumented API.** SLT does not publish it, does not support it, and has not promised it will keep working. A rotated gateway client id or a moved path stops every caller at once, and that has happened before. See [Caveats and risks](docs/setup.md#caveats-and-risks).
- **Your MySLT password is stored as a GitHub Actions secret.** That means handing your ISP account password to a third-party CI system so a script can log in as you. Read [SECURITY.md](SECURITY.md) before you decide that is a trade you want.

## Tests

`npm test` (or `node --test test/*.test.mjs`) runs the logic that does not touch the network, milestone stepping and bucket parsing, on Node's built-in runner, so there is nothing to install. CI runs the same suite on Node 18, 20 and 22 on every push and pull request; it needs no secrets and makes no network calls, so it also runs on forks.

## Contributing

Issues and pull requests are welcome, especially reports of SLT changing something on their side or of a package type whose buckets behave differently. It is one source file, no dependencies and no build step, so there is not much to learn first: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports have their own route, in [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).
