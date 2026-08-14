HOOF RECORDS 2.5 — IT HANDOVER RELEASE

This package is intended to be handed to Vetlife IT as the production deployment candidate.

IMPORTANT
- Deploy the entire folder together; do not upload only index.html.
- Host on HTTPS at a dedicated path such as /hoof-records/.
- Read IT-HANDOVER.md before changing hosting/security policy.
- Complete TESTING-CHECKLIST.md on the final hosted URL.

2.5 HANDOVER CHANGES
- index.html split into maintainable static assets: styles.css, report.css, config.js and app.js.
- No npm/build system/framework required.
- Full Backup all data / Restore backup added, including cow photos.
- Data schema versioning/migration entry point added.
- Central configuration added for storage/photo settings/medicine withholding defaults.
- Vetlife logo and all runtime files are service-worker precached for offline operation.
- Main inline CSS/JS and report inline onclick handlers removed for easier corporate CSP hosting.
- IT/security/deployment documentation and release test checklist included.

DATA MIGRATION NOTE
Browser data is origin-specific. Existing GitHub Pages data will not automatically appear on a Vetlife domain. Before moving, use Backup all data on the old URL, then Restore backup on the new URL and verify History/photos/reports.

APPROVED USER WORKFLOW/REPORT CONTENT
2.5 preserves the approved 2.4.14 recording workflow, report wording and report design.
