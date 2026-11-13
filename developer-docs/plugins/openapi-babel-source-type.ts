import type { Plugin } from '@docusaurus/types';
import type { RuleSetRule, RuleSetUseItem } from 'webpack';

// Docusaurus runs Babel over every package whose path contains "docusaurus", and Babel reads each file
// as an ES module by default. The compiled files of docusaurus-theme-openapi-docs and
// docusaurus-plugin-openapi-docs are CommonJS (`exports.default = ...`). Babel adds ES `import`
// statements for its helpers to the ones that need them, webpack then treats the file as an ES module,
// and the browser fails with "exports is not defined" on the reference pages.
//
// This plugin gives those files their own copy of Docusaurus's Babel rule with `sourceType:
// 'unambiguous'`, so a file without `import` or `export` stays a script and gets `require` helpers.
const OPENAPI_LIB = /docusaurus-(?:theme|plugin)-openapi-docs[\\/]lib[\\/]/;

const isBabelRule = (rule: unknown): rule is RuleSetRule & { exclude: (path: string) => boolean } =>
  typeof rule === 'object' &&
  rule !== null &&
  typeof (rule as RuleSetRule).exclude === 'function' &&
  JSON.stringify((rule as RuleSetRule).use ?? '').includes('babel-loader');

const withUnambiguousSource = (use: RuleSetRule['use']): RuleSetRule['use'] => {
  if (typeof use === 'function' || use === undefined) return use;
  const items = (Array.isArray(use) ? use : [use]) as RuleSetUseItem[];
  return items.map((item) =>
    typeof item === 'object' && 'loader' in item && String(item.loader).includes('babel-loader')
      ? { ...item, options: { ...(item.options as object), sourceType: 'unambiguous' } }
      : item,
  );
};

export default function openApiBabelSourceType(): Plugin {
  return {
    name: 'openapi-babel-source-type',
    configureWebpack: (config) => {
      const rules = config.module?.rules ?? [];
      const base = rules.find(isBabelRule);
      if (!base) throw new Error('openapi-babel-source-type: the Docusaurus Babel rule is not found');
      const patched = rules.map((rule) =>
        rule === base ? { ...base, exclude: (path: string) => OPENAPI_LIB.test(path) || base.exclude(path) } : rule,
      );
      patched.push({ ...base, exclude: undefined, include: OPENAPI_LIB, use: withUnambiguousSource(base.use) });
      return { mergeStrategy: { 'module.rules': 'replace' }, module: { rules: patched } };
    },
  };
}
