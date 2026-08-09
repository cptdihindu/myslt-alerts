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

On the setup path below those land in your normal WhatsApp, through Green API, which is the best supported and best tested channel here. Telegram and SMS via text.lk are supported as well, and [Channel notes](#channel-notes) is straight about what is proven and what is not.

When those fire:

- **Main package:** every 5 GB of usage. Once you have 10 GB or less left, it tightens to every 1 GB, so the last stretch before the cap is the noisiest part.
- **Add-on (VAS) bundle:** every 10 GB of usage. If you top the bundle up, the script re-baselines quietly instead of spamming you: that happens whenever the bundle limit changes, or add-on usage drops by more than 5 GB.
- **New billing cycle:** a drop in main-package usage of more than 5 GB is read as a quota reset, and you get one "quota refreshed" message. That drop is the entire test, so a cycle that turns over on 5 GB or less used is not recognised: no refresh message, and since the milestone is not reset either, the new cycle stays silent until usage climbs back past the old cycle's highest milestone. A change in the main package limit on its own is not treated as a new cycle.
- **On demand:** `node check.mjs --now` sends a full snapshot immediately, ignoring thresholds: main balance, add-on balance, any bonus, free or extra GB buckets that still have something in them, and your package name with its reset date.

**The very first run sends nothing.** It records where you are and exits. Silence on its own does not prove it worked, though, because a run that could not reach SLT is also silent. Check the log for `First run: baselining main package, no alert.`, or just use `--now`, which sends regardless.

State lives in `state.json`, which is how it remembers what it has already told you about. On GitHub Actions the workflow keeps it in the Actions cache instead of committing it back to your repository. GitHub deletes cache entries unread for 7 days and evicts the oldest once a repository's caches pass 10 GB. If that entry goes, the next run re-baselines silently and you lose whatever would have fired in between: usually one alert, more if the gap spans a quota reset or several thresholds at once. Nothing in the log flags it, so the only symptom is an alert you never received.

State does not guarantee you are only told once. It is saved after every message in a run has been sent, so if one message is delivered and a later one fails, the run exits without saving and the delivered message goes out again on the next run. The same happens if a provider accepts a message but its response never reaches the script. A duplicate after a failed send is normal.

## Requirements

- **Node 18 or newer.** The script uses the built-in `fetch`, so there is nothing to `npm install`. The bundled workflow runs Node 20. Node 20.6 or newer also gets you `--env-file`, which is the tidiest way to run it locally.
- **Git**, to get the code onto GitHub.
- **A GitHub account.** The free tier is enough. Public repositories get Actions minutes for free; private ones draw down the monthly free minutes.
- **A WhatsApp account you can link a device to**, for the recommended channel, or an account with one of the other providers covered under [Configuration](#configuration).
- **A MySLT login** (the username you use on the MySLT portal, usually an email address) and your **subscriber ID**, which is your telephone number in `94XXXXXXXXX` form.

Every shell command below is POSIX, so it assumes macOS, Linux or WSL. On Windows, WSL is the least friction; native PowerShell works but you have to translate the syntax yourself (`$env:SLT_USERNAME = 'you@example.com'` for `export`, `Remove-Item -Recurse -Force .git` for `rm -rf .git`).

## Setup

### 1. Get the code

Fork this repository on GitHub first, then clone your fork:

```bash
git clone https://github.com/<you>/myslt-alerts.git
cd myslt-alerts
```

The scheduled workflow has to live in a repository you own, so forking before you clone saves you a step in part 4.

**Want a private repository instead?** You are about to store your ISP password in it as a secret (see [Caveats and risks](#caveats-and-risks) and [`SECURITY.md`](SECURITY.md)), and a fork of a public repository is always public, with no way to flip it to private. Take a copy of the files instead, either by cloning and dropping the git history:

```bash
git clone https://github.com/ri7in/myslt-alerts.git
cd myslt-alerts
rm -rf .git
```

or by downloading the ZIP from the green **Code** button and unzipping it, which arrives with no `.git` directory at all. The ZIP expands to a folder named `myslt-alerts-main`, so step into it first:

```bash
cd myslt-alerts-main
```

Check you are in the right place before continuing: `ls` should show `check.mjs` at the top level. If it shows a single folder instead, step into that. Getting this wrong puts `.github/workflows/` one level below the repository root, where GitHub does not look for workflows, and the schedule then silently never runs.

Either way you now have a plain folder, so make it a repository and push it:

```bash
git init
git config user.name "Your Name"       # skip if you have set these globally
git config user.email "you@example.com"
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/myslt-alerts.git
git push -u origin main
```

Two things to get right. Git will not commit until `user.name` and `user.email` are set, globally with `git config --global` or per repository as above. And create the GitHub repository **empty**: if you let GitHub add a README, a licence or a `.gitignore`, the remote has a commit your history does not share and the first push is rejected as non-fast-forward. Part 4 then applies unchanged, except that `git push` alone is enough since `origin` is already set.

> **Note on this repository's own Actions tab.** The `SLT data check` workflow is disabled here
> on purpose. This repository is the source you copy, not a running installation, so there are no
> credentials behind it and a schedule would only produce failures. It runs in *your* copy once
> you enable it and add your secrets, as described below. The `CI` workflow does run here.

### 2. Set up WhatsApp via Green API

This is the recommended channel for one honest reason: it is the only channel whose delivery has been confirmed end to end, and it is the best tested path in this project. Alerts arrive in your normal WhatsApp.

Read the two drawbacks before you commit to it. Both are real and both bite in practice.

- **The free Developer tier caps you at 3 distinct chat contacts per month.** Fine for messaging yourself, awkward for anything wider.
- **It works by linking a real WhatsApp account as a linked device.** That is your own account driving an automation, and WhatsApp's anti-abuse systems can flag the number for it, especially if you unlink and re-link repeatedly. A number flagged that way can stay unusable for weeks, and it is your everyday WhatsApp number carrying the risk. Scan the QR once and leave it alone.

If either of those matters to you, use Telegram instead, covered in [Other channels](#other-channels) below. Be clear-eyed about the trade: Telegram avoids both problems, but its delivery path in this project has not been confirmed by a real send.

Setting it up:

1. Sign up at [green-api.com](https://green-api.com) and create a free **Developer** instance.
2. From the instance page, copy `idInstance` (this is `GREENAPI_ID_INSTANCE`), `apiTokenInstance` (`GREENAPI_API_TOKEN`) and the instance `apiUrl` (`GREENAPI_API_URL`, in the form `https://NNNN.api.greenapi.com`). Treat the API token as a credential.
3. Authorize the instance. On your phone, open WhatsApp, go to **Settings → Linked Devices → Link a Device**, and scan the QR code shown in the Green API console. Scan it once.
4. Confirm the console reads **Authorized**. You can check the same thing directly: `GET {apiUrl}/waInstance{idInstance}/getStateInstance/{apiToken}` returns `authorized`.
5. Set `GREENAPI_CHAT_ID` to your own number with the country code and no `+`, for example `947XXXXXXXX`. The `@c.us` suffix is added for you if you leave it off.

Keep WhatsApp active on the phone afterwards, since Green API rides that linked session.

#### Other channels

Both of these are supported and the code for them is in `check.mjs`, but neither has had a delivery confirmed in this project. If you configure more than one channel, the script sends through exactly one, in the order sms, whatsapp, telegram. See [Configuration](#configuration).

**Telegram.** Free, official API, no cap on how many people you can message, and nothing of yours is linked as a device.

1. In Telegram, open a chat with **@BotFather** and send `/newbot`.
2. Answer the two prompts (a display name and a username ending in `bot`). BotFather replies with a token that looks like `123456:ABC-DEF...`. That is your `TELEGRAM_BOT_TOKEN`.
3. Open a chat with your new bot and send it any message, for example `hi`. A bot cannot message you until you have messaged it first.
4. Get your chat id by messaging **@userinfobot**, which replies with your numeric id. That number is your `TELEGRAM_CHAT_ID`.

`https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` also works, with two catches. The bot token is a credential, so a browser address bar leaves it in history and in whatever syncs that history: use `curl` instead. And `result[0]` is your chat only if yours is the oldest pending update, which it is not if the bot has other updates queued or has been added to a group, so read the whole list and pick the entry that is yours. If a token leaks, `/revoke` in BotFather replaces it.

**SMS via text.lk.** A Sri Lankan SMS gateway, so the sender shown to you is the gateway rather than a number of yours. Your number is still sent to text.lk as the recipient on every alert. Sign up at text.lk, create an API token in the dashboard (`TEXTLK_API_TOKEN`), and set `TEXTLK_RECIPIENT` to your number with the country code and no `+`. Trial credits get you started, after which it needs a paid top-up. Alerts are stripped of emoji and newlines before sending, which keeps a threshold alert to one cheap segment.

### 3. Test locally

Copy [`.env.example`](.env.example) to `.env`, fill it in, and let Node load it:

```bash
cp .env.example .env
# edit .env, then:
node --env-file=.env check.mjs --now
```

`.env.example` lists every variable and where its value comes from. `.env` is already in `.gitignore`; keep it that way.

**Single-quote your values in `.env`**, as in `SLT_PASSWORD='p@ss w$rd'`. Node strips the surrounding quotes and expands nothing inside them, so `$`, spaces, backticks and `#` survive intact. Unquoted, a `#` starts a comment and everything after it is dropped.

`--env-file` needs Node 20.6 or newer. On older Node you load the values yourself, and the usual recipe, `set -a && . ./.env && set +a`, carries a real hazard: `.` **executes the file as a shell script**, so a value containing a backtick or `$(...)` runs as a command while unquoted `$`, quotes and backslashes get mangled. Single-quote every value and treat the file as code you are running. Same for `export` lines typed by hand: single quotes, not double, since double quotes still expand `$` and backticks, and a literal single quote inside the value is written `'\''`.

A successful send prints `Sent via <channel> (manual --now):` and the message, so on the recommended path that reads `Sent via WhatsApp (Green API) (manual --now):`. If the channel rejects it, the script exits non-zero with the provider's own error text.

Running `node check.mjs` without `--now` does a normal threshold check and updates `state.json`, which it rewrites only when the recorded numbers have actually changed.

### 4. Push it to GitHub and add your credentials

Cloning your fork already set up `origin`, so pushing is just:

```bash
git push
```

In the repository, go to **Settings → Secrets and variables → Actions**. On the **Secrets** tab, use **New repository secret** to add:

- `SLT_USERNAME`
- `SLT_PASSWORD`
- `SLT_SUBSCRIBER_ID`
- `GREENAPI_API_TOKEN`
- `GREENAPI_CHAT_ID`

On Telegram instead, the last two become `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; on text.lk, `TEXTLK_API_TOKEN` and `TEXTLK_RECIPIENT`.

Three of the remaining settings are not sensitive, so the workflow reads them from the **Variables** tab on that same page instead: `GREENAPI_ID_INSTANCE`, `GREENAPI_API_URL` and `TEXTLK_SENDER_ID`. The workflow only ever reads those three from `vars`, so setting one as a secret means the script never receives the value at all. What that costs you differs per variable:

- `GREENAPI_ID_INSTANCE` arrives empty, so WhatsApp counts as unconfigured. The script quietly uses whatever other channel you have set, or exits 1 with `No notification channel configured` if there is no other.
- `GREENAPI_API_URL` and `TEXTLK_SENDER_ID` fall back to their built-in defaults (`https://api.green-api.com` and `TextLKDemo`). That is the quiet case: the demo sender id works, while Green API expects your instance's own numbered host, so the send can fail for a reason the log does not spell out.

Everything else goes in Secrets. The workflow at `.github/workflows/slt-check.yml` reads all of this and passes it to the script as environment variables. It declares `permissions: contents: read` and never writes to your repository.

### 5. Baseline it

Open the **Actions** tab.

**If you forked, enable Actions first.** GitHub disables workflows in a new fork. Instead of the workflow list you will see a banner reading "Workflows aren't being run on this forked repository", with a button labelled "I understand my workflows, go ahead and enable them". Click it: until you do there is no **Run workflow** button, and the cron schedule does not start either. A repository you created yourself, private or public, has Actions on already.

With Actions enabled, pick the **SLT data check** workflow and hit **Run workflow**. Leave the **Send current balances immediately** toggle off: this first run baselines silently and stores `state.json` in the Actions cache. From then on the cron schedule takes over and you only hear from it when a threshold is crossed. Turning that toggle on runs `--now`, the quickest way to confirm delivery from Actions rather than from your own machine.

**Read the log, not just the tick.** A green tick means the script exited 0, which is not the same as "your usage was checked": when SLT is unreachable it exits 0 on purpose, so a bad few minutes upstream does not fail the workflow and mail you about it. Open the run and read the log:

- `pkg: used=... milestone=...` followed by `First run: baselining main package, no alert.` means usage was fetched and the baseline is stored. This is the healthy run-one outcome.
- `Transient upstream issue, skipping this run` means green but nothing happened: SLT was not reachable, no usage was read and no state was saved. Run it again.
- A red cross with `Missing env vars` or `Login failed` means a credential is wrong or missing.

If a `--now` run prints `Sent via ...` but nothing reaches you, the send was accepted and the problem is past that point, usually a wrong chat id or recipient.

**Reset and start over.** To wipe the alert history and re-baseline: locally, `rm state.json`. On Actions, open **Actions → Caches** and delete **every** entry whose name starts with `myslt-state-`. The workflow saves each run under `myslt-state-<run id>-<attempt>` and restores by the `myslt-state-` prefix, so entries pile up and deleting only the newest just makes the next run restore the one behind it. To stop the tool, disable the **SLT data check** workflow from its page in the Actions tab or delete the repository, and rotate your MySLT password if you want the stored credentials to stop working.

## How often it checks

The workflow uses an escalating schedule that tracks the billing month, on the assumption that your quota resets near the 1st:

| Days of month | Requested cadence |
| --- | --- |
| 1 to 7 | every 6 hours |
| 8 to 14 | every 2 hours |
| 15 to 21 | hourly |
| 22 to end | every 15 minutes |

**Those day ranges are UTC.** GitHub runs cron in UTC and has no timezone setting, while Sri Lanka is UTC+05:30, so every tier boundary lands 5.5 hours into your day rather than at local midnight. The 15 minute tier, for example, starts at 05:30 on the 22nd local time. The same shift keeps that tightest tier running until 05:30 on the 1st, which is the useful direction to be wrong in. You could start a range a day earlier (`21-31` instead of `22-31`) to pull a boundary closer to local midnight, but be clear on what overlapping ranges do: cron has no precedence, so on the shared day **both** entries fire. The workflow's `concurrency: slt-check` group stops them running at the same time (GitHub queues the newer run and cancels any older pending one in the group), so the usual cost is wasted runs rather than duplicate alerts, but nothing makes the tighter tier replace the looser one.

**The tiers also assume your quota resets near the 1st.** Check yours: run `node check.mjs --now` and read the reset date on the package line, which comes straight from the `expiry_date` SLT reports. If your cycle turns over mid-month, do not expect to fix it by sliding the day numbers along. A window like `22-31` cannot shift cleanly, because it would have to wrap past a month end whose last day varies between 28 and 31, and cron has no notion of "day 22 of my billing cycle". Either accept the mismatch, or replace the four tiers with one flat cadence such as `0 */3 * * *`.

**Be realistic about the tight end of that table.** GitHub throttles high-frequency scheduled workflows, and on free accounts scheduled runs are best-effort, dropped entirely when the shared scheduler is busy. In practice the 15 minute tier runs far less often than every 15 minutes, sometimes closer to hourly, and individual runs can be skipped. That is a limitation of free cron on GitHub, not something this script can fix. If you want more control over timing, run `check.mjs` from your own cron on a machine that is always on: a scheduler you own rather than one you share, though only as reliable as that machine and its network.

One more GitHub behaviour worth knowing: scheduled workflows in a public repository get disabled automatically after 60 days without repository activity. If alerts stop for no obvious reason, open the Actions tab and re-enable the workflow.

### Running it from your own cron instead

If you have a machine that stays on, a Raspberry Pi, a home server, a small VPS, its cron runs in your own timezone and is not competing with everyone else's scheduled workflows. Nothing about the script changes: put your values in a `.env` next to `check.mjs` as in part 3, then add a crontab line with `crontab -e`.

```cron
*/30 * * * * cd /home/you/myslt-alerts && /usr/bin/node --env-file=.env check.mjs >> cron.log 2>&1
```

On Node older than 20.6 there is no `--env-file`. Sourcing `.env` from the crontab line carries the hazard described in part 3, made worse by cron running the line through `/bin/sh` rather than your usual shell, so the cleanest fix is to update Node. Failing that, point cron at a small wrapper script you control: `chmod 700` it, single-quote every value, `export` them, then `exec` node.

Three things that catch people out. Cron runs with a bare `PATH`, so give the absolute path to Node from `which node`; a version manager like nvm puts it somewhere cron will not find on its own. Redirect output to a log, as above, or you will have no idea whether it ran. And `chmod 600 .env`, since the credentials now sit on a machine you share with other processes.

The tiered schedule works here too: the four `cron:` lines from the workflow are already standard crontab syntax, so paste them in with the same command, minus the `- cron:` prefix and the quotes. State is simpler on your own machine, since `check.mjs` writes `state.json` beside itself and it stays there, with no cache to lose.

## Configuration

Required for every setup:

| Variable | What it is |
| --- | --- |
| `SLT_USERNAME` | Your MySLT login, usually an email address. |
| `SLT_PASSWORD` | Your MySLT password. |
| `SLT_SUBSCRIBER_ID` | Your telephone number in `94XXXXXXXXX` form. |

Then pick one notification channel and set its variables:

| Channel | Variables | Notes |
| --- | --- | --- |
| WhatsApp via Green API (recommended) | `GREENAPI_ID_INSTANCE`, `GREENAPI_API_TOKEN`, `GREENAPI_CHAT_ID`, `GREENAPI_API_URL` | The best tested channel here, and the only one with a delivery confirmed end to end. Read the two drawbacks in [part 2](#2-set-up-whatsapp-via-green-api) first: 3 chat contacts a month on the free tier, and your real WhatsApp account linked as a device. `GREENAPI_API_URL` defaults to `https://api.green-api.com`, but your instance has its own numbered host in the form `https://NNNN.api.greenapi.com`, shown in the Green API console. `GREENAPI_CHAT_ID` is a number with country code and no `+`; the `@c.us` suffix is added for you if you leave it off. |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Official API, free, no cap on recipients, no account of yours linked as a device. Delivery not yet confirmed in this project. |
| SMS via text.lk | `TEXTLK_API_TOKEN`, `TEXTLK_RECIPIENT`, `TEXTLK_SENDER_ID` | Sri Lanka only. `TEXTLK_RECIPIENT` is your number with country code and no `+`. `TEXTLK_SENDER_ID` defaults to `TextLKDemo`, which works immediately; swap in your own once it is approved. Delivery not yet confirmed in this project. |

Set exactly one channel group. If you configure several, the script still sends through a single channel, picked by the `PRECEDENCE` array in `check.mjs`: SMS first, then WhatsApp, then Telegram. It does not fan out to all of them.

On GitHub Actions, `GREENAPI_ID_INSTANCE`, `GREENAPI_API_URL` and `TEXTLK_SENDER_ID` are read from repository **variables**, not secrets; part 4 covers what breaks if you set one as a secret. A variable you never created arrives as an empty string rather than as unset, but `check.mjs` resolves both defaulted values with `||`, so the defaults above for `GREENAPI_API_URL` and `TEXTLK_SENDER_ID` apply on Actions exactly as they do locally. Green API still needs your instance's own numbered host, so set that one explicitly anyway.

### Channel notes

Where each channel actually stands, plainly. **WhatsApp via Green API is the only one whose delivery is proven end to end**, and it is the best tested path here. **Telegram and SMS via text.lk are supported and their code is in `check.mjs`, but no delivery through either has been confirmed.** They are expected to work. Nobody has watched them work.

**WhatsApp via Green API (recommended).** Setup is in [part 2](#2-set-up-whatsapp-via-green-api) of the setup, including the two drawbacks: the free Developer tier caps at 3 distinct chat contacts per month, and it links your real WhatsApp account as a linked device, which WhatsApp's anti-abuse systems can flag a number for, especially after repeated re-linking. A flagged number can stay unusable for weeks, so scan the QR once and leave it. Keep WhatsApp active on the phone, since Green API rides that linked session, and treat `GREENAPI_API_TOKEN` as a credential.

**Telegram.** The alternative to pick if either Green API drawback matters to you: official API, free, no recipient cap, and nothing of yours linked as a device. The cost is that you would be the first to exercise its delivery path here. Setup is under [Other channels](#other-channels). Treat the bot token as a credential: keep it out of browser URLs, and `/revoke` it in BotFather if it leaks.

**SMS via text.lk.** A Sri Lankan SMS gateway, so the sender shown is the gateway rather than a number of yours, though text.lk still receives your number as the recipient. Sign up, create an API token in the dashboard, and set your recipient number. You get trial credits to start, after which you need a paid top-up. Alerts are stripped of emoji and newlines before sending so a threshold alert stays a single cheap segment. Nothing truncates a long message, so a `--now` snapshot with several buckets on it can run to more than one. Note that it sits first in the precedence order, so if you leave it configured next to another channel it is the one that sends.

## Tuning

The alert thresholds are constants at the top of `check.mjs`:

| Constant | Default | Effect |
| --- | --- | --- |
| `MAIN_STEP_GB` | `5` | Normal alert spacing on the main package, in GB used. |
| `MAIN_TAIL_GB` | `10` | Where the danger zone begins, counted back from your limit (`limit - MAIN_TAIL_GB`). Inside it the spacing tightens to `MAIN_TAIL_STEP_GB` and the messages switch to the LOW wording, so changing it changes alert frequency, not just wording. |
| `MAIN_TAIL_STEP_GB` | `1` | Alert spacing once you are inside that danger zone. |
| `ADDON_STEP_GB` | `10` | Alert spacing on the add-on (VAS) bundle, in GB used. |

**These are compared against the raw numbers SLT returns, on the assumption that they are GB.** `GB` is the only `volume_unit` seen on any account so far, and the messages print whatever unit the API reports, but the thresholds themselves do no conversion. An account that reported MB would get an alert every 5 MB while this table still said 5 GB.

Want a quick test message without waiting to burn 5 GB? Use `node check.mjs --now` instead of editing constants, since changing a constant also changes how `state.json` is interpreted on the next run.

Check frequency lives in the `cron` lines of `.github/workflows/slt-check.yml`. Delete the tiers you do not want. Forcing a clean baseline is covered in part 5 of the setup.

## Troubleshooting

**"Login failed"** means the login call came back without an `accessToken`. Check `SLT_USERNAME` first, since it is the MySLT portal login, usually an email address, not the `94...` telephone number (that is `SLT_SUBSCRIBER_ID`). It is equally often a wrong password, a password mangled by shell quoting (see part 3), an account locked after repeated failures, or a change on SLT's side. The error includes SLT's own message when they return one, so read that before guessing.

**"SLT API unreachable after 3 tries"** means every attempt failed or looked transient. SLT's gateway is the most common cause, since it returns `500` responses carrying `URL Open error`, but DNS failure, blocked outbound network from wherever you run it, a rotated `X-IBM-Client-Id` or a changed response shape all land here too. The script tries three times (two retries, backing off 2 seconds then 4) and then exits **successfully** with `Transient upstream issue, skipping this run`, so a bad five minutes at SLT does not fail your workflow or fill your inbox. The trade-off is a green run in which nothing was checked. If it repeats for a day or more, stop assuming SLT.

**"Usage fetch failed"** means the API answered but reported `isSuccess: false`. The reason is in the response field `errorMessege`, spelled that way by SLT and left alone in this project so it keeps matching the real payload. Check that `SLT_SUBSCRIBER_ID` is your full telephone number in `94XXXXXXXXX` form.

**Nothing runs, and there is no Run workflow button.** You are on a fork with Actions still disabled. See part 5 of the setup.

**No messages at all.** Read the run log rather than the tick, using the three cases listed in part 5. A healthy quiet run prints a `pkg: used=...` line (proof the usage call succeeded) followed by either `First run: baselining main package, no alert.` or `No new threshold crossed.` Run `node check.mjs --now` to test the delivery path on its own.

**Telegram returns "chat not found".** You have not messaged the bot yet, or `TELEGRAM_CHAT_ID` is wrong. Send the bot a message and re-check the chat id.

**Green API sends nothing.** Check that `GREENAPI_ID_INSTANCE` is a repository **variable** and not a secret: the workflow reads it only from `vars`, so as a secret it reaches the script empty and the WhatsApp channel is treated as unconfigured. `GREENAPI_API_URL` set as a secret fails differently, falling back to the generic host instead of your instance host. Then check `getStateInstance`. If it does not say `authorized`, the linked device has dropped and needs the QR scanned again.

**One alert never arrived, then everything carried on normally.** Most likely the Actions cache holding `state.json` was evicted, so that run re-baselined instead of alerting. A one-off is not worth chasing; if it keeps happening, your repository's caches are being evicted often, and running from your own cron removes the cache from the picture entirely.

**Alerts stopped after a couple of months, or nothing arrives at the tightest tier.** Both are GitHub scheduling behaviours covered in the schedule section: workflows are disabled in inactive public repositories, and free cron is best-effort.

## How this works

This API is undocumented. SLT's own web portal calls it, and the gateway client id those calls carry is served publicly in SLT's web bundle. What follows is a description of the two calls this tool makes and of what they return.

1. `POST https://omniscapp.slt.lk/slt/ext/api/Account/Login` with a form-encoded `username`, `password` and `channelID=WEB`, which returns an `accessToken`.
2. `GET https://omniscapp.slt.lk/slt/ext/api/BBVAS/UsageSummary?subscriberID=<id>` with that token as a bearer, which returns your quota buckets.

Both calls also carry the header `X-IBM-Client-Id`, an IBM API Connect gateway key. SLT's own public web bundle serves that value to any visitor who has not logged in, and it carries no account identifier, so it reads as an application key rather than a per-user secret, though that reading is an inference rather than something tested. SLT can rotate it whenever they like, and both it and the base path appear to have changed at least once before.

Things in the response that catch people out:

- The volume figures are **strings**, so `"used": "25.0"` needs `parseFloat`, while some other fields in the same body are real JSON numbers. Do not assume either.
- `my_package_summary` is your main monthly quota and `vas_data_summary` is an add-on bundle bought on top. `bonus_data_summary`, `free_data_summary` and `extra_gb_data_summary` are further buckets that many accounts do not have at all. Every bucket except the main package can come back `null`, so handle that.
- The `percentage` field appears to track the share **remaining**, not the share used. In the sample, 75 GB left of 100 GB reported `75`, where used would have been 25.

Full request and response documentation, including the complete response body with its structure exactly as returned (values replaced with synthetic ones) and the field-by-field notes, is in [`docs/myslt-api.md`](docs/myslt-api.md).

## Caveats and risks

Read this part before you set it up.

- **This uses an undocumented API.** SLT does not publish it, does not support it, and has not promised it will keep working. It is the same API the MySLT web portal calls, and this tool uses it to read your own account with your own credentials.
- **SLT can break it at any time.** The most likely breakage is a rotated `X-IBM-Client-Id`, which stops every caller at once. That has happened before, along with a change of base path. If it happens again, the fix is to set `CLIENT_ID` in `check.mjs` to whatever value SLT's web bundle serves at that point. Endpoint paths and field names can change too.
- **Your MySLT password is stored as a GitHub Actions secret.** GitHub encrypts secrets at rest and only exposes them to workflow runs in the repository they belong to. It also attempts to redact them from logs, but treat that as best-effort string matching rather than a security boundary: a secret that is transformed before printing, re-encoded (base64, URL encoding) or split across output can appear unmasked, and any step in the job can read the environment it is handed. What you are doing is handing your ISP account password to a third-party CI system so a script can log in as you.

  It is not only admins who can reach those secrets. Anyone who can modify a workflow or a source file on the branch the workflow runs on can print or exfiltrate them, as can a compromised account with that access, or a third-party action whose mutable tag is repointed at new code. So: keep write access to yourself, turn on 2FA, read the diff before syncing an upstream update into your copy, and remember that every action the workflow calls (`actions/checkout`, `actions/setup-node`, `actions/cache`) runs code you did not write with access to that same environment. Pinning them to a commit SHA rather than a `@v4` tag removes the mutable-tag part. If none of that sits well, run `check.mjs` from your own machine or a small VPS with the credentials in a local file instead. [`SECURITY.md`](SECURITY.md) goes through where the credentials sit, what they are sent to, what lands on disk, and what to do if you leak one.
- **Do not commit credentials.** Keep `.env` gitignored. Nothing produced at run time needs committing either: `state.json` is written beside the script locally and kept in the build cache on Actions.
- **The MySLT numbers are as fresh as SLT makes them.** The response carries a `reported_time`, and SLT updates usage on their own cadence, so the figures can lag your real usage.
- **The response semantics here rest on a single account and a single captured response.** Other package types may expose buckets this project has not seen, so a field can behave differently on your connection.
- **This project is not affiliated with, endorsed by, or connected to Sri Lanka Telecom in any way.** It is an unofficial tool for reading your own account. Use it on accounts you own, at your own risk.
- **Where this stands on terms of service and on courtesy to SLT** is set out in the [Legal and ethical note](docs/myslt-api.md#legal-and-ethical-note), which is worth reading once before you run this.

## Tests

The logic that does not touch the network (milestone stepping, bucket parsing) is covered by a
test suite using Node's built-in runner, so there is nothing to install:

```bash
npm test              # or: node --test test/*.test.mjs
```

CI runs the same suite on Node 18, 20 and 22 on every push and pull request. It needs no secrets
and makes no network calls, so it also runs on forks.

## Contributing

Issues and pull requests are welcome, especially reports of SLT changing something on their side or of a package type whose buckets behave differently. It is one source file, no dependencies and no build step, so there is not much to learn first. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers getting a test run going, reporting an API change, adding a notification channel, and what to redact before you paste a response body into an issue.

Security reports have their own route, in [`SECURITY.md`](SECURITY.md).

## Licence

MIT.
