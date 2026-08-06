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

The `X-IBM-Client-Id` value in the source is not a secret. It is the fixed public web client
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
and is left untracked rather than gitignored, so you can inspect it. It does reveal roughly how
much data you use, so if that bothers you, add `state.json` to your own `.gitignore` and take
care not to commit it by hand.

## If you leak a credential

If your MySLT password ever ends up somewhere public, such as an issue, a screenshot, a paste
site, a commit, or a workflow log from a fork, treat it as compromised:

1. Change your MySLT password in the MySLT app or portal immediately.
2. Update the `SLT_PASSWORD` secret in your repository settings to the new value.
3. Delete the public copy. Note that deleting an issue comment or force pushing a commit does
   not reliably erase it, so changing the password is the step that actually matters.

Do the same for notification tokens: revoke and reissue the Telegram bot token via BotFather,
or regenerate the token in your Green API or text.lk dashboard. A leaked `WEBHOOK_URL` is worth
treating the same way, since the URL is the only thing standing between a stranger and your
channel. Rotate it at the service that issued it.

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
