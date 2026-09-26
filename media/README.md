# Site videos

Two silent videos for the website, made from recordings of Link Meteor 0.2.2 on the site's synthetic practice page.

| Video | Page | Length | File |
| --- | --- | --- | --- |
| Link Meteor in under a minute | [Home](../site/index.html#watch) | 55.7 s | `site/assets/video/link-meteor-demo.mp4`, 7.8 MB |
| Install Link Meteor and make your first capture | [Install](../site/install.html#watch) | 74.5 s | `site/assets/video/link-meteor-install.mp4`, 7.3 MB |

Both are 1920×1080 H.264 (High profile, yuv420p, 30 fps) with no audio track and `+faststart`. Each has a poster JPEG, WebVTT captions and a transcript on its page. Captions are also burned into the picture, so the videos make sense without sound or a caption menu. The pages use `controls preload="none"` with no autoplay or loop, so nothing downloads until a visitor presses play. The poster is the still-image alternative, and the transcript is the text alternative.

`media/out/<id>.json` is each render's receipt: SHA-256, byte size, frame count, caption count, encoder settings and the source of every scene. x264 output is not bit-for-bit reproducible across runs, so the receipt describes the published file rather than a guaranteed rebuild.

## How each scene was made

Every scene is a recording, an illustration, a file rendering or artwork. The render receipt records the kind of each scene, and for recordings, the build digest and how selection was captured.

| Kind | What it is |
| --- | --- |
| **Recording** | Frames captured from a real Chrome for Testing page at 2× density: the site's install page, `chrome://extensions`, `chrome://extensions/shortcuts`, the practice page, and the loaded extension's full view and side-panel page. On the practice page, the loaded extension injected its own selection script, after the recording profile was granted site access through Chrome's Allow prompts (see below). The drag, highlights, count, card, status text and saved links are all the extension's. |
| **Illustration** | Schematic diagrams of steps in windows the recorder can't or shouldn't capture: unzipping in a file manager, Chrome's folder picker, and pinning from the toolbar's puzzle-piece menu. Each is tagged *Illustration* in its top corner and in the transcript. |
| **File rendering** | The spreadsheet view is drawn from the workbook actually downloaded during recording, read with openpyxl. The sheet name, cell values and the note that every cell is stored as text all come from the file. |
| **Artwork** | The approved README meteor artwork with the README animation's flowing light (`media/lib/meteor-frames.mjs`, the same algorithm as `scripts/make-readme-animation.mjs`, at twice its scale). |

| Demo scene | Kind |
| --- | --- |
| Title card | Artwork |
| Shortcut, drag, 7 links selected, Add to collection | Recording (the extension's own injected script) |
| Full view: separate fields, empty anchor text, group by URL, details, download | Recording |
| The downloaded workbook | File rendering |
| Closing card | Artwork |

| Install scene | Kind |
| --- | --- |
| Title card | Artwork |
| Step 1: download the ZIP from the install page | Recording (the downloaded file is `link-meteor-0.2.2.zip`, deleted after recording) |
| Step 2: unzip into a folder | Illustration |
| Step 3: Developer mode and Load unpacked | Recording, in a separate test profile without Link Meteor |
| Selecting the folder | Illustration |
| Link Meteor 0.2.2 in `chrome://extensions` | Recording |
| Step 4: pin the icon | Illustration |
| Step 5: shortcut, drag, 9 links selected, Copy, Add to collection | Recording (the extension's own injected script) |
| Step 6: side panel, Export, CSV download | Recording at panel width, beside a still of the practice page |
| Changing the shortcut | Recording |
| About and help | Recording at panel width |
| Closing card | Artwork |

## What is drawn on top

The compositor (`media/compose/`) draws these over the captured frames:

- **The pointer and click ripples.** Headless Chrome doesn't capture a cursor, so it is drawn from the pointer positions the recorder logged.
- **Key caps.** A graphic showing the shortcut. The key press isn't captured. Selection was started through the background's `capture.arm` message, which runs the same `arm()` the shortcut's command handler runs.
- **Camera moves.** Zooms and pans across the captured frames.
- **Captions, scene labels and Illustration tags.**

Nothing else is added. There are no native permission sheets, and no features, counts, anchor text or citation data that the recording didn't show.

Captions that state a number or file name are checked against the recording. Each timeline's `expect` entries compare them with what the recorder read from the page, for example the overlay's `7 links selected` and the downloaded file's name. `render.mjs` stops if any of them differ.

## Reproduce

You need Node.js 22 or newer and an installed Playwright with its Chromium (Chrome for Testing). Set `LINK_METEOR_PLAYWRIGHT` if Playwright isn't found. You also need `ffmpeg` with libx264, and Python 3 with openpyxl. Nothing is downloaded.

```sh
npm run build                          # dist/ is the build the recorder loads
node scripts/sync-site.mjs             # the install page must offer the same version
node media/record.mjs                  # every clip, into .scratch/media/rec (ignored)
node media/record.mjs demo-select demo-workbench   # or only some clips
node media/render.mjs demo --proof=11.3,22.5       # stills into .scratch/media/proof
node media/render.mjs demo install     # encode, poster, captions, transcripts, receipt
node media/render.mjs demo install --text-only     # captions and transcripts only
```

The recorder uses task-owned profiles, `.scratch/media-rec-<version>` and, for the "before" Extensions page, `.scratch/media-rec-<version>-plain`. It clears the recording profile's collections before recording, so never point it at a personal profile. Like the test harness, it refuses a profile whose recorded build fingerprint differs from the current `dist/`. Each clip records the version and the build digest of `dist/`. The clips published with 0.2.2 were checked file by file against `artifacts/link-meteor-0.2.2.sha256.json`.

The recorder serves the site locally on `127.0.0.1:52478` (`LINK_METEOR_FIXTURE_PORT` changes it) and runs headless at a forced 2× device scale. Recording takes about two minutes. Rendering takes about a minute per video, and the intermediate frames use about 200 MB under `.scratch/media`.

Record the two videos in separate sessions, so that each video's collection holds only its own links. Each session clears the collection first:

```sh
node media/record.mjs demo-select demo-workbench
node media/record.mjs tut-install tut-capture tut-panel tut-about tut-ext-after tut-shortcuts tut-ext-before
```

### Site access for the practice page

For the extension to inject its selection script, the recording profile needs site access to the practice-page origin. It is granted through the product's own permission requests in a visible test browser, where a person clicks Chrome's Allow button:

```sh
LINK_METEOR_TEST_PROFILE=media-rec-0.2.2 node tests/prepare-grants.mjs
```

The 0.2.2 videos were recorded this way. The session file reports `captureMode: "extension"`, and each practice-page clip reports `mode: "extension"`. The harness observes that each request was made with a user gesture and granted; it can't observe the native click itself.

Without that grant, `record.mjs` falls back to a *reconstruction* mode. It runs the extension's `content/capture.js` in the page and bridges its messages to the loaded extension, and the receipt then classifies those scenes as reconstructions. The published videos don't use it.

## Limits

- Recorded on macOS in Chrome for Testing, headless. Its shortcut page says "In Chromium" where everyday Chrome says "In Chrome", and its Extensions page shows the unpacked extension's development ID.
- The side panel's contents are recorded at panel width in a tab. Chrome's own side-panel frame and resizing aren't shown.
- The file manager, the native folder picker and the toolbar are illustrated, not recorded.
- The spreadsheet is a rendering of the downloaded file, not Microsoft Excel.
- These videos are demonstrations. They are not test evidence; see [testing and compatibility](../docs/ACCEPTANCE.md).

## Credits

All footage, illustrations, captions and the meteor artwork are original to Link Meteor. Captions use Atkinson Hyperlegible Next and Mono (SIL Open Font License 1.1), served from `site/assets/fonts/`. There is no music, sound or stock footage.
