// The PDF the demo captures: a two-page article in the practice page's synthetic world (the
// reading list's first paper, with references to papers in its search results). It is built with
// the same writer as the PDF test fixtures (tests/fixtures/pdf/make.mjs), so every link's
// rectangle is exact, and the bytes are the same on every run. Every link points to an example domain.
import { makePdf } from '../../tests/fixtures/pdf/make.mjs';

export const PRACTICE_PDF_PATH = '/articles/uhi-2024-0142.pdf';
export const PRACTICE_PDF_TITLE = 'Surface temperature and tree canopy in 40 mid-sized cities';

const body = (parts) => ({ face: 'Times', size: 11, parts });

export function practicePdf() {
  return makePdf({
    info: { Title: PRACTICE_PDF_TITLE, Author: 'R. Ortega; M. Lin' },
    pages: [[
      { face: 'Times', size: 9, parts: ['Journal of Example Climate 14 (2024) 142-151, doi:10.5555/uhi.2024.0142'] },
      { skip: 18 },
      { face: 'Times', size: 17, parts: [PRACTICE_PDF_TITLE] },
      { face: 'Times', size: 11, parts: ['R. Ortega and M. Lin'] },
      { skip: 14 },
      body(['Abstract. We compare afternoon land surface temperature with tree canopy cover in 40 mid-sized']),
      body(['cities. Each ten points of canopy cover lowered the surface temperature of a block by about 1.4 degrees.']),
      { face: 'Times', size: 11, parts: ['The canopy rasters are in ', { text: 'the canopy data archive', url: 'https://data.example.org/canopy-40' }, ', and the analysis is in ', { text: 'the project repository', url: 'https://code.example.org/uhi-canopy' }, '.'] },
      { face: 'Times', size: 11, parts: ['An ', { text: 'interactive map', url: 'https://maps.example.org/canopy-40' }, ' shows the afternoon temperature of every block.'] },
    ], [
      { face: 'Times', size: 13, parts: ['References'] },
      { skip: 4 },
      { face: 'Times', size: 10, parts: ['[1] E. Varga. ', { text: 'Cool roofs: a ten-year field comparison', url: 'https://doi.org/10.5555/roof.2022.0310' }, '. Journal of Example Climate, 2022.'] },
      { face: 'Times', size: 10, parts: ['[2] K. Mensah and L. Duarte. ', { text: 'Reflective coatings and indoor temperature in social housing', url: 'https://doi.org/10.5555/roof.2019.0077' }, '.'] },
      { face: 'Times', size: 10, x: 86, parts: ['Example Buildings Review, 2019.'] },
      { face: 'Times', size: 10, parts: ['[3] S. Ivanova. ', { text: 'Albedo, asphalt and afternoon peaks', url: 'https://doi.org/10.5555/roof.2018.0521' }, '. Example Urban Studies, 2018.'] },
    ]],
  });
}
