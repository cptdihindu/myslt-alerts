## What this changes

A sentence or two on the problem and how this fixes it. Link the issue if there is one.

## How you tested it

Say what you ran and what you saw. `node check.mjs --now` against a real account is enough for
most changes. Paste the relevant log lines with real values redacted.

## Checklist

- [ ] **Kept it focused.** One change per pull request, matching the surrounding style.
- [ ] **No new npm dependencies.** The project is deliberately zero dependency: one source file, no
      build step, Node 18+ built-in `fetch` only.
- [ ] **Said how I tested it** in the section above.
- [ ] **No real credentials in the diff or the description:** no MySLT username or password, no
      bearer or session tokens, no Telegram, Green API or text.lk tokens, no
      phone numbers, no subscriber IDs or account numbers. Placeholders such as `XXXX`,
      `<redacted>` or `94XXXXXXXXX` instead.

If any of these do not apply, say why rather than ticking the box.

## If it applies to your change

- [ ] **New notification channel:** sender added, `channels` entry has `ready`, `label` and
      `send`, key added to `PRECEDENCE` (say where in the order and why, since that changes
      behaviour for existing users), line added to the help text in `requireEnv()`, variables
      documented in `.env.example` and added to the `env:` block in
      `.github/workflows/slt-check.yml`.
- [ ] **MySLT API finding:** `docs/myslt-api.md` updated with the method, path, parameters,
      required headers and a sanitised sample response with field names left intact.
- [ ] **User visible change:** `README.md` updated to match.
