# Ad Platform Integrations (Phase 6.1) — design & status

**Status: not yet implemented (requires external credentials).**

Automatic ad-spend pull from Meta and Google replaces manual entry. It cannot
be completed in this environment because it requires live OAuth apps and
approved API access on each platform (Meta App Review with `ads_read`, a Google
Ads developer token + OAuth client). Manual ad-spend entry (`app.adspend`)
remains the supported path and the permanent fallback.

## Intended design

Reuse the existing model: a nightly job writes `ToloAdSpendEntry` rows per day
per channel, exactly as manual entry does, so the ProfitEngine and rollups need
no changes.

1. **Connection storage** — a `ToloAdConnection` model:
   `(id, shopId, channel, accessToken, refreshToken, accountId, expiresAt,
   status)`. Tokens encrypted at rest.
2. **OAuth routes** (outside `app.*`, like auth):
   - `GET /connect/:channel` → redirect to the platform's OAuth consent URL.
   - `GET /connect/:channel/callback` → exchange code, store the connection,
     enqueue an initial backfill.
3. **Daily pull job** `tolo:ad-pull` (repeatable, after nightly rollup):
   - For each active connection, call the platform Insights API for yesterday's
     spend by day, upsert `ToloAdSpendEntry` rows with `note: "auto:<channel>"`.
   - On token expiry, refresh; on hard failure, mark the connection `error` and
     fall back to manual (never lose the manual rows).
4. **UI** — connection cards on `app.adspend` ("Connect Meta", "Connect
   Google") showing status; manual entry stays available.

## Why manual stays

Even after integration, manual entry is kept as the fallback (CLAUDE.md 6.1),
covering channels without an API connection and any gap during token refresh or
API downtime.

## Env needed to implement

```
META_APP_ID=            META_APP_SECRET=
GOOGLE_ADS_CLIENT_ID=   GOOGLE_ADS_CLIENT_SECRET=   GOOGLE_ADS_DEVELOPER_TOKEN=
TOLO_TOKEN_ENCRYPTION_KEY=   # 32-byte key for at-rest token encryption
```
