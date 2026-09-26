// "Link Meteor in under a minute": select, save, review, group, export.
// Clip times are seconds into a recorded clip or `mark±offset`; camera focus `at` uses the
// logged pointer position at that mark. See media/README.md for how each scene was made.
export default {
  id: 'link-meteor-demo',
  title: 'Link Meteor in under a minute',
  fps: 30,
  fade: 0.4,
  poster: 11.3,
  scenes: [
    {kind: 'card', variant: 'intro', duration: 3.6, kicker: 'A free Chrome extension', tagline: 'Capture the trail. <span>Keep the source.</span>',
      describe: 'The Link Meteor artwork: a glowing lime meteor beside the name.'},
    {kind: 'clip', clip: 'demo-select', from: 'shortcut-1.1', to: 'status+2.9', label: 'Practice page · reading list',
      expect: [{mark: 'count', equals: '7 links selected'}, {mark: 'status', startsWith: 'Saved 7 links to “Urban heat islands: sources”'}],
      keys: {t0: 'shortcut-0.1', t1: 'armed+1.3', caps: ['⌥', '⇧', 'L'], note: '<b>Option Shift L</b>Alt Shift L on Windows and Linux'},
      camera: [{t: 0, zoom: 1, cx: 640, cy: 360}, {t: 'drag-start', zoom: 1, cx: 640, cy: 360}, {t: 'drag-start+0.8', zoom: 1.12, cx: 560, cy: 330}, {t: 'released', zoom: 1.12, cx: 560, cy: 330}, {t: 'released+0.7', zoom: 1.5, cx: 1060, cy: 540}],
      captions: [
        {t0: 'shortcut-0.9', t1: 'drag-start-0.1', text: 'Press the shortcut on any page to select a region.'},
        {t0: 'drag-start', t1: 'released', text: 'Drag across the links you want. Each match lights up.'},
        {t0: 'released+0.1', t1: 'added-0.1', text: '7 links selected, and the card says where they’ll go.'},
        {t0: 'added', t1: 'status+2.9', text: 'Add them to a collection, or copy two columns right away.'}],
      describe: 'On the practice page, the reading list is selected with a drag. Seven links are highlighted, and a card reads “7 links selected, adds to Urban heat islands: sources.” Add to collection saves them.'},
    {kind: 'clip', clip: 'demo-workbench', from: 0.3, to: 'downloaded+2.7', label: 'Link Meteor full view',
      expect: [{mark: 'downloaded', equals: 'Urban-heat-islands-sources.xlsx'}],
      camera: [{t: 0, zoom: 1.18, cx: 610, cy: 330}, {t: 'empty-anchor-0.9', zoom: 1.18, cx: 610, cy: 330}, {t: 'empty-anchor-0.2', zoom: 1.45, at: 'empty-anchor', dx: 80, dy: 10},
        {t: 'list-top-0.1', zoom: 1.45, at: 'empty-anchor', dx: 80, dy: 10}, {t: 'list-top+0.6', zoom: 1.12, cx: 620, cy: 330}, {t: 'details-0.5', zoom: 1.12, cx: 620, cy: 330}, {t: 'details+0.4', zoom: 1.2, cx: 600, cy: 400},
        {t: 'ungrouped-0.8', zoom: 1.2, cx: 600, cy: 400}, {t: 'ungrouped', zoom: 1.12, cx: 620, cy: 330}, {t: 'download-0.9', zoom: 1.12, cx: 620, cy: 330}, {t: 'download', zoom: 1.35, at: 'download', dx: -60, dy: -120}],
      captions: [
        {t0: 0.4, t1: 'empty-anchor-0.3', text: 'Anchor text, URL and source page stay in <em>separate fields</em>.'},
        {t0: 'empty-anchor-0.2', t1: 'view-open-0.3', text: 'An image link keeps empty anchor text. Its alt text is kept as a separate label.'},
        {t0: 'view-open-0.2', t1: 'details-0.2', text: 'Group by URL when you want. Every label stays visible.'},
        {t0: 'details-0.1', t1: 'ungrouped-0.3', text: 'Open a group to see each occurrence and where it came from.'},
        {t0: 'ungrouped-0.2', t1: 'download-0.2', text: 'Switch back any time. All 7 occurrences are still there.'},
        {t0: 'download-0.1', t1: 'downloaded+2.7', text: 'Download Excel, CSV, Markdown, JSON and more.'}],
      describe: 'The full view lists the seven links with anchor text, URL and source page in separate columns. The image link shows “No anchor text” with its accessible label. Grouping by URL shows one link twice, also labeled “the canopy study”, and its details list both occurrences. Removing the grouping restores all seven rows, and Download Excel file saves a workbook.'},
    {kind: 'sheet', duration: 6.2, label: 'The downloaded workbook, opened with a file reader', file: 'Urban-heat-islands-sources.xlsx', source: 'demo-export.xlsx', highlight: 6,
      captions: [{t0: 0.3, t1: 2.9, text: 'Two clean columns: anchor text and URL.'}, {t0: 3.0, t1: 6.2, text: 'The image link’s anchor text stays empty. Nothing is invented.'}],
      describe: 'The downloaded workbook has a header row and seven rows of anchor text and URL; the image link’s anchor text cell is empty.'},
    {kind: 'card', variant: 'outro', duration: 5.2, title: 'Capture the trail. <span>Keep the source.</span>', promises: ['Free forever', 'No account', 'No tracking', 'Stays in your browser'], url: 'ryanjosephkamp.github.io/link-meteor', by: 'Made by Ryan Kamp',
      describe: 'Closing card: free forever, no account, no tracking, stays in your browser. The website address and “Made by Ryan Kamp.”'},
  ],
};
