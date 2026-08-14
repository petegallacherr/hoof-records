# Hoof Records 2.5 — Release Notes

## Release status

IT handover / production deployment candidate.

## User-facing baseline retained

- Start Session and View Previous Sessions from the opening screen
- matched opening-screen button sizing
- independent LF/RF/LR/RR hoof plans
- Lameness Severity 1–5
- severity 3–5 automatic Block + NSAID defaults (manually deselectable)
- Footrot automatically adds Antibiotic to the active hoof (manually deselectable)
- NSAID, antibiotic and local-anaesthetic mL recording
- withholding-period recording
- Normal, Refil kit (CuSO4), Nerve block and existing treatment/outcome options
- cow-number keypad Next → Hoof selection fix
- optional cow photos and Share with Vet
- History and Resend Farmer Report
- CSV export
- Vetlife-branded Farmer Report and matching shared PDF layout
- medicines/withholding table high in the report
- portrait phone workflow
- offline PWA behaviour

## 2.5 handover improvements

- split monolithic `index.html` into maintainable HTML/CSS/JS files
- removed main inline CSS/JS and report inline event handlers
- external `report.css`
- external Vetlife logo used by preview/PDF; logo is precached for offline use
- central `config.js` for version, storage identifiers, photo settings, branding and medicine withholding defaults
- formal data-schema version and migration entry point
- full JSON Backup/Restore including IndexedDB cow photos
- device storage status on History
- strengthened service-worker precache for all runtime files
- IT architecture/security/deployment documentation
- release test checklist

No intended changes were made to the approved report wording or clinical recording workflow.
