# Hoof Records 2.5 — Release Testing Checklist

Use a target phone/tablet as well as a desktop browser. Complete this checklist on the final IT-hosted HTTPS URL before production sign-off.

## Installation and offline

- [ ] App loads from final HTTPS path.
- [ ] PWA installs / Add to Home Screen works on the supported device.
- [ ] Installed app opens in portrait presentation.
- [ ] After one successful online load, app reopens and records data with network disabled.
- [ ] Vetlife logo still appears in offline Farmer Report preview and shared PDF.

## Start / History

- [ ] Start Session and View Previous Sessions buttons are the same size.
- [ ] View Previous Sessions works without creating a session.
- [ ] History Back returns to Start when no session is active.
- [ ] Historical Farmer Report can be resent.

## Recording workflow

- [ ] Cow number keypad Next closes keyboard and moves to Hoof selection, not Notes.
- [ ] LF/RF/LR/RR tabs store independent lesion/treatment details.
- [ ] Multiple hooves can be recorded on one cow.
- [ ] Severity 3/4/5 adds Block + NSAID and both can be deselected.
- [ ] Footrot adds Antibiotic to that hoof and it can be deselected.
- [ ] Different treatments on different hooves save correctly.
- [ ] Multiple outcomes save correctly.
- [ ] Use Last Treatment restores the previous plan and medicine mL values.
- [ ] Undo Last Cow removes the cow and associated photos.

## Medicines

- [ ] Metacam defaults to Milk 84 h / Meat 10 d.
- [ ] Key 10% defaults to Milk 0 h / Meat 4 d.
- [ ] Intracillin 300 defaults to Milk 96 h / Meat 10 d.
- [ ] Depocillin defaults to Milk 108 h / Meat 10 d.
- [ ] NSAID requires a drug and mL dose.
- [ ] Antibiotic requires a drug and mL dose.
- [ ] Nerve block requires local-anaesthetic mL.
- [ ] Edited withholding values save/export/report correctly.

## Photos / Vet Reference

- [ ] Camera capture works.
- [ ] Existing-photo selection works.
- [ ] Maximum three photos is enforced.
- [ ] History photo count opens the correct cow photos.
- [ ] Share with Vet includes correct cow summary and images where browser file-share is supported.

## Farmer Report

- [ ] Phone Farmer Report displays Vetlife branding, summary boxes and section cards.
- [ ] Medicines and withholding table is above Lesion breakdown.
- [ ] Medicine table clearly identifies Cow / Treatment / Medicine / Dose / Milk WHP / Meat WHP.
- [ ] Follow-up and Complete Cow Record sections are correct.
- [ ] Photo reference count appears without embedding full photos.
- [ ] Email / Share Farmer Report PDF matches the approved branded layout.
- [ ] Multi-page PDF has continuation branding and sensible page breaks.

## Export / data resilience

- [ ] CSV contains current fields including medicine mL values and independent hoof details.
- [ ] Backup all data downloads JSON successfully.
- [ ] Backup includes photos (test with at least one cow photo).
- [ ] Restore backup replaces test data and restores records, sessions and photos.
- [ ] Migration from the previous 2.4.x browser data opens without losing history.
- [ ] Clear All removes records/sessions/photos after confirmation.

## Final IT checks

- [ ] No browser console errors during normal workflow.
- [ ] Corporate CSP/authentication headers do not break app.js, styles, report preview, PDF generation, sharing or photo previews.
- [ ] Service worker scope/cache behaviour is correct at the final path.
- [ ] Organisational decision on offline/local-data access has been documented and accepted.
