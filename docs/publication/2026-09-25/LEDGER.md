# Publication execution ledger

- New timer: 2026-09-25T22:20:18Z. No earlier timer inherited. One workflow dispatch authorized.
- Owner decision: direct ZIP download, extraction and Load unpacked is the primary distribution route. All browser stores, account setup, uploads and payments deferred. Existing 0.2.0 installation remains protected.
- Entry clean audit branch at e60cc8ee36f8dd081d71b640c7a4a7ea9b4cb402; source, package, protected refs and PR #1 matched expected state. No repository/ancestor AGENTS.md found.
- Created release branch from exact 696620091f7a92d3814e390582942c5f5db926b7. npm test 26/26; sync-site --check passed. All 13 ZIP members, receipt/source/site and protected installed files independently rechecked. No repackaging.
- PR #2 created, attached to task, exact head/base and absence of required checks verified. Merge-commit merge at ee3148ec584c51e49438bed097ffb70c9d9a6603. Both parents and identical tree verified; all 13 commits retained. Protected branches/tag unchanged. PR #1 became indirectly merged without direct actions.
- Set only this repository's Pages build_type to workflow. GitHub created its default github-pages environment/main branch policy. No protection was weakened; no additional account/security setting changed.
- Existing official action definitions checked: checkout/setup-node/configure-pages/deploy-pages use Node20 action runtime; setup-node selects Node22 for the script; upload-pages-artifact v3 wraps upload-artifact v4; deploy-pages v4 consumes github-pages. Actual runner compatibility remains subject to run result. No workflow edits.
- Dispatched pages.yml once on main; run 36196516959, head ee3148ec584c51e49438bed097ffb70c9d9a6603. First status queued. No retries authorized or attempted.
- Returned local checkout to audit branch for evidence. Live test harness prepared from approved tests/site-check.mjs with only live origin/server/output/runtime-path adaptations. It will run only after successful deployment.
