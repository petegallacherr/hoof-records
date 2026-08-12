HOOF RECORDS 2.4.10 — COW NUMBER KEYPAD NEXT FIX

FIXED
- Phone/tablet keypad Next after entering the cow number no longer jumps to Notes.
- The keypad action now closes the numeric keyboard and moves the screen to Hoof selection.
- No hoof is automatically selected.
- A deliberate tap on Notes still works normally.

TECHNICAL
- Retains enterkeyhint="next".
- Handles normal Enter/Return keyboard events.
- Adds a hidden native focus-navigation target immediately after Cow number.
- Adds a fallback that catches mobile browsers which skip the hidden target and focus Notes directly.
- Service-worker cache bumped to 2.4.10.

RETAINED
- Medicine / withholding animal-by-animal table.
- Farmer Report visual refresh.
- Cow photos + Share with Vet.
- Previous sessions + Resend Farmer Report.
- Vetlife branding.
- Footrot automatically selects Antibiotic.
- Independent hoof tabs.
- Portrait-only workflow.
- Offline/local storage.

UPLOAD
Upload every file in this ZIP directly into the root of the GitHub repository and replace the existing files.
After uploading, fully close and reopen the installed PWA so the new service-worker version loads.
