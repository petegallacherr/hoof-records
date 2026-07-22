Hoof Records PWA 1.0

This package converts Hoof Records into an installable Progressive Web App.

Included:
- Home-screen installation on supported Android phones, tablets and desktop browsers
- iPhone/iPad Add to Home Screen instructions
- Standalone app display without the normal browser toolbar
- Offline use after the first successful online load
- Phone and tablet responsive layout
- Existing local-storage records and all V3.1 functions
- App manifest, service worker and app icons

IMPORTANT — HOW TO MAKE IT INSTALLABLE
A PWA must be hosted on a secure HTTPS website. Opening index.html directly from a Downloads folder will run the app, but the installation and offline features will not activate.

Upload the complete folder without changing its structure to an HTTPS host, for example:
- Your existing company website/server
- Netlify
- Cloudflare Pages
- GitHub Pages
- Firebase Hosting

Files that must stay together:
index.html
manifest.webmanifest
sw.js
icons/

After publishing:
1. Open the HTTPS address on the phone or tablet.
2. Android/Chrome: tap Install app, or use the browser menu.
3. iPhone/iPad/Safari: Share > Add to Home Screen.
4. Open the new Hoof Records icon once while online so the offline app shell is cached.

Data storage:
Records remain stored locally in that browser/app installation. They are not yet backed up to a cloud account and will not automatically move between devices.
