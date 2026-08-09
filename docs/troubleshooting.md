# Troubleshooting

What the error messages mean, and how to read a run log rather than trusting the green tick.

## Error messages and quiet failures

**"Login failed"** means the login call came back without an `accessToken`. Check `SLT_USERNAME` first, since it is the MySLT portal login, usually an email address, not the `94...` telephone number (that is `SLT_SUBSCRIBER_ID`). It is equally often a wrong password, a password mangled by shell quoting (see [part 3 of the setup](setup.md#3-test-locally)), an account locked after repeated failures, or a change on SLT's side. The error includes SLT's own message when they return one, so read that before guessing.

**"SLT API unreachable after 3 tries"** means every attempt failed or looked transient. SLT's gateway is the most common cause, since it returns `500` responses carrying `URL Open error`, but DNS failure, blocked outbound network from wherever you run it, a rotated `X-IBM-Client-Id` or a changed response shape all land here too. The script tries three times (two retries, backing off 2 seconds then 4) and then exits **successfully** with `Transient upstream issue, skipping this run`, so a bad five minutes at SLT does not fail your workflow or fill your inbox. The trade-off is a green run in which nothing was checked. If it repeats for a day or more, stop assuming SLT.

**"Usage fetch failed"** means the API answered but reported `isSuccess: false`. The reason is in the response field `errorMessege`, spelled that way by SLT and left alone in this project so it keeps matching the real payload. Check that `SLT_SUBSCRIBER_ID` is your full telephone number in `94XXXXXXXXX` form.

**Nothing runs, and there is no Run workflow button.** You are on a fork with Actions still disabled. See [part 5 of the setup](setup.md#5-baseline-it).

**No messages at all.** Read the run log rather than the tick, using the three cases listed in [part 5 of the setup](setup.md#5-baseline-it). A healthy quiet run prints a `pkg: used=...` line (proof the usage call succeeded) followed by either `First run: baselining main package, no alert.` or `No new threshold crossed.` Run `node check.mjs --now` to test the delivery path on its own.

**Telegram returns "chat not found".** You have not messaged the bot yet, or `TELEGRAM_CHAT_ID` is wrong. Send the bot a message and re-check the chat id.

**Green API sends nothing.** Check that `GREENAPI_ID_INSTANCE` is a repository **variable** and not a secret: the workflow reads it only from `vars`, so as a secret it reaches the script empty and the WhatsApp channel is treated as unconfigured. `GREENAPI_API_URL` set as a secret fails differently, falling back to the generic host instead of your instance host. Then check `getStateInstance`. If it does not say `authorized`, the linked device has dropped and needs the QR scanned again.

**One alert never arrived, then everything carried on normally.** Most likely the Actions cache holding `state.json` was evicted, so that run re-baselined instead of alerting. A one-off is not worth chasing; if it keeps happening, your repository's caches are being evicted often, and [running from your own cron](scheduling.md#running-it-from-your-own-cron-instead) removes the cache from the picture entirely.

**Alerts stopped after a couple of months, or nothing arrives at the tightest tier.** Both are GitHub scheduling behaviours covered in [How often it checks](scheduling.md#how-often-it-checks): workflows are disabled in inactive public repositories, and free cron is best-effort.

## Telling a healthy run from a skipped one

**The very first run sends nothing.** It records where you are and exits. Silence on its own does not prove it worked, though, because a run that could not reach SLT is also silent. Check the log for `First run: baselining main package, no alert.`, or just use `--now`, which sends regardless.

The same holds after the first run, and it is the reason to open the log rather than trust the tick. A green tick means the script exited 0, which is not the same as "your usage was checked": when SLT is unreachable it exits 0 on purpose, so a bad few minutes upstream does not fail the workflow and mail you about it. The log lines that tell the two apart, and the wording of each, are listed under [part 5 of the setup](setup.md#5-baseline-it).
