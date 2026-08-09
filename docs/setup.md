# Setup

How to get myslt-alerts running on your own account, from nothing to a baselined workflow, plus
the full configuration reference and the risks worth reading before you start.

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

**Want a private repository instead?** You are about to store your ISP password in it as a secret (see [Caveats and risks](#caveats-and-risks) and [`SECURITY.md`](../SECURITY.md)), and a fork of a public repository is always public, with no way to flip it to private. Take a copy of the files instead, either by cloning and dropping the git history:

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

Copy [`.env.example`](../.env.example) to `.env`, fill it in, and let Node load it:

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

On GitHub Actions, `GREENAPI_ID_INSTANCE`, `GREENAPI_API_URL` and `TEXTLK_SENDER_ID` are read from repository **variables**, not secrets; [part 4](#4-push-it-to-github-and-add-your-credentials) covers what breaks if you set one as a secret. A variable you never created arrives as an empty string rather than as unset, but `check.mjs` resolves both defaulted values with `||`, so the defaults above for `GREENAPI_API_URL` and `TEXTLK_SENDER_ID` apply on Actions exactly as they do locally. Green API still needs your instance's own numbered host, so set that one explicitly anyway.

### Channel notes

Where each channel actually stands, plainly. **WhatsApp via Green API is the only one whose delivery is proven end to end**, and it is the best tested path here. **Telegram and SMS via text.lk are supported and their code is in `check.mjs`, but no delivery through either has been confirmed.** They are expected to work. Nobody has watched them work.

**WhatsApp via Green API (recommended).** Setup is in [part 2](#2-set-up-whatsapp-via-green-api) of the setup, including the two drawbacks: the free Developer tier caps at 3 distinct chat contacts per month, and it links your real WhatsApp account as a linked device, which WhatsApp's anti-abuse systems can flag a number for, especially after repeated re-linking. A flagged number can stay unusable for weeks, so scan the QR once and leave it. Keep WhatsApp active on the phone, since Green API rides that linked session, and treat `GREENAPI_API_TOKEN` as a credential.

**Telegram.** The alternative to pick if either Green API drawback matters to you: official API, free, no recipient cap, and nothing of yours linked as a device. The cost is that you would be the first to exercise its delivery path here. Setup is under [Other channels](#other-channels). Treat the bot token as a credential: keep it out of browser URLs, and `/revoke` it in BotFather if it leaks.

**SMS via text.lk.** A Sri Lankan SMS gateway, so the sender shown is the gateway rather than a number of yours, though text.lk still receives your number as the recipient. Sign up, create an API token in the dashboard, and set your recipient number. You get trial credits to start, after which you need a paid top-up. Alerts are stripped of emoji and newlines before sending so a threshold alert stays a single cheap segment. Nothing truncates a long message, so a `--now` snapshot with several buckets on it can run to more than one. Note that it sits first in the precedence order, so if you leave it configured next to another channel it is the one that sends.

## Caveats and risks

Read this part before you set it up.

- **This uses an undocumented API.** SLT does not publish it, does not support it, and has not promised it will keep working. It is the same API the MySLT web portal calls, and this tool uses it to read your own account with your own credentials.
- **SLT can break it at any time.** The most likely breakage is a rotated `X-IBM-Client-Id`, which stops every caller at once. That has happened before, along with a change of base path. If it happens again, the fix is to set `CLIENT_ID` in `check.mjs` to whatever value SLT's web bundle serves at that point. Endpoint paths and field names can change too.
- **Your MySLT password is stored as a GitHub Actions secret.** GitHub encrypts secrets at rest and only exposes them to workflow runs in the repository they belong to. It also attempts to redact them from logs, but treat that as best-effort string matching rather than a security boundary: a secret that is transformed before printing, re-encoded (base64, URL encoding) or split across output can appear unmasked, and any step in the job can read the environment it is handed. What you are doing is handing your ISP account password to a third-party CI system so a script can log in as you.

  It is not only admins who can reach those secrets. Anyone who can modify a workflow or a source file on the branch the workflow runs on can print or exfiltrate them, as can a compromised account with that access, or a third-party action whose mutable tag is repointed at new code. So: keep write access to yourself, turn on 2FA, read the diff before syncing an upstream update into your copy, and remember that every action the workflow calls (`actions/checkout`, `actions/setup-node`, `actions/cache`) runs code you did not write with access to that same environment. Pinning them to a commit SHA rather than a `@v4` tag removes the mutable-tag part. If none of that sits well, run `check.mjs` from your own machine or a small VPS with the credentials in a local file instead. [`SECURITY.md`](../SECURITY.md) goes through where the credentials sit, what they are sent to, what lands on disk, and what to do if you leak one.
- **Do not commit credentials.** Keep `.env` gitignored. Nothing produced at run time needs committing either: `state.json` is written beside the script locally and kept in the build cache on Actions.
- **The MySLT numbers are as fresh as SLT makes them.** The response carries a `reported_time`, and SLT updates usage on their own cadence, so the figures can lag your real usage.
- **The response semantics here rest on a single account and a single captured response.** Other package types may expose buckets this project has not seen, so a field can behave differently on your connection.
- **This project is not affiliated with, endorsed by, or connected to Sri Lanka Telecom in any way.** It is an unofficial tool for reading your own account. Use it on accounts you own, at your own risk.
- **Where this stands on terms of service and on courtesy to SLT** is set out in the [Legal and ethical note](myslt-api.md#legal-and-ethical-note), which is worth reading once before you run this.
