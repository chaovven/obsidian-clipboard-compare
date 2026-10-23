import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['node_modules/**', 'dist/**', 'tests/**', 'main.js', 'main.css', 'styles.css', 'test-results/**', '*.mjs'] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } } },
]);
