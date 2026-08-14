# Hoof Records 2.5

Release candidate for Vetlife IT handover.

Hoof Records is a static, offline-capable PWA for recording dairy-cow hoof trimming and lameness sessions. It has no framework, build step, server database, account system or cloud sync. All operational data remains in browser storage on the device unless the operator explicitly exports, backs up or shares it.

## Deploy

Serve the complete contents of this folder together from a dedicated HTTPS path, for example `/hoof-records/`. Do not rename or omit the runtime files without updating the references in `index.html` and `sw.js`.

Recommended: serve it as a normal authenticated page/path rather than inside an iframe. If an iframe is mandatory, IT will need to allow the capabilities used by the app, including local browser storage, downloads/popups where applicable, Web Share, and service-worker/PWA behaviour.

## Runtime files

- `index.html` — semantic UI only
- `styles.css` — application styling
- `report.css` — printable Farmer Report styling
- `config.js` — release/storage/medicine configuration
- `app.js` — application behaviour and report generation
- `sw.js` — offline cache/service worker
- `manifest.webmanifest` — PWA manifest
- `vetlife-logo.jpg` — report branding
- icon PNG files — install icons

See `IT-HANDOVER.md` for architecture, security/storage notes and migration guidance.
