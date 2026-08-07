# MySLT HTTP API (unofficial reference)

Sri Lanka Telecom (SLT) is the main fixed-line and fibre broadband provider in Sri Lanka. Its
customer portal and mobile app, both branded "MySLT", let an account holder check how much of
their monthly data quota they have used. There is no published API for this. The portal talks to
a private JSON backend, and that backend is what this document describes.

SLT's own web portal calls that backend, and the gateway client id those calls carry is served
publicly in SLT's web bundle. What follows is a description of the two calls this project makes
and of what they return. It is written down so that account holders can read their own usage data
from their own tooling: a script, a dashboard, a home automation box, an alerting job.

**Server-side authorization was never tested, and you should not test it.** `subscriberID` is
passed as a plain telephone number, which is guessable, and nothing here establishes that SLT's
backend checks the number you ask for against the account your token belongs to. It may well
check properly. Nobody has looked, because looking would mean requesting a number that is not
yours, and that means touching another customer's data without their consent. Do not do it. Only
ever send your own `subscriberID`, and read every request-shape description below as "this is
what worked for the account it was tried on", not as a statement about what the server permits.
If you believe you have found an authorization flaw, report it privately to SLT rather than
publishing it or opening an issue here.

**Status of this document.** The evidence behind it is narrow, and it is worth knowing exactly how
narrow. Two endpoints have ever been called, `POST /Account/Login` and `GET /BBVAS/UsageSummary`,
against one account on 2026-08-06: a single residential fibre connection on a consumer package.
Three response bodies were captured in total, a successful login, a successful usage read, and one
transient gateway error from the login call. Every response field described in the Authentication
and Usage sections comes from those bodies. The sample body printed below keeps the structure of
what came back and replaces the account's own figures with synthetic ones, as noted there. Request fields were taken from the calls that were
actually sent, which is why `channelID` is marked "assumed" below: it was sent every time, so
whether it is required was never tested.

No negative test has ever been run. Nothing was probed with a missing or wrong
`X-IBM-Client-Id`, wrong credentials, an expired token, a malformed `subscriberID`, or an omitted
`channelID`. Where this document tells you how to handle a failure, that is advice inferred from
the shape of the API, and it is labelled as such rather than presented as observed behaviour.
Everything unobserved is collected under [Open questions](#open-questions-not-yet-mapped). If you
probe something new, please add it there with the evidence: the request you sent and the body that
came back, exactly as it arrived.

One part of this document is broader than that narrow base. No public source describes what this
API returns: the two requests are documented publicly elsewhere, but the response body is not, so
the field reference below is the only public description I could find of `dataBundle`, the misspelled
`errorMessege`, the mix of string and numeric fields, the nullable buckets, and the percentage
quirk. That is stated with confidence. It is also why a contributed response body from a different
package type is the most valuable thing anybody can add here.

---

## Base URL and the gateway header

```
https://omniscapp.slt.lk/slt/ext/api
```

Both calls documented here, the login and the usage read, were made with this header, and both
succeeded with it:

```
X-IBM-Client-Id: b7402e9d66808f762ccedbe42c20668e
```

That value is an [IBM API Connect](https://www.ibm.com/products/api-connect) client identifier.
API Connect sits in front of SLT's backend as a gateway. API Connect deployments normally reject
calls that arrive without a registered client id, which is why the header is treated as mandatory
here, but that is an inference from how the product works and not something this project tested.
No call was ever sent with the header missing, empty, or altered, so whether SLT's gateway
enforces it, and what a rejection looks like, is an
[open question](#open-questions-not-yet-mapped). Two things are worth understanding about the
value itself:

- **SLT publishes it, and it identifies the application rather than the account.** The value is
  in SLT's own public web bundle, the JavaScript the portal serves to any visitor who has not
  logged in, so it reaches a browser before any credentials are entered. It carries no account
  identifier, and the same string was accepted on the unauthenticated login call and on the
  authenticated read, so it does not behave like a per-user or per-session secret. All of that is
  observation. The conclusion usually drawn from it, that SLT therefore treats the value as
  non-confidential, is an inference, and SLT has not said so anywhere. The narrower point stands
  on its own: reproducing the id in this document discloses nothing SLT does not already hand to
  every anonymous visitor. Whether the mobile app carries a different id has not been checked.
- **Assume it can change, because it appears to have changed before.** This one point comes from
  comparing older publicly visible clients rather than from this project's own captures, so it sits
  outside the evidence base described above. On that basis, an earlier generation of this API used a
  different client id against a different base path, so both halves of what is documented here,
  the base URL and the id, have rotated at least once already. That makes a future rotation an
  observation about how this API behaves rather than a guess, and any caller that pins the
  constant will break when the next one lands. What is still unknown is the cadence: no date is
  attached to the previous change, and one change is not a rate. Also unknown is what a stale id
  returns, since none has been sent. Re-extract the current value from the portal if previously
  working calls start failing. The reference client in this repository hardcodes it as
  `CLIENT_ID` in `check.mjs`; if you are building something longer-lived, read it from
  configuration instead.

### Conventions

These describe the two endpoints that were called, `POST /Account/Login` and
`GET /BBVAS/UsageSummary`. They are not a survey of the API, and other routes may not follow them.

- Requests are plain HTTPS. The login call sends `application/x-www-form-urlencoded`. The one read
  call documented here passes its single parameter in the query string; whether other reads do the
  same is unknown.
- Both endpoints returned JSON, on the successful calls and on the one gateway failure that was
  captured.
- **The volume figures came back as strings** in the usage response (`"limit": "100.0"`), while
  some other fields in the same body are real JSON numbers (`"percentage": 75`, `"timestamp": 0`).
  So the response mixes both, and you should parse rather than assume either. The login response
  carries no numeric fields, so this is one endpoint's behaviour rather than a house style you
  can count on elsewhere.
- Field naming is inconsistent inside that usage response. Its envelope is camelCase, `dataBundle`
  and `my_package_info` are snake_case apart from `usageDetails`, `subscriptionid` is neither, and
  `errorMessege` is misspelled. Do not assume a naming convention.

---

## Authentication

### `POST /Account/Login`

Exchanges portal credentials for a bearer token.

**Request**

| | |
|---|---|
| Method | `POST` |
| Path | `/Account/Login` |
| Content-Type | `application/x-www-form-urlencoded` |
| Headers | `X-IBM-Client-Id` |

Form fields:

| Field | Required | Value |
|---|---|---|
| `username` | yes | The MySLT portal login. One value has ever been sent, and it was an **email address**. Whether a telephone or account number is also accepted here has not been tested. |
| `password` | yes | The MySLT portal password. |
| `channelID` | yes (assumed) | The literal string `WEB`. The portal always sends it and so does this client, so whether login succeeds without it has never been tested. `WEB` is the only value that has been tried. |

**Response `200`**

```json
{
  "accessToken": "<opaque string>",
  "refreshToken": "<opaque string>",
  "user_id": null,
  "name": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `accessToken` | string | Bearer token. Send it as `Authorization: Bearer <accessToken>` on subsequent calls. Treat it as opaque; do not parse it. |
| `refreshToken` | string | A refresh credential is returned. How to redeem it has **not** been verified. See below. |
| `user_id` | null | `null` in the observed response. Whether it is ever populated is unknown. |
| `name` | null | `null` in the observed response. Whether it is ever populated is unknown. |

**There is no confirmed way to detect a failed login.** No failed login was ever captured, so the
status code, the body shape, and the field that carries the reason are all unknown. What the
reference client in this repository does is treat a response without a non-empty `accessToken` as
a failure (`if (!json.accessToken) throw ...` in `check.mjs`) and put whatever the body contained
into the error message, guessing at a correctly spelled `errorMessage` key and falling back to
dumping the raw body when that is absent. That is the pragmatic approach, not an observed
contract: it assumes SLT never returns a token alongside a rejection, and it guesses the error key
because no failing body has been seen to read it from. If you capture one, please add it under
[Open questions](#open-questions-not-yet-mapped) so this can be rewritten from evidence.

**Token lifetime and refresh are open questions.** The API hands back a `refreshToken`, which
strongly implies the access token expires and that some refresh route exists, but neither the
lifetime nor the refresh endpoint has been observed, so no refresh URL is documented here. Until
someone maps it, the practical approach for a batch client is to log in fresh on every run and
keep no token state. That is what a short-lived cron job should do anyway.

---

## Usage

### `GET /BBVAS/UsageSummary`

Returns the current billing period's data allowances and consumption for one subscriber.

**Request**

| | |
|---|---|
| Method | `GET` |
| Path | `/BBVAS/UsageSummary` |
| Headers | `Authorization: Bearer <accessToken>`, `X-IBM-Client-Id` |

| Query parameter | Required | Value |
|---|---|---|
| `subscriberID` | yes | Identifies the connection to report on. Exactly one value has ever been sent: the account telephone number in international dialling form, no plus sign and no leading zero, shaped like `94XXXXXXXXX`. That value worked, and it is the form SLT's own portal sends. No other format was tried, so whether local form (`0XXXXXXXXX`), a leading plus, a bare account number, or the login username would also be accepted is untested. |

**Response `200`**, from a live residential account with an active add-on bundle. The structure is
reproduced exactly as it was returned: every field name, its spelling, its type, the nesting, and
which buckets came back `null` are all as captured. The values are not. Every figure, the package
name, and both dates have been replaced with synthetic ones, so that the sample does not publish a
real account's consumption. The synthetic set is internally consistent, so the relationships the
rest of this document draws out of it (`limit - used = remaining`, a fully consumed bonus bucket,
`percentage` tracking the remainder) hold in the numbers below exactly as they held in the real
body.

```json
{
  "isSuccess": true,
  "errorMessege": null,
  "exceptionDetail": null,
  "dataBundle": {
    "status": "NORMAL",
    "reported_time": "01-Jan-2026 12:00 PM",
    "my_package_summary":    { "limit": "100.0", "used": "25.0", "volume_unit": "GB" },
    "bonus_data_summary":    { "limit": "5.0",   "used": "5.0",  "volume_unit": "GB" },
    "free_data_summary":     null,
    "vas_data_summary":      { "limit": "40.0",  "used": "12.0", "volume_unit": "GB" },
    "extra_gb_data_summary": null,
    "my_package_info": {
      "package_name": "EXAMPLE PACKAGE",
      "package_summary": null,
      "usageDetails": [
        {
          "name": "Any Time Usage.",
          "limit": "100.0",
          "remaining": "75.0",
          "used": "25.0",
          "percentage": 75,
          "volume_unit": "GB",
          "expiry_date": "31-Jan",
          "claim": null,
          "unsubscribable": false,
          "timestamp": 0,
          "subscriptionid": null
        }
      ],
      "reported_time": "01-Jan-2026 12:00 PM"
    }
  },
  "errorShow": null,
  "errorCode": null
}
```

#### Field reference

The tables below describe one account, probed once, on 2026-08-06. Where a field is described as
`null`, `0`, or single-valued, that is what one sample showed, not a survey of the API. Treat
every such entry as unconfirmed. Any example value quoted in the tables is the synthetic one from
the sample above; the field names, the types, and which fields came back `null` are as observed.

**Envelope (top level)**

| Field | Type | Meaning |
|---|---|---|
| `isSuccess` | boolean | `true` in the one response captured. The name, and the error fields sitting beside it, imply it flags whether the payload is usable, so checking it before reading `dataBundle` is the defensive choice and the reference client does exactly that. No `isSuccess: false` response has been seen, so whether it ever arrives with a `200`, and what accompanies it, is unverified. |
| `errorMessege` | string or null | `null` in the observed response. Presumably human-readable error text when `isSuccess` is `false`, though no populated value has been seen. **The field name is misspelled in SLT's API** ("Messege" for "Message"). Read it exactly as spelled. Do not silently normalise it away; if you expose a corrected alias, keep the original key too, because SLT may fix the typo one day and a client that only knows the corrected name would break either before or after that change. |
| `exceptionDetail` | unknown or null | `null`. Contents when populated are unknown. |
| `dataBundle` | object or null | The payload. Described below. |
| `errorShow` | unknown or null | `null`. Purpose unknown. Plausibly a flag telling the portal whether to show the error to the user, but nothing confirms that. |
| `errorCode` | unknown or null | `null`. Value space unknown. |

**`dataBundle`**

| Field | Type | Meaning |
|---|---|---|
| `status` | string | Account/quota state. `"NORMAL"` is the only value observed. Other values are unknown. |
| `reported_time` | string | When SLT's own metering last updated, formatted `DD-MMM-YYYY hh:mm AM/PM` (for example `01-Jan-2026 12:00 PM`). This is SLT's reporting timestamp, not the time of your request, so usage can lag reality. No timezone is included; Sri Lanka is UTC+5:30. |
| `my_package_summary` | object or null | The main monthly package quota. This is the number most users mean by "my data". |
| `bonus_data_summary` | object or null | A bonus allowance bucket. Populated in the one response captured. Treat it as nullable, since the sibling buckets show that these can be absent, but it has not been seen `null`. |
| `free_data_summary` | object or null | A free allowance bucket. `null` here. |
| `vas_data_summary` | object or null | A value-added-service bundle, that is, an add-on purchased on top of the package. Populated in the one response captured, on an account that had an add-on. Presumably `null` when none is active, but an account without one has never been probed. |
| `extra_gb_data_summary` | object or null | An extra-GB top-up bucket. `null` here. |
| `my_package_info` | object or null | Package name plus a per-allowance breakdown. Described below. |

Two of these were `null` in the sample, `free_data_summary` and `extra_gb_data_summary`, which
establishes that a summary bucket can be absent. Treat all four of the optional buckets
(`bonus_data_summary`, `free_data_summary`, `vas_data_summary`, `extra_gb_data_summary`) as
nullable, since an account with no add-on plainly has nothing to report in `vas_data_summary`. Whether `my_package_summary` is ever `null` has not
been observed; see [Open questions](#open-questions-not-yet-mapped). Decide explicitly which
bucket your application means by "usage" rather than taking whichever one happens to be non-null.

**Volume bucket object** (the shape the summary buckets take when populated. Three of the five
were seen as objects; `free_data_summary` and `extra_gb_data_summary` were `null`, so their
populated shape is assumed to match rather than observed.)

| Field | Type | Meaning |
|---|---|---|
| `limit` | string | Total allowance for the bucket, as a decimal string, for example `"100.0"`. |
| `used` | string | Consumed so far, as a decimal string, for example `"25.0"`. |
| `volume_unit` | string | Unit for `limit` and `used`. `"GB"` is the only value observed. Do not assume it is always GB; read it and display it. |

Remaining volume is not provided at this level. Compute it as `limit - used` after parsing both
as floats, and guard against a negative result.

**`my_package_info`**

| Field | Type | Meaning |
|---|---|---|
| `package_name` | string | Marketing name of the broadband package. The sample above carries the placeholder `"EXAMPLE PACKAGE"`; a real response carries SLT's own name for the package on the connection. |
| `package_summary` | unknown or null | `null`. Contents unknown. Despite the name it is not one of the volume buckets described above. |
| `usageDetails` | array | One entry per named allowance line on the package. See below. |
| `reported_time` | string | Same format and meaning as `dataBundle.reported_time`. The two matched in the sample. Whether they can ever diverge is unknown. |

**`usageDetails[]` entry**

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Label for the allowance line, for example `"Any Time Usage."` (trailing period included, as returned). Packages with time-of-day allowances should return more than one entry, but only a single-entry response has been observed. |
| `limit` | string | Total allowance for this line, decimal string. |
| `remaining` | string | Remaining allowance, decimal string. Unlike the `*_summary` buckets, this level does give you the remainder directly. |
| `used` | string | Consumed so far, decimal string. |
| `percentage` | number | An actual JSON number, not a string. **It appears to track the share remaining rather than the share used.** In the captured response the field matched the remaining share and not the used share, and the synthetic sample above preserves that: `remaining / limit = 75 / 100 = 75%`, which matches the reported `75`, while used would have been 25%. That reading rests on a single account and a single sample, so verify it before relying on it. Deriving your own percentage from `used` and `limit` is safer than trusting this field. |
| `volume_unit` | string | Unit for the three volume fields, for example `"GB"`. |
| `expiry_date` | string | When the current quota lapses, formatted `DD-MMM` with **no year**, for example `"31-Jan"`. Infer the year from context, and beware of the December to January rollover. |
| `claim` | unknown or null | `null`. Purpose unknown. |
| `unsubscribable` | boolean | `false`. The name points at whether the allowance can be cancelled from the portal, which would fit an add-on better than a base package line, but nothing confirms that. |
| `timestamp` | number | `0`. Meaning and units unknown. Do not treat it as a Unix time until someone sees a non-zero value. |
| `subscriptionid` | unknown or null | `null`. Presumably identifies a subscribed add-on. |

#### Traps, in short

1. Volumes are strings. `"100.0" > "9.0"` evaluates to `false` in most languages. Parse before comparing.
2. `errorMessege` is misspelled in the API itself.
3. `percentage` looks like remaining rather than used, so a naive progress bar will run backwards.
4. Summary buckets go `null`. Two of the five were `null` in the one sample; handle all four
   optional ones that way.
5. `expiry_date` has no year, and `reported_time` has no timezone.
6. Read `isSuccess` rather than trusting the HTTP status on its own. This one is defensive advice,
   not something that was observed: no failing read has been captured, so whether SLT reports
   application errors under a `200` or under a non-2xx status is unknown.

---

## Worked example

Log in and capture the token:

```bash
CLIENT_ID=b7402e9d66808f762ccedbe42c20668e
API=https://omniscapp.slt.lk/slt/ext/api

TOKEN=$(curl -s -X POST "$API/Account/Login" \
  -H "X-IBM-Client-Id: $CLIENT_ID" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=you@example.com" \
  --data-urlencode "password=your-portal-password" \
  --data-urlencode "channelID=WEB" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
```

That snippet shows the request shape and deliberately skips error handling. It assumes the login
succeeded and that the body has an `accessToken`. Hand it a gateway fault, or a rejection whose
shape nobody has captured, and the `python3` step fails with whatever error that body happens to
produce rather than telling you what went wrong. A
real client should check for the token first, the way `check.mjs` does, and retry the transient
case described under [Error handling](#error-handling).

Fetch the usage summary:

```bash
curl -s "$API/BBVAS/UsageSummary?subscriberID=94XXXXXXXXX" \
  -H "X-IBM-Client-Id: $CLIENT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Pull out remaining volume on the main package:

```bash
curl -s "$API/BBVAS/UsageSummary?subscriberID=94XXXXXXXXX" \
  -H "X-IBM-Client-Id: $CLIENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['isSuccess'], d['errorMessege']
p = d['dataBundle']['my_package_summary']
limit, used = float(p['limit']), float(p['used'])
print(f\"{limit - used:.1f} {p['volume_unit']} remaining of {limit:.1f}\")
"
```

Keep credentials out of your shell history and out of source control. Environment variables or a
secrets store are the right home for them.

---

## Error handling

Two failure classes, handled in opposite ways.

### Transient gateway faults: retry

The API Connect gateway can fail to reach SLT's backend. The one time that happened during this
work, it returned:

```json
{
  "httpCode": "500",
  "httpMessage": "URL Open error",
  "moreInformation": "Could not connect to endpoint"
}
```

Note the shape: this is a *gateway* envelope, completely different from the normal
`isSuccess`/`dataBundle` response, and `httpCode` is a string. It was captured once, on the login
call, and it was not an authentication failure: the same credentials worked seconds later. It has
never been seen on `GET /BBVAS/UsageSummary`. Wrapping the read in the same retry is therefore an
inference, that a fault between the gateway and the backend is unlikely to be specific to one
route, rather than a response to observed behaviour. The reference client applies the same retry
to both calls on that basis, and if you do see this envelope on a read, it is worth recording in
[Open questions](#open-questions-not-yet-mapped).

Handle it by retrying with backoff. Three attempts with a growing delay (for example 2s then 4s)
is what the reference client does, and it was enough for the occurrence that was captured, though
one recovery is not a measurement of how long these faults last. Match on the gateway body as well
as the HTTP status: the body carries
`"httpCode": "500"` as a string, and whether the transport status always mirrors it has not been
confirmed, so checking both is the safe default. If all attempts fail, treat the run as skipped
rather than broken. For a scheduled job, exiting quietly beats firing a false alarm at the user
every time SLT's gateway hiccups.

### Genuine failures: do not retry

None of the three cases below has ever been observed. They are written down because a client still
has to do something when they happen, so each one gives the handling this project settled on and
the assumption underneath it. Treat them as design decisions, not as documentation of SLT's
behaviour.

- **Bad credentials.** The status code and body are unknown, because no failed login was ever
  captured. The rule the reference client applies is that a response without a non-empty
  `accessToken` is a failure, which assumes SLT does not hand back a token on a rejection.
  Whatever the real shape is, retrying will not fix a wrong password, and repeated attempts risk
  tripping whatever lockout SLT operates, so fail loudly and stop.
- **Application errors on a read.** The expectation is `isSuccess: false` with the reason, if any,
  in `errorMessege`. Surface it as-is. No such response has been seen, so if you do get one, the
  body is worth contributing.
- **Rejected or missing client id.** Untested: nobody has sent a wrong, stale, or absent
  `X-IBM-Client-Id`. The value has rotated before, so this is the failure mode most likely to
  arrive on its own one day. The expectation is that the gateway rejects the call before it
  reaches the auth layer, on reads and on login alike, which would make retrying pointless and
  the fix a re-extraction of the current id from the portal.

The HTTP status codes and error bodies for bad credentials, an expired token, and a stale client
id have not been captured, so nothing above should be read as a description of them. They are
listed as open questions below.

---

## Open questions (not yet mapped)

What is not known. Contributions welcome: probe against your own account, and add the observed
request and the response body exactly as it came back.

**Authentication**

- Access token lifetime. Unknown. No expiry has been observed.
- The refresh flow. A `refreshToken` is returned, but the endpoint, method, and parameters that
  redeem it have not been identified.
- What an expired or invalid token returns (status code and body shape).
- What a failed login returns. This is the single most useful gap to close, because the reference
  client's failure rule (no non-empty `accessToken` means failure) is a guess standing in for it.
  Worth capturing: the status code, whether `accessToken` is absent or empty or something else
  entirely, which key carries the message, and any `errorCode` values.
- Whether `channelID` is required at all, whether it accepts values other than `WEB`, and whether
  the mobile app uses a different one with different behaviour.
- Whether `user_id` and `name` are ever non-null, and under what conditions.

**The gateway client id**

Nothing about `X-IBM-Client-Id` has been tested, only used. Each of these is a single request away
for anyone willing to try it:

- Whether the header is enforced at all. Send a call with it omitted, and another with a plausible
  but unregistered value, and record the status code and body of each.
- Whether a rejection surfaces as a gateway envelope (like the `URL Open error` body above) or as
  something from the auth layer, and whether login and reads reject alike.
- Whether the portal ever serves a different id to some visitors. The value documented here is the
  one in the public bundle, which is a static file rather than something generated per request, so
  a per-visitor id would be surprising. Nobody has checked whether it is swapped after login, or
  for particular account types.
- What the mobile app sends, which may be a different id entirely.
- How often the value rotates. It appears to have changed at least once together with the base
  path, on the outside evidence noted above, but no
  date is attached to that change and one change gives no cadence. A dated note saying "still this
  value on <date>", or "changed on <date>", is genuinely useful.

**Request formats that were never varied**

- `subscriberID`: only the international form (`94XXXXXXXXX`) was ever sent. Does local form with
  a leading zero work? A leading plus? A bare account number? The login username? A `subscriberID`
  belonging to somebody else, and if so, does the token scope it correctly?
- `channelID`: only `WEB` was ever sent, and only on login.

**Other endpoints**

None of the following have been probed. The portal exposes equivalent features in its UI, so
routes almost certainly exist, but their paths, parameters, and responses are unknown:

- Current bill and outstanding balance.
- Bill history and payment history.
- Package change, upgrade, or add-on purchase.
- Daily or per-session usage breakdown (the portal shows a day-by-day chart, so some endpoint
  serves it).
- Add-on catalogue and activation.
- Account or profile details, and multi-connection accounts (whether one login can enumerate
  several `subscriberID` values, and how).

**Behaviour and limits**

- Rate limits, throttling thresholds, and whether abuse triggers a block on the client id, the
  account, or the source IP. Assume limits exist and poll conservatively.
- Whether `my_package_summary` is ever `null`, and what a client should do if it is.
- Behaviour for non-fibre fixed broadband (ADSL, 4G LTE routers) and for mobile accounts. The
  `dataBundle` shape may differ, buckets that were `null` here may be populated, and `status` may
  take other values.
- Unlimited or uncapped packages: what `limit` and `percentage` contain when there is no cap.
- Multi-line `usageDetails`, for example packages with separate day and night allowances.
- The full value space of `status`, `errorCode`, `claim`, `subscriptionid`, and `timestamp`.
- Whether `percentage` really is remaining rather than used. One sample supports it, which is not
  enough.
- Whether the gateway envelope shown under Error handling also appears on `GET /BBVAS/UsageSummary`.

---

## Legal and ethical note

### What this actually is

Reading **your own account's data with your own credentials**, through the same calls SLT's own
web portal makes. It is the same data the MySLT portal shows you after you log in, retrieved the
same way the portal retrieves it, and it is written up for interoperability, so that customers are
not limited to one vendor's web UI when looking at their own usage.

It is worth being precise about what it is not. It is not access to anybody else's account: the
login is yours, the token SLT issues belongs to your account, and the only `subscriberID` you
should ever send is your own. There is no paywall involved, no licence check, no access control
being defeated as far as this project can tell, though note that whether the gateway enforces the
client id, and whether the backend checks the subscriber id against your token, were both never
tested and are listed as open questions above. You authenticate the way the portal authenticates you,
and you read what SLT hands back to you.

### The gateway client id

`b7402e9d66808f762ccedbe42c20668e` is not a per-user secret, and on the evidence it is not a
secret at all. SLT's own public web bundle contains it, served to any visitor who has not logged
in, so anybody who loads the portal already has it. Reprinting it in this document therefore
discloses nothing that SLT does not already hand to every anonymous browser.

Read that as what it is: a statement about **disclosure**, not a legal opinion about **use**.
"This value is already public" and "using this API is permitted" are two separate claims, and only
the first one is being made here. A careless reader will collapse them. Do not.

### Terms of service

SLT's broadband terms list prohibited activities and state that the list is not exhaustive. One of
the listed items is "Accessing or attempting to access information that does not have public
access permission." A terms based objection is therefore available to SLT if they want to make
one, and the terms are their document to interpret.

Two things follow. First, a terms breach is a matter between a customer and their provider, not a
criminal one, and the realistic consequence in that direction is account level action: a warning,
a suspension, a disconnection. Second, this document is not going to tell you that you are in the
clear, and it is not going to tell you that you are in trouble. Those are the facts; the decision
is yours.

Read your own terms. They are what you agreed to, they can be revised, and yours may differ from
the ones described here.

### The realistic risk, ranked

By far the most likely thing that happens to you is that **SLT changes the client id or the paths,
and every third-party client breaks at once, with no notice**. That is not hypothetical. Both the
client id and the base path appear to have changed at least once before. Every other outcome discussed on
this page is much less likely than that one.

So plan for the tool breaking. That is the risk you will actually experience, and re-extracting the
current client id from the portal is the fix.

### Being a good citizen

- Poll at a human cadence. Once or a few times a day is plenty for usage tracking; the upstream
  data only refreshes periodically anyway, as `reported_time` shows. Do not poll in a loop.
- Back off on errors instead of hammering through them.
- Use your own credentials only. Do not use this to access accounts that are not yours, and never
  request a `subscriberID` that is not yours.
- Do not use it for bulk collection, scraping at scale, or anything that puts load on
  infrastructure other customers depend on.
- If SLT asks for this to come down, comply.
- If SLT publishes an official API, prefer it over this one.

### Disclaimer

The author is a developer and not a lawyer, and none of this is legal advice. This project is not
affiliated with, endorsed by, or supported by Sri Lanka Telecom. "MySLT" and "SLT" are their marks,
used here only to identify the service being described. The API is undocumented and unsupported,
so SLT may change or withdraw it without notice, and nothing here is a commitment by them. If you
copy this project or this document, check your own terms and your own jurisdiction before you run
anything.
