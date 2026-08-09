# Security

This tool needs your real MySLT login to work, so it is fair to want to know exactly where
those credentials go. This page covers where they are stored, what touches them, and what the
script writes to disk.

## Where your credentials live

When you run it on GitHub Actions, `SLT_USERNAME`, `SLT_PASSWORD` and `SLT_SUBSCRIBER_ID` are
stored as GitHub Actions encrypted secrets. GitHub encrypts them at rest, exposes them to the
workflow only as environment variables at run time, and does not show them back to you in the
UI once saved. The workflow file references them as `${{ secrets.SLT_PASSWORD }}` and similar,
so the values themselves do not appear in the repository.

GitHub also masks registered secret values in workflow logs, replacing them with `***` when it
recognises them. Treat that as best-effort string matching rather than a boundary: a value that is
re-encoded, split across lines or otherwise transformed before it is printed can come through
unmasked, and anything you set as a repository variable rather than a secret is not masked at all.

`check.mjs` prints no credential directly. On a normal run it prints usage numbers, the milestone
it is tracking, and the message it sent. Two things it can print are not text it wrote itself.
When a request fails, the error carries the response body it received rather than the request it
sent. And if `GREENAPI_API_URL` is set to something that is not a valid absolute URL, the send URL
built from it cannot be parsed, and the error Node raises for that can include the URL it tried to
parse, which holds your Green API instance id and token. See
[Known limitations](#known-limitations) for what both mean on a public repository.

If you run the script on your own machine instead, the credentials come from your shell
environment or a local `.env` file. `.env` is gitignored. Keep it that way.

## Where your credentials go

The script sends your MySLT username and password to one host: SLT's own API host,
`omniscapp.slt.lk`, over HTTPS. That is the same backend the MySLT web portal uses. The login
response returns an access token, and that token is sent back to the same host to read your usage.
No other part of the script reads your username, password or token, and none of the three is
written to `state.json`. Worth being precise about what "one host" covers: that host is fronted by
an API gateway, which is what the `X-IBM-Client-Id` header is for, so whoever operates that
gateway for SLT is in the path along with SLT.

Your notification provider receives the alert text and more besides. The text itself is narrow: a
message looks like "SLT data: 42.5 GB remaining (of 100 GB)", and it carries no credentials, no
subscriber ID and no account number. Around that text the provider necessarily also receives the
credential you authenticate with (its own API token, which is scoped to that provider and is not
sent to SLT), the recipient or chat id you are sending to, and the ordinary metadata of an HTTPS
request: the source IP of the runner, the timing, and whatever else its own logging keeps. The
provider holds the plaintext of every alert, because the script hands it the text through its API.

The script talks to one provider per run: `pickChannel` takes the first configured channel in the
order SMS, WhatsApp, Telegram, and sends only through that one. Your provider is not the end of
the chain, though. On two of the three channels delivery carries the text further. A WhatsApp
message goes through WhatsApp itself, since the Green API instance is a linked device on a real
account. An SMS is handed to the mobile networks that carry it to your handset. Only on Telegram
does the alert stop with the provider you configured. Two of the three talk to a hardcoded host
over HTTPS. The Green API host is configurable, so that one goes wherever you point it:

- **WhatsApp via Green API.** `api.green-api.com` by default, or whatever you set in
  `GREENAPI_API_URL`. The script uses that value as given: it does not check the scheme or the
  hostname, so what it actually guarantees is that it sends to the host you configured, Green API
  or not. Your instance id and instance token travel in the request path, so they go to that host
  too. See [Known limitations](#known-limitations).
- **Telegram.** `api.telegram.org`, hardcoded, with the bot token in the request path.
- **SMS via text.lk.** `app.text.lk`, hardcoded, with the API token as a query parameter. Query
  strings are the part of a URL most likely to be written to a proxy or server log, so treat that
  token as the easiest of the three to lose and rotate it if you have any doubt.

Green API deserves one extra note, because it is the channel most people here end up using.
It works by linking a real WhatsApp account to the instance as a linked device, the same
mechanism WhatsApp Web uses. Anyone holding that instance id and token can send WhatsApp
messages as that account, which is a good deal more than a token that can only post into one
chat. Use a number you are happy to dedicate to the bot, keep `GREENAPI_API_TOKEN` and
`GREENAPI_CHAT_ID` in Actions secrets rather than repository variables, and scan the linking QR
once rather than repeatedly, since repeated re-linking is what draws attention from WhatsApp's
anti-abuse systems.

The `X-IBM-Client-Id` value in the source does not appear to be a secret. It is the web client
key the MySLT portal itself sends on every request.

## What is written to disk

`state.json` is the only file the script writes. It holds aggregate usage figures only:

- the amount used, the package limit, the amount remaining, and the unit SLT reported them in
- the highest main-package milestone reached so far
- an add-on bundle's limit, usage, and highest milestone reached, if you have one
- a timestamp

There are no credentials, tokens, subscriber IDs, account numbers or phone numbers in it.

On GitHub Actions, `state.json` is carried between runs in the Actions cache. The workflow
requests `contents: read` only and does not commit it, so on a public repository your usage
figures are not written into the repository and are not browsable on the repository page. A cache
is not a confidentiality boundary, though: workflow code in the repository can restore that entry
and read it, and a workflow change that gets run can print it to the log or send it somewhere
else. Treat the state as private operational data sitting with your CI rather than as secret
storage.

Locally the file is written next to the script and is gitignored by default, because it reveals
roughly how much data you use and that is rarely something you want in a public fork. You can
still open the file to inspect it. If you would rather track it, remove the `state.json` line from
`.gitignore`.

## Known limitations

These are known gaps that are documented rather than fixed. The published code is kept identical
to the configuration it was tested on and is running against, so hardening beyond what is
described here is left to the forker to apply.

**The Green API host is not validated.** `GREENAPI_API_URL` is a repository variable rather than
a secret, and `sendGreenApi` builds the send URL straight from it. That URL carries your instance
id and your API token, and the request body carries your chat id. Nothing checks the scheme or
the hostname first. If the variable is ever set to a host you do not control, the next alert
hands that host your Green API token, your instance id and your chat id, which is enough to send
WhatsApp messages as the account linked to your instance. The realistic impact is low: you set
this once and rarely touch it again, and it is a variable rather than a secret precisely because
the value itself is not sensitive. Fix, if you want it: require `https`, allowlist the official
Green API hostnames before building the URL, and set `redirect: "error"` on the send so a
redirect cannot move the credential-bearing request to a different host.

**Error paths can log raw response bodies.** Several failure paths serialize a whole response into
the message they print, and on a public repository Actions logs are public. A failed login prints
SLT's error message or the login response. A usage call that comes back unsuccessful prints SLT's
error message or the response, and a usage response the script cannot parse prints the entire data
bundle for your account. A rejected send prints the first 200 characters of what your notification
provider returned. The same catch prints the message of any other error, which is the route by
which a malformed `GREENAPI_API_URL` can put the built send URL in the log. So there is no path on
which the log is guaranteed to be free of your account data, and the bodies come from an
undocumented API that can change what it returns without notice. Fix: log the HTTP status and a
fixed error label instead of the body, or keep the repository private.

**Alerts are not guaranteed to be sent exactly once.** State is saved only after every queued
message for the run has been sent. If a main-package alert is delivered and an add-on alert
immediately after it throws, the run exits before either milestone is written, so the next run
re-sends the one that already arrived. The same happens if a provider accepts a message but its
response is lost in transit. Duplicates are therefore possible on a partial send failure. They
cost you a repeated message rather than an alert you never got, which is the better direction for
this to fail in, so it is documented rather than fixed. Fix, if you want it: save each milestone
as its own send succeeds instead of saving once at the end.

**Thresholds are numbers without a unit.** `bucket()` keeps whatever `volume_unit` SLT reports and
converts nothing, and the values it is then compared against (`MAIN_STEP_GB`, `MAIN_TAIL_GB`,
`MAIN_TAIL_STEP_GB`, `ADDON_STEP_GB`, and the literal 5 that decides whether a drop in usage counts
as a quota reset) are plain numbers assumed to be gigabytes. The unit reaches the message text and
`state.json`, never the comparison. `"GB"` is the only value observed so far, so the numbers line
up in practice, but a bucket reported in MB would be alerted on every 5 MB while this
documentation still said 5 GB. [docs/myslt-api.md](docs/myslt-api.md) tells readers to honour
`volume_unit`; the client here does not. Fix: normalise every bucket to a single unit inside
`bucket()` before any threshold is applied.

**GitHub Actions are pinned to mutable tags.** The workflow uses `@v4` for `actions/checkout`,
`actions/setup-node` and `actions/cache`. A tag is a pointer and can be repointed by whoever
controls the action's repository. A compromised action running in the same job is in a position
to read what that job handles, including the environment given to the usage step, which carries
your MySLT password. Fix: pin each action to a full commit SHA instead of a tag.

**No request timeouts.** None of the network calls set a deadline, so a connection that stalls
rather than fails can hang a run until the job's own limit ends it. The retry loop does not cover
this, because it only retries once a request has finished or errored. Fix: pass
`signal: AbortSignal.timeout(...)` on each fetch.

**The default schedule is busier than the API guidance.** The escalating cron in
`.github/workflows/slt-check.yml` tightens to every 15 minutes from day 22 to the end of the
month, which is more often than [docs/myslt-api.md](docs/myslt-api.md) itself suggests (once or a
few times a day). GitHub drops scheduled runs under load, so the real rate is lower than the cron
implies, but if you would rather be polite to SLT's infrastructure, flatten the schedule to
something calmer. A single cron running a few times a day still tells you when you have crossed a
threshold, since the upstream figures only refresh periodically anyway. What a calmer schedule
costs you is granularity rather than the alert: a run that finds several milestones already passed
sends one message for where you are now, not one per milestone, and the tail tightens to every
1 GB, so the fewer the runs the more of those get collapsed into a single message.

## If you leak a credential

If your MySLT password ever ends up somewhere public, such as an issue, a screenshot, a paste
site, a commit, or a workflow log from a fork, treat it as compromised:

1. Change your MySLT password in the MySLT app or portal immediately.
2. Update the `SLT_PASSWORD` secret in your repository settings to the new value.
3. Delete the public copy. Note that deleting an issue comment or force pushing a commit does
   not reliably erase it, so changing the password is the step that actually matters.

Do the same for notification tokens: revoke and reissue the Telegram bot token via BotFather,
or regenerate the token in your Green API or text.lk dashboard. Then update the matching
repository secret, because the script keeps sending the old value until you do. A leaked Green
API token is the one to deal with first, since it can send WhatsApp messages as the account you
linked to that instance.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

Use GitHub Security Advisories: go to the **Security** tab of
[github.com/ri7in/myslt-alerts](https://github.com/ri7in/myslt-alerts), choose **Report a
vulnerability**, and file a private advisory. That creates a private thread visible only to
you and the maintainer, and it lets a fix ship before the details are public.

Helpful things to include: what an attacker could do, the steps to reproduce it, and the
version or commit you tested. Redact any real credentials from your report as well.

Expect a first response within a few days. This is a small project maintained by one person in
their spare time, so please be patient. Fixes for anything that exposes credentials will be
prioritised over everything else.

## Scope

In scope: anything in this repository that could expose your MySLT credentials, your
notification tokens, or your account details. Examples include credentials leaking into logs
or into `state.json`, credentials being sent to an unintended host, or the suggested workflow
configuration exposing secrets to untrusted code. Anything already listed under
[Known limitations](#known-limitations) is known, so a report that restates one of those is not a
new finding, though a concrete exploit that goes beyond what is written there is.

Out of scope: vulnerabilities in SLT's own systems, and vulnerabilities in third party
notification providers. Report those to the vendor concerned. Unofficial API endpoints changing
or breaking is a bug, not a security issue, so use the normal issue tracker for that.
