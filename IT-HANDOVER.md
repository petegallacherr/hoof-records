# Hoof Records 2.5 — IT Handover

## 1. Purpose

Hoof Records is a private field-recording PWA used during dairy-cow hoof trimming. It is designed for fast portrait phone/tablet use, including poor or absent cell coverage.

It records sessions and cows, independent hoof lesions/treatments, medicines and withholding periods, outcomes, notes and optional reference photos. It can produce Farmer Reports, CSV exports and vet-reference photo shares.

## 2. Architecture

The release deliberately remains a no-build static application:

- HTML: `index.html`
- CSS: `styles.css`, `report.css`
- JavaScript: `config.js`, `app.js`
- PWA: `manifest.webmanifest`, `sw.js`
- Assets: Vetlife logo and install icons

There are no npm packages, framework dependencies, API keys or external JavaScript libraries.

## 3. Hosting

Recommended deployment is a dedicated HTTPS route such as `/hoof-records/` on the Vetlife site. All runtime paths are relative so a subdirectory deployment is supported.

Service workers require HTTPS (localhost is the normal development exception). The service worker scope follows the folder in which `sw.js` is served.

A normal top-level page is preferable to an iframe. If an iframe is required, IT should test browser policies around Web Share, popups/print windows, downloads, local storage, IndexedDB and PWA/service-worker behaviour.

## 4. Data storage

Operational data is local to the browser origin.

### localStorage

Configured in `config.js`:

- `hoofRecordsV2Records` — cow records
- `hoofRecordsV2Sessions` — session metadata
- `hoofRecordsV2ActiveSession` — unfinished active session
- `hoofRecordsDataSchemaVersion` — schema version marker

### IndexedDB

- database: `hoofRecordsPhotos`
- object store: `photos`
- key: photo `id`
- index: `recordId`

Each stored photo contains `id`, `recordId`, `blob` and `createdAt`.

## 5. Data schema and migrations

Release 2.5 introduces `DATA_SCHEMA_VERSION = 1`. Startup calls `runDataMigrations()` before restoring an active session.

Schema 1 accepts the existing 2.4.x data and normalises legacy foot codes (`LH` → `LR`, `RH` → `RR`), array fields and photo references without intentionally discarding data.

Future data-structure changes should increment `dataSchemaVersion` in `config.js` and add an explicit migration path before writing the new version marker.

## 6. Backup / restore

History now contains **Backup all data** and **Restore backup**.

The backup is a JSON file containing:

- cow records
- sessions
- unfinished active session (if present)
- all IndexedDB cow photos encoded inside the backup
- app/schema metadata and export timestamp

This is particularly important when moving from GitHub Pages to a Vetlife URL: browser storage is origin-specific and will **not** automatically move to the new domain/path origin. The intended migration procedure is:

1. Open the existing app and choose Backup all data.
2. Deploy/open Hoof Records on the final Vetlife origin.
3. Choose Restore backup.
4. Verify history, reports and photos before retiring the old URL.

Backups containing many photos can be large.

## 7. Offline behaviour

`sw.js` precaches the application shell, CSS, JavaScript, logo, manifest and icons. Navigation attempts the network first and falls back to cached `index.html`; static assets use cache-first behaviour.

The app is intentionally usable offline after it has been successfully loaded/cached.

## 8. Security model

There is no application-level authentication in this release. Access control is expected to be provided by the hosting environment if required.

Important consequence: because records and photos are intentionally available offline, a server login cannot revalidate access while the device is offline. Cached application files and browser-local records can remain accessible to a person who has access to that browser/device profile.

IT should explicitly approve this local/offline model and apply organisational controls appropriate to the device and site. Moving to centralised storage, audit logs, remote revocation or per-user cloud accounts would require a different backend architecture.

## 9. Content Security Policy compatibility

The main application has no inline `<style>`, inline application `<script>`, or inline event-handler attributes. This makes it substantially easier to host under a strict corporate CSP.

The printable report opens a same-origin blank window, loads `report.css` as an external stylesheet and has its Print/Close listeners attached programmatically by the opener.

If IT supplies CSP headers, test at minimum:

- `script-src 'self'`
- `style-src 'self'`
- `img-src 'self' blob: data:` (blob is used for local photo previews)
- normal form/download/share behaviour required by browser APIs

CSP should be tested against the final authenticated host rather than assumed from this development package.

## 10. Report generation

There are two presentation paths using the same stored data:

- Farmer Report preview/print: generated HTML using `report.css`
- Email/Share Farmer Report: client-side PDF generated in `app.js`

The PDF includes the Vetlife JPEG from `vetlife-logo.jpg`; it is fetched locally and embedded into the generated PDF. The logo is also service-worker precached for offline report creation.

Reports intentionally do not include management recommendations or Hooflife investigation findings.

## 11. Photo workflow

Up to three photos can be stored per cow. Incoming images are resized to a maximum 1800 px long side and JPEG-compressed (quality 0.86) before IndexedDB storage. These values live in `config.js`.

Farmer Reports show a photo-reference indicator but do not embed the full images. History can view the photos and Share with Vet can share the actual image files with a cow summary where the browser supports file sharing.

## 12. Medicine defaults

Medicine withholding defaults are centralised in `config.js`:

- Metacam: Milk 84 h, Meat 10 d
- Key 10%: Milk 0 h, Meat 4 d
- Intracillin 300: Milk 96 h, Meat 10 d
- Depocillin: Milk 108 h, Meat 10 d

The operator can edit withholding values in the UI. Treatment records require mL amounts when the relevant medicine/treatment is selected.

Any production change to medicine defaults should be reviewed through the organisation's normal veterinary/medicines governance process.

## 13. Release management

For each release:

1. Update `appVersion` in `config.js` and visible version text.
2. Increment `DATA_SCHEMA_VERSION` only if the stored data structure changes, and add migration code.
3. Change the service-worker `CACHE` name.
4. Run `node --check app.js` and the release smoke checks.
5. Test offline startup, save/undo, report preview, shared PDF, History, photo viewing/sharing, Backup/Restore, and PWA update behaviour on a real target phone.

## 14. No external integrations

Current release has no MINDA integration, server database, cloud photo storage, analytics, remote audit log or external API dependency.
