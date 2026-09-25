# Extension refinement brief

Make Link Meteor feel exceptionally clear, quick, and comfortable for research and collecting sources. You have creative latitude over aesthetics, information architecture, interaction details, responsive behavior, and internal implementation. Inspect the actual product, then create your own scaffolding and approach. The provisional off-white/graphite/warm-accent direction is not a constraint.

The product has a quiet region-selection overlay with live highlights/count and a compact action strip; a native side panel beside the source; and a full-width collection workbench. Improve the flow between capturing, understanding what was collected, curating sources, and exporting. Give particular attention to the narrow panel's density, scope and permission explanations, provenance discovery, selection/export confidence, and long collections. Preserve keyboard access, visible focus, meaningful names, light/dark support, and reduced motion. Screenshots in the evidence directory show implemented surfaces, not proposed designs.

## Functional outcomes to preserve

- Configurable shortcut-armed drag selection, partial/wrapped-link geometry, live count/highlights, Escape, scrolling, and appendable regions. Optional permitted hold-key mode must ignore editable typing and stop after permission revocation.
- Current page, selected open tabs, current window, and all ordinary windows in the current Chrome profile. Show the exact intended scope; retain successful results while distinguishing genuinely empty, denied, unsupported, closed, or failed pages.
- Visible anchor text and destination URL remain separate. Textless anchors stay empty. Accessible labels, source titles, original hrefs, source/frame URLs, times, batch identities, user notes/tags, and stable occurrences remain distinguishable. Never invent citation metadata or fetch destinations to replace labels.
- Named local collections, collection and per-link notes/tags, restart persistence, append, explicit deletion, review/search/domain/type/internal-external filters, sorting, selection, removal and undo. Deduplication is reversible and never destroys differing labels or source occurrences.
- Real `.xlsx`, CSV, clipboard, Markdown, HTML, JSON, and bookmark folders. Preserve configurable column order, two-column anchor/URL defaults, string fidelity, spreadsheet-formula safety, and escaped untrusted markup. URL lists and TSV are also implemented.
- Bounded opening and bookmarking of supported destinations, with count/skip feedback. No arbitrary automatic navigation, background crawling, or hidden permission expansion.
- All features free forever, no account, ads, telemetry, subscription, backend dependency, or destination enrichment. Keep privacy statements aligned with actual behavior.

The existing tests and contract provide regression evidence, not a required internal architecture. If a design change affects behavior, storage, permissions, exports, or compatibility, explain it explicitly and provide the relevant new evidence. Preserve users' existing local data across any schema change. Do not silently turn a design pass into reduced scope.

Deliver a coherent refined extension, original assets as needed, screenshots of actual states, an explanation of the main choices, and a precise functionality/permission change summary for Astra. Human usability and everyday Chrome/Excel checks remain open. The GitHub Pages site has a separate brief.
