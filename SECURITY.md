# Security

This tool needs your real MySLT login to work, so it is fair to want to know exactly where
those credentials go. This page covers where they are stored, what touches them, and what the
script writes to disk.

## Where your credentials live

When you run it on GitHub Actions, `SLT_USERNAME`, `SLT_PASSWORD` and `SLT_SUBSCRIBER_ID` are
stored as GitHub Actions encrypted secrets. GitHub encrypts them at rest, exposes them to the
workflow only as environment variables at run time, and does not show them back to you in the
UI once saved. The workflow file references them as `${{ secrets.SLT_PASSWORD }}` and similar,
so the values themselves never appear in the repository.

GitHub also masks registered secret values in workflow logs, replacing them with `***` if they
would otherwise be printed. On top of that, `check.mjs` never logs credentials itself. It
prints usage numbers, the threshold it is tracking, and the message it sent. When a request
fails it prints the response body it received, not the request it sent.

If you run the script on your own machine instead, the credentials come from your shell
environment or a local `.env` file. `.env` is gitignored. Keep it that way.

## Where your credentials go

Your MySLT username and password are sent to exactly one place: SLT's own API host,
`omniscapp.slt.lk`, over HTTPS. That is the same backend the MySLT web portal uses. The login
response returns an access token, and that token is sent back to the same host to read your
usage. Nothing else in the script ever sees your MySLT username, password, or token.

Your notification provider receives the alert text and nothing more. A message looks like
"SLT data: 42.5 GB remaining (of 100 GB)". It contains no credentials, no subscriber ID and no
account number. Naturally, the provider you chose also receives its own API token, because
that is how you authenticate to it, but that token is scoped to that provider and is never
sent to SLT.

There are three channels, and the one you configured is the only third party your alert text
reaches. Each talks to a single host over HTTPS:

- **WhatsApp via Green API.** `api.green-api.com` by default, or the numbered instance host you
  set in `GREENAPI_API_URL`. Your instance id and instance token travel in the request path.
- **Telegram.** `api.telegram.org`, with the bot token in the request path.
- **SMS via text.lk.** `app.text.lk`, with the API token as a query parameter. Query strings are
  the part of a URL most likely to be written to a proxy or server log, so treat that token as
  the easiest of the three to lose and rotate it if you have any doubt.

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

- gigabytes used, the package limit, gigabytes remaining, and the unit they are in
- the last alert threshold that was crossed
- an add-on bundle's limit, usage, and last crossed threshold, if you have one
- a timestamp

There are no credentials, tokens, subscriber IDs, account numbers or phone numbers in it.

On GitHub Actions, `state.json` is carried between runs in the Actions cache. The workflow
requests `contents: read` only and never commits anything, so running this on a public
repository does not publish your usage figures. Locally the file is written next to the script
and is gitignored by default, because it reveals roughly how much data you use and that is
rarely something you want in a public fork. You can still open the file to inspect it. If you
would rather track it, remove the `state.json` line from `.gitignore`.

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
configuration exposing secrets to untrusted code.

Out of scope: vulnerabilities in SLT's own systems, and vulnerabilities in third party
notification providers. Report those to the vendor concerned. Unofficial API endpoints changing
or breaking is a bug, not a security issue, so use the normal issue tracker for that.
