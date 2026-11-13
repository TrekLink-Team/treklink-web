import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type * as OpenApiPlugin from 'docusaurus-plugin-openapi-docs';
import openApiBabelSourceType from './plugins/openapi-babel-source-type';

// TrekLink developer documentation, served by Caddy at https://<host>/developers/ (deploy/aws).
// Docs only: no blog, no pages, no analytics, no external fonts or CDN. The API reference under
// docs/reference is generated from openapi/organization-api.json (see README.md).
const config: Config = {
  title: 'TrekLink Developers',
  tagline: 'Read your fleet from your own systems',
  favicon: 'img/treklink-mark.webp',

  // The site is relative to the host it is served from; `url` only names the canonical origin.
  url: process.env.DOCS_SITE_URL ?? 'https://treklink.example',
  baseUrl: '/developers/',
  trailingSlash: true,

  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },

  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [
    [
      'classic',
      {
        docs: {
          // The introduction is the home page of the site.
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          docItemComponent: '@theme/ApiItem',
        },
        blog: false,
        pages: false,
        sitemap: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    'docusaurus-theme-openapi-docs',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // An index built at build time and searched in the browser: no request leaves the page.
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  plugins: [
    // Lets the CommonJS files of the openapi-docs packages through Docusaurus's Babel rule (see the file).
    openApiBabelSourceType,
    'docusaurus-plugin-sass',
    [
      'docusaurus-plugin-openapi-docs',
      {
        id: 'api',
        docsPluginId: 'classic',
        config: {
          organization: {
            // Written by scripts/prepare-spec.mjs (`npm run gen`): the committed file with the host's origin.
            specPath: 'openapi/organization-api.site.json',
            outputDir: 'docs/reference',
            sidebarOptions: { groupPathsBy: 'tag', categoryLinkSource: 'tag' },
          } satisfies OpenApiPlugin.Options,
        },
      },
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    navbar: {
      title: 'TrekLink Developers',
      logo: { alt: 'TrekLink', src: 'img/treklink-mark.webp' },
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Documentation' },
        {
          type: 'doc',
          docId: 'reference/treklink-organization-api',
          position: 'left',
          label: 'API reference',
        },
      ],
    },
    footer: {
      style: 'light',
      copyright: 'TrekLink. The organization API is read-only.',
    },
    docs: { sidebar: { hideable: false } },
    prism: { additionalLanguages: ['bash', 'json', 'python'] },
    languageTabs: [
      { highlight: 'bash', language: 'curl', logoClass: 'curl' },
      { highlight: 'python', language: 'python', logoClass: 'python' },
      { highlight: 'javascript', language: 'nodejs', logoClass: 'nodejs', variant: 'axios' },
    ],
  } satisfies Preset.ThemeConfig,
};

export default config;
