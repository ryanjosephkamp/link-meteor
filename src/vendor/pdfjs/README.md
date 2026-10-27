# PDF.js, as shipped inside Link Meteor

Link Meteor reads and combines PDFs with [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla, licensed under the Apache License 2.0 (see `LICENSE` in this folder). These files are copied unmodified from the legacy build of the npm package `pdfjs-dist`, and loaded only from inside the extension.

- Version: 6.3.289
- Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz
- Package integrity: `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==`

Files:
- `pdf.min.mjs`: 518555 bytes, SHA-256 `f401927e692efc7735e0cd528c490d0dd31b7f0972c122b7040df805be45cce4`
- `pdf.worker.min.mjs`: 1317034 bytes, SHA-256 `a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e`
- `LICENSE`: 10174 bytes, SHA-256 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`

To update, a maintainer runs `node scripts/vendor-pdfjs.mjs <version>`, which checks the package's integrity value before copying. `tests/vendor.test.mjs` checks these files against the hashes above without contacting the network.
