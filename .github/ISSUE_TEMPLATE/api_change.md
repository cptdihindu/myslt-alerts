---
name: MySLT API change
about: The tool stopped working because SLT changed their API
title: "[API] "
labels: ["api-change"]
assignees: ""
---

**Before you post: redact every real value.** Remove your password, any bearer or session
token, your subscriber ID, your account number, and your phone number. Replace them with
`XXXX` or `<redacted>`. Leave field names and the response structure intact, because those
are the parts that are actually useful for debugging.

## What broke

Which call fails? Tick what applies.

- [ ] Login (`POST /Account/Login`)
- [ ] Usage summary (`GET /BBVAS/UsageSummary`)
- [ ] Something else (describe below)

What were you running?

- [ ] The scheduled GitHub Actions workflow
- [ ] `node check.mjs` locally
- [ ] `node check.mjs --now` locally

When did it last work? (a rough date is fine)

## Error message

Paste the error the script printed, with credentials removed.

```text
(paste here)
```

## Observed response body

Paste what the API actually returned, with credentials and identifiers removed. This is the
most valuable part of the report, because it usually shows the renamed or missing field right
away.

```json
(paste here)
```

If you can, say which fields changed compared to what the script expects. From the login
response it reads only `accessToken`. From the usage response it reads:

- `isSuccess`, and `errorMessege` (spelled that way by SLT) or `errorMessage` when the call fails
- `dataBundle.my_package_summary`, which is the only bucket the script requires
- `dataBundle.vas_data_summary`, `bonus_data_summary`, `free_data_summary` and
  `extra_gb_data_summary`, each optional and each allowed to be `null`
- `limit`, `used` and `volume_unit` inside every one of those buckets
- `dataBundle.my_package_info.package_name`
- `expiry_date` from the first entry of `dataBundle.my_package_info.usageDetails`
- `dataBundle.reported_time`, falling back to `my_package_info.reported_time`

## Anything else

Does the MySLT app or web portal still work for you? Did SLT change your package recently?
Any other detail that might explain the difference.

---

Last check before you submit: no password, no token, no subscriber ID, no account number, no
phone number anywhere above.
