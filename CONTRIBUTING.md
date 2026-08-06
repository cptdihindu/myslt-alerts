# Contributing

Thanks for looking at this. The project is deliberately small: one source file (`check.mjs`) plus its tests, no
dependencies, no build step. That makes it easy to contribute to and easy to review, so
please do not feel you need to be an expert on the MySLT portal to help.

## Getting set up

You need Node 18 or newer (the script uses the built-in `fetch`) and a MySLT account to
test against.

```bash
git clone https://github.com/ri7in/myslt-alerts.git
cd myslt-alerts
cp .env.example .env    # fill in your own values
```

`check.mjs` reads plain environment variables and does not parse `.env` itself, so load the
file before running:

```bash
# Node 20.6 and newer
node --env-file=.env check.mjs --now

# any Node 18+
set -a && . ./.env && set +a && node check.mjs --now
```

`--now` sends your current usage immediately and ignores the saved thresholds, so it is the
quickest way to confirm a change works end to end.

## Reporting a MySLT API change

This is by far the most likely thing to break, so it gets its own issue template. `check.mjs`
calls the same private endpoints the MySLT web portal calls. SLT can rename a field, move an
endpoint, or change the auth handshake at any time, and the script has no way to know in
advance.

Symptoms usually look like one of these:

- `Login failed: ...` from the login step
- `Usage fetch failed: ...` when the usage response no longer reports success
- `Could not parse main package usage from response: ...` when the numbers moved to different
  field names

Open an issue using the **MySLT API change** template and include the error text plus the
raw response body you got back. The response body is the single most useful thing you can
attach, because it normally shows the renamed field immediately. Redact it first (see below).

## Adding a notification channel

All the sending logic lives in one place. Follow the shape of the existing senders:

1. Read the new channel's config from the destructured `process.env` block near the top of
   `check.mjs`.
2. Write a `send<Channel>(text)` function modelled on `sendTelegram`. Keep the contract the
   existing ones use: take a plain string, `throw` with a short slice of the provider's
   response on failure, and return the response body on success.
3. Add an entry to the `channels` object with the three keys the existing ones have: `ready`,
   a boolean that is true only when every variable your channel needs is set; `label`, the name
   printed in the `Sent via ...` log line; and `send`, your sender function.
4. Add the new key to the `PRECEDENCE` array. `pickChannel()` walks that array and the first
   entry whose `ready` flag is true wins, unless `CHANNEL` is set, which pins one channel by
   name instead. Today the order is Telegram, WhatsApp (Green API), SMS (text.lk), webhook.
   Put a new channel wherever it belongs and say so in your pull request, since changing the
   order changes behaviour for existing users.
5. Add a line for the new channel to the help text in `requireEnv()`, so someone who has
   configured nothing can see it as an option. The guard itself needs no change: it already
   walks `PRECEDENCE`, so steps 3 and 4 cover it.
6. Document the new variables in `.env.example` with placeholder values only, and add them to
   the `env:` block in `.github/workflows/slt-check.yml`.

Channels that need no account and no paid plan are the most useful to the project, but any
working channel is welcome.

## Contributing MySLT API findings

`docs/myslt-api.md` is the reference for the endpoints, headers and response shapes this tool
depends on. It only covers what has been needed so far, which is login and the usage summary.

If you poke at the MySLT portal and find another endpoint that works, please send it in. That
is how the reference grows, and a documented endpoint is useful even if nothing in `check.mjs`
calls it yet. Useful contributions include:

- the request method, path, and query or body parameters
- the headers required, including whether the bearer token and client id header are needed
- a sanitised sample response, with the field names left intact
- anything surprising, such as a misspelled field name or a success flag that lies

A pull request against `docs/myslt-api.md` is ideal. An issue with the details pasted in is
also fine, and someone can fold it into the doc.

## Never post real credentials

Please do not paste real values into issues, pull requests, discussions, or screenshots.
That includes:

- your MySLT username, password, or any session or bearer token
- your subscriber ID and account number
- Telegram bot tokens, Green API instance tokens, text.lk API tokens, webhook URLs
- your phone number

Replace them before you post. `XXXX`, `<redacted>`, or `94XXXXXXXXX` all work fine. Keeping
field names and the overall structure intact is what matters for debugging; the values
themselves are never needed. If you do post something by accident, change the password or
rotate the token straight away, then edit the post.

## Pull requests

Small and focused is best. Match the surrounding style, keep the zero dependency rule intact,
and mention how you tested. `node check.mjs --now` against a real account is enough for most
changes.

Run `npm test` before you open the PR. It uses the built-in Node test runner, needs no
dependencies and no credentials, and never touches the network, so it is safe to run anywhere.
CI runs the same command on Node 18, 20 and 22. If you change how usage figures are parsed or
when an alert fires, add a case to `test/check.test.mjs` covering it.
