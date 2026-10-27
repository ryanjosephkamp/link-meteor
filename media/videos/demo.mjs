// "Link Meteor in about a minute": select, save, review, group, export, then the links inside a PDF.
// Clip times are seconds into a recorded clip or `mark±offset`; camera focus `at` uses the
// logged pointer position at that mark. See media/README.md for how each scene was made.
const EXPORT_NAME = '^Urban-heat-islands-sources_\\d{4}-\\d{2}-\\d{2}_\\d{4}\\.xlsx$';

export default {
  id: 'link-meteor-demo',
  title: 'Link Meteor in about a minute',
  fps: 30,
  fade: 0.4,
  poster: 12.4,
  scenes: [
    {kind: 'card', variant: 'intro', duration: 3.6, kicker: 'A free Chrome extension', tagline: 'Capture the trail. <span>Keep the source.</span>',
      describe: 'The Link Meteor artwork: a glowing lime meteor beside the name.'},
    {kind: 'clip', clip: 'demo-select', from: 'shortcut-1.1', to: 'status+2.9', label: 'Practice page · reading list',
      expect: [{mark: 'count', equals: '7 links selected'}, {mark: 'destination', equals: 'Adds to Urban heat islands: sources'}, {mark: 'status', equals: 'Saved 7 links to “Urban heat islands: sources”.'}],
      keys: {t0: 'shortcut-0.1', t1: 'armed+1.3', caps: ['⌥', '⇧', 'L'], note: '<b>Option Shift L</b>Alt Shift L on Windows and Linux'},
      camera: [{t: 0, zoom: 1, cx: 640, cy: 360}, {t: 'drag-start', zoom: 1, cx: 640, cy: 360}, {t: 'drag-start+0.8', zoom: 1.12, cx: 560, cy: 330}, {t: 'released', zoom: 1.12, cx: 560, cy: 330}, {t: 'released+0.7', zoom: 1.5, cx: 1060, cy: 530}],
      captions: [
        {t0: 'shortcut-0.9', t1: 'drag-start-0.1', text: 'Press the shortcut on any page to select a region.'},
        {t0: 'drag-start', t1: 'released', text: 'Drag across the links you want. Each match lights up.'},
        {t0: 'released+0.1', t1: 'added-0.1', text: '7 links selected, and the card says where they’ll go.'},
        {t0: 'added', t1: 'status+2.9', text: 'Add them to a collection, or copy two columns right away.'}],
      describe: 'On the practice page, the reading list is selected with a drag. Seven links are highlighted, and a card reads “7 links selected” and “Adds to Urban heat islands: sources.” Add to collection saves them.'},
    {kind: 'clip', clip: 'demo-workbench', from: 0.3, to: 'downloaded+2.6', label: 'Link Meteor full view',
      expect: [{mark: 'rows', equals: '7 links'}, {mark: 'occurrences', equals: '2'}, {mark: 'total', equals: '7 links'}, {mark: 'downloaded', matches: EXPORT_NAME}],
      // At 1.4x the picture holds the collections rail and the list exactly, up to the Export column.
      camera: [{t: 0, zoom: 1.4, cx: 457, cy: 300}, {t: 'empty-anchor-0.9', zoom: 1.4, cx: 457, cy: 300}, {t: 'empty-anchor-0.2', zoom: 1.4, cx: 457, cy: 470},
        {t: 'list-top-0.1', zoom: 1.4, cx: 457, cy: 470}, {t: 'list-top+0.6', zoom: 1.4, cx: 457, cy: 300},
        {t: 'export-column-0.1', zoom: 1.4, cx: 457, cy: 300}, {t: 'export-column+0.8', zoom: 1.4, cx: 840, cy: 470}],
      captions: [
        {t0: 0.4, t1: 'empty-anchor-0.3', text: 'Anchor text, URL and source page stay in <em>separate fields</em>.'},
        {t0: 'empty-anchor-0.2', t1: 'view-open-0.3', text: 'An image link keeps empty anchor text. Its alt text is kept as a separate label.'},
        {t0: 'view-open-0.2', t1: 'details-0.2', text: 'Group by URL when you want. Every label stays visible.'},
        {t0: 'details-0.1', t1: 'ungrouped-0.3', text: 'Open a group to see each occurrence and where it came from.'},
        {t0: 'ungrouped-0.2', t1: 'download-0.2', text: 'Switch back any time. All 7 occurrences are still there.'},
        {t0: 'download-0.1', t1: 'downloaded+2.6', text: 'Download Excel, CSV, JSON, BibTeX and more.'}],
      describe: 'The full view lists the seven links, each with its anchor text, URL and source page on lines of their own. The image link shows “No anchor text” with its accessible label. Grouping by URL shows one link twice, also labeled “the canopy study”, and its details show each occurrence with its own anchor text and source page. Removing the grouping restores all seven rows, and Download Excel file saves a workbook.'},
    {kind: 'sheet', duration: 6.2, label: 'The downloaded workbook, opened with a file reader', file: {clip: 'demo-workbench', mark: 'downloaded'}, source: 'demo-export.xlsx', highlight: 'empty', rowCount: 7,
      captions: [{t0: 0.3, t1: 2.9, text: 'Two clean columns: anchor text and URL.'}, {t0: 3.0, t1: 6.2, text: 'The image link’s anchor text stays empty. Nothing is invented.'}],
      describe: 'The downloaded workbook has a header row and seven rows of anchor text and URL; the image link’s anchor text cell is empty.'},
    {kind: 'clip', clip: 'demo-pdf', from: 0.3, to: 'notice+2.6', label: 'Side panel', layout: 'panel', still: 'demo-pdf-still.jpg', stillLabel: 'PDF tab',
      expect: [{mark: 'label', equals: 'Capture this PDF'}, {mark: 'pages', equals: 'p. 1 p. 1 p. 1 p. 2 p. 2 p. 2'}, {mark: 'summary', equals: 'Adds 6 links from 2 of 2 pages, and the PDF itself as a link.'}, {mark: 'notice', equals: 'Added 6 links and the PDF itself to “Urban heat islands: sources”.'}],
      camera: [{t: 0, zoom: 1, cx: 200, cy: 360}],
      captions: [
        {t0: 0.3, t1: 'capture-0.1', text: 'New in 1.0: on a PDF’s tab, Link Meteor reads the links inside the PDF.'},
        {t0: 'capture', t1: 'scroll-0.1', text: 'A preview shows every link with its page. Nothing is saved yet.'},
        {t0: 'scroll', t1: 'notice+2.6', text: 'Add them in one step, with the PDF itself as a link.'}],
      describe: 'Beside a PDF of the reading list’s first paper, the Link Meteor side panel offers Capture this PDF. Its preview, “Links in this PDF,” shows the DOI and title read from the PDF and six links with their page, anchor text and address. Add 6 links saves them, and a notice reads “Added 6 links and the PDF itself to Urban heat islands: sources.”'},
    {kind: 'card', variant: 'outro', duration: 5.2, title: 'Capture the trail. <span>Keep the source.</span>', promises: ['Free forever', 'No account', 'No tracking', 'Stays in your browser'], url: 'ryanjosephkamp.github.io/link-meteor', by: 'Made by Ryan Kamp',
      describe: 'Closing card: free forever, no account, no tracking, stays in your browser. The website address and “Made by Ryan Kamp.”'},
  ],
};
