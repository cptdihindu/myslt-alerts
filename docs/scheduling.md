# Alerting, scheduling and tuning

When each message fires, what the tool remembers between runs, how often the bundled workflow
checks, how to run it from your own cron instead, and which numbers to change.

## When alerts fire

- **Main package:** every 5 GB of usage. Once you have 10 GB or less left, it tightens to every 1 GB, so the last stretch before the cap is the noisiest part.
- **Add-on (VAS) bundle:** every 10 GB of usage. If you top the bundle up, the script re-baselines quietly instead of spamming you: that happens whenever the bundle limit changes, or add-on usage drops by more than 5 GB.
- **New billing cycle:** a drop in main-package usage of more than 5 GB is read as a quota reset, and you get one "quota refreshed" message. That drop is the entire test, so a cycle that turns over on 5 GB or less used is not recognised: no refresh message, and since the milestone is not reset either, the new cycle stays silent until usage climbs back past the old cycle's highest milestone. A change in the main package limit on its own is not treated as a new cycle.
- **On demand:** `node check.mjs --now` sends a full snapshot immediately, ignoring thresholds: main balance, add-on balance, any bonus, free or extra GB buckets that still have something in them, and your package name with its reset date.

Nothing fires on the first run, and silence is not by itself proof that a run worked: see [telling a healthy run from a skipped one](troubleshooting.md#telling-a-healthy-run-from-a-skipped-one).

## State

State lives in `state.json`, which is how it remembers what it has already told you about. On GitHub Actions the workflow keeps it in the Actions cache instead of committing it back to your repository. GitHub deletes cache entries unread for 7 days and evicts the oldest once a repository's caches pass 10 GB. If that entry goes, the next run re-baselines silently and you lose whatever would have fired in between: usually one alert, more if the gap spans a quota reset or several thresholds at once. Nothing in the log flags it, so the only symptom is an alert you never received.

State does not guarantee you are only told once. It is saved after every message in a run has been sent, so if one message is delivered and a later one fails, the run exits without saving and the delivered message goes out again on the next run. The same happens if a provider accepts a message but its response never reaches the script. A duplicate after a failed send is normal.

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

If you have a machine that stays on, a Raspberry Pi, a home server, a small VPS, its cron runs in your own timezone and is not competing with everyone else's scheduled workflows. Nothing about the script changes: put your values in a `.env` next to `check.mjs` as in [part 3 of the setup](setup.md#3-test-locally), then add a crontab line with `crontab -e`.

```cron
*/30 * * * * cd /home/you/myslt-alerts && /usr/bin/node --env-file=.env check.mjs >> cron.log 2>&1
```

On Node older than 20.6 there is no `--env-file`. Sourcing `.env` from the crontab line carries the hazard described in [part 3](setup.md#3-test-locally), made worse by cron running the line through `/bin/sh` rather than your usual shell, so the cleanest fix is to update Node. Failing that, point cron at a small wrapper script you control: `chmod 700` it, single-quote every value, `export` them, then `exec` node.

Three things that catch people out. Cron runs with a bare `PATH`, so give the absolute path to Node from `which node`; a version manager like nvm puts it somewhere cron will not find on its own. Redirect output to a log, as above, or you will have no idea whether it ran. And `chmod 600 .env`, since the credentials now sit on a machine you share with other processes.

The tiered schedule works here too: the four `cron:` lines from the workflow are already standard crontab syntax, so paste them in with the same command, minus the `- cron:` prefix and the quotes. State is simpler on your own machine, since `check.mjs` writes `state.json` beside itself and it stays there, with no cache to lose.

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

Check frequency lives in the `cron` lines of `.github/workflows/slt-check.yml`. Delete the tiers you do not want. Forcing a clean baseline is covered in [part 5 of the setup](setup.md#5-baseline-it).
