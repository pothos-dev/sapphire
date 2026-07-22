import { test, expect } from 'bun:test';
import { mermaidThemeConfig, mermaidCacheKey } from '../editor/mermaidTheme';

// The web mermaid island's pure bits: the reused theming / cache-key helpers
// (the render/DOM path needs a browser and is covered by the Playwright spec).

test('mermaidThemeConfig is the shared, CM-free helper (base theme + darkMode)', () => {
  const read = (name: string) => `val(${name})`;
  const light = mermaidThemeConfig(read, 'light');
  const dark = mermaidThemeConfig(read, 'dark');
  expect(light.theme).toBe('base');
  expect(light.themeVariables.darkMode).toBe(false);
  expect(dark.themeVariables.darkMode).toBe(true);
  // Concrete resolved values are baked in (mermaid bakes colours at render time).
  expect(light.themeVariables.primaryColor).toBe('val(--bg-elevated)');
});

test('mermaidCacheKey distinguishes source and theme', () => {
  expect(mermaidCacheKey('graph TD', 'light')).toBe('light graph TD');
  expect(mermaidCacheKey('graph TD', 'dark')).not.toBe(mermaidCacheKey('graph TD', 'light'));
});
