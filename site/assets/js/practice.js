// Practice page fixtures: a scrolling archive, an open shadow root and links loaded on demand.
const box = document.getElementById('archive-box');
if (box) {
  const taxa = ['Quercus robur', 'Tilia cordata', 'Platanus × acerifolia', 'Ginkgo biloba', 'Acer campestre'];
  box.replaceChildren(...Array.from({ length: 15 }, (_, i) => {
    const link = document.createElement('a');
    link.href = `https://archive.example.org/specimens/${String(i + 1).padStart(3, '0')}`;
    link.textContent = `Specimen ${String(i + 1).padStart(3, '0')} · ${taxa[i % taxa.length]}`;
    return link;
  }));
}

class SourceCard extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { display: block; padding: 14px 16px; border-radius: 12px; border: 1px dashed currentColor; }
      p { margin: 0 0 6px; font-weight: 700; }
      a { display: inline-block; margin-right: 14px; color: inherit; }
    </style><p>Inside a shadow root</p><a href="https://components.example.net/sources/tree-survey">Street tree survey</a><a href="https://components.example.net/sources/heat-map">Neighborhood heat map</a>`;
  }
}
customElements.define('source-card', SourceCard);
document.getElementById('shadow-host')?.append(document.createElement('source-card'));

const more = document.getElementById('load-more');
more?.addEventListener('click', () => {
  const list = document.getElementById('late-list');
  const items = [['Late source: rainfall and surface cooling', 'https://late.example.com/rainfall'], ['Late source: shade sail trial', 'https://late.example.com/shade-sails'], ['Late source: fountain misting study', 'https://late.example.com/misting']];
  list.replaceChildren(...items.map(([text, href]) => { const li = document.createElement('li'); const a = document.createElement('a'); a.href = href; a.textContent = text; li.append(a); return li; }));
  more.disabled = true; more.textContent = '3 sources loaded';
});
