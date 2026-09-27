# @boothconnect/eslint-config

Shared ESLint 10 flat-config presets. Formatting is handled by Prettier (root
`.prettierrc.json`); these presets switch off every rule that conflicts with it.

| Preset                             | Use in           | Adds                                                                                                                                            |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@boothconnect/eslint-config/base` | Any TS package   | `@eslint/js` + `typescript-eslint` recommended, `eqeqeq`, `consistent-type-imports`, `_`-prefixed unused vars allowed                           |
| `@boothconnect/eslint-config/nest` | `apps/api`       | Type-aware rules (`no-floating-promises` …), Node + Jest globals. **No** `consistent-type-imports`, because Nest DI needs runtime type metadata |
| `@boothconnect/eslint-config/next` | `apps/admin-web` | Next.js core-web-vitals and React Hooks rules, browser globals                                                                                  |

## Usage (one line)

```js
// eslint.config.js
export { default } from '@boothconnect/eslint-config/nest';
```

Add `"@boothconnect/eslint-config": "workspace:*"` and `eslint` to the app's
devDependencies. To extend: `export default [...preset, { rules: { … } }]`.
