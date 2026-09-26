# Changelog

## 0.2.2 (2026-09-26)

A small release: an About and help area in the extension, and a fuller website. Capture, export and storage work exactly as in 0.2.1.

### Extension

- **About and help.** A closed-by-default area in the side panel and full view shows the version and the creator credit, with links to the guide, bug reports and suggestions, the website, the source code and optional GitHub Sponsors. The new **?** button opens it. The links open in a new tab only when you click one; nothing opens or is sent automatically.
- No new permissions. The background worker, capture script, export and model code and icons are byte-for-byte the same as 0.2.1.

### Website

- A short demo video on the home page and an install walkthrough on the install page. Both are silent, with captions and a transcript, and play only when you press play.
- A creator credit with contact links in every footer, and a new About page covering how to report bugs, optional support, credits and how the videos were made.
- Refreshed product screenshots from 0.2.2.
- A troubleshooting entry for *Capture this page* after the tab moves to a new site.

### Download

`link-meteor-0.2.2.zip`, 198,835 bytes, SHA-256 `ceb6b778a0f93a6651e9c036fb6535773919ffa78b7ad4b88c692d35983b4e9d`. To update an existing installation, follow the install page's update steps and keep the same folder, so your collections stay with it.

### Known issues

- After the side panel stays open and the tab moves to a new site, *Capture this page* reports that Link Meteor doesn't have access. Click the Link Meteor toolbar icon on the new page first. The next feature release plans a one-time choice to allow all sites.
- Not yet verified: Windows and Linux, Chrome 116, screen readers, and other Chromium-based browsers. See [testing and compatibility](docs/ACCEPTANCE.md).
