import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
// Written by `npm run gen` (docusaurus gen-api-docs); not committed.
import apiSidebar from './docs/reference/sidebar';

const sidebars: SidebarsConfig = {
  docs: [
    'introduction',
    'authentication',
    'envelope-and-errors',
    'rate-limits',
    'reading-the-stream',
    {
      type: 'category',
      label: 'API reference',
      link: { type: 'doc', id: 'reference/treklink-organization-api' },
      // The first entry is the info page, which the category link already shows.
      items: apiSidebar.slice(1),
    },
  ],
};

export default sidebars;
