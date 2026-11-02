# Product

See [product scope and guarantees](SCOPE.md), [data contracts](CONTRACTS.md) and [testing/compatibility](ACCEPTANCE.md) for implementation requirements and verified limits.

## Register

product

The extension surfaces (region overlay, side panel, full workbench) are product register. The GitHub Pages site under `site/` is brand register and is designed to that standard separately.

## Users

Researchers and students collecting sources while reading: bibliographies, journal search results, reading lists, documentation. Secondary users handle link-heavy operational pages: admin panels, ticket queues, product listings. They work on a laptop in Chrome, often with many tabs open, with the side panel docked beside the page they are reading. They flick between page and panel; attention belongs to the page.

The job: pull a set of links out of a page quickly, trust that each link kept its real visible label, its exact destination, and where it came from, curate that set, and hand it to a spreadsheet, a document, a reference manager, or bookmarks.

## Product Purpose

Link Meteor captures links with their actual anchor text and URL as separate fields, keeps full source provenance for every occurrence, organizes captures into named local collections, and exports them in useful formats. Success is a user who drags across part of a page, sees exactly what was captured, and pastes a clean two-column table into their spreadsheet without cleanup, and who never wonders whether the tool changed, invented, merged or lost something.

Everything is free forever. No account, advertising, telemetry, paid tier, or backend dependency. Data stays in the browser profile.

## Brand Personality

Precise, candid, quick.

- Precise: exact strings, exact counts, exact scope. The interface says "37 links from 1 page", never "some links".
- Candid: permissions, limits and failures are explained plainly at the moment they matter. Partial results are kept and labeled.
- Quick: capture is one gesture; the common path (drag, copy two columns) takes seconds.

The meteor is the brand's single piece of whimsy: a bright head with a trail behind it, which is the product's promise (the link, and the trail back to its source). Warmth comes from clear copy and a confident accent, not decoration.

## Anti-references

- The reference product that informed the feature list: no copying of its code, assets, wording or presentation.
- Generic "AI SaaS" surfaces: cream backgrounds, numbered section scaffolding, tiny tracked eyebrows over every heading, gradient text, glass cards, hero-metric templates.
- Space-themed kitsch for the meteor name: starfields, purple nebula gradients, glowing planets.
- Dense developer-tool chrome that treats researchers as engineers (terminal aesthetics, monospace everywhere).
- Heavy browser-extension popups that fight the host page for attention.

## Design Principles

1. The page is the content. Extension surfaces stay quiet beside any website and never compete with the source being read.
2. Show the exact scope before acting and the exact result after. Counts, targets and destinations are always visible at the point of decision.
3. Fields stay separate, visibly. Anchor text and URL are shown as two things everywhere, so the promise is evident before the first export.
4. Honest states. Empty, denied, unsupported, partial and failed are different outcomes with different words, and successful results are never hidden by a failure.
5. Earned familiarity. Standard controls, standard keyboard behavior, one icon set, one button vocabulary; delight is reserved for the capture moment.

## Accessibility & Inclusion

Target WCAG 2.2 AA for all extension surfaces and the site: 4.5:1 body text contrast, 3:1 for large text and UI boundaries that carry meaning, visible focus on every control, full keyboard operation, meaningful accessible names that contain the visible label, status messages announced politely and errors assertively, state never conveyed by color alone, reduced-motion alternatives for every animation, and layouts that work from 320 CSS pixels up. Screen-reader use and real assistive-technology acceptance remain human checks.
