# Development

Use Node.js 22.19 or newer and pnpm 11.7.0.

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm pack --pack-destination dist
```

`check` runs TypeScript, localization, slider and model-settings regressions, compatibility configuration checks, and the build. Keep generated `lib/` files in sync with the source.

## Optional runtime integration

An installed DSH runtime can verify the built package without reading user data:

```text
node scripts/check-runtime.mjs <runtime-directory> <package-archive-or-directory>
```

The runtime directory must contain DSH's `package.json` and `node_modules`. The second argument may be a `.tgz` archive or an installed plugin directory. Omitting it tests the workspace build.

The test creates an isolated Profile under `.client-build/`, uses fictitious credentials, and intercepts all HTTP requests with simulated SSE responses. It covers explicit model opt-in, read-only status queries, cold startup and configuration updates without opening Settings, all four effort values, instruction roles, multi-round tool-history replay, scoped restore, and restart behavior. No real API endpoint or user Profile is required.

## Compatibility design

The provider-card contribution uses DSH's `settings.models.provider-card` extension, keyed by `llm-pi-ai`. Each saved custom model has a separate enable/disable action. A user choice binds to the provider, model ID, and normalized endpoint read from the active configuration. Installation alone selects nothing.

Only models confirmed by the user to accept the DeepSeek thinking format and Off / Low / High / Max should use this preset. The preset is not a discovery mechanism. It adds missing model fields, preserves explicit disable and existing custom settings, and exposes conflicts for deliberate repair.

Settings writes use native revision checks and ConfigEditor persistence. The journal records only fields changed by the plugin. Disabling the control stops maintenance and restores values only when they still equal the plugin's writes. Existing handwritten settings and subsequent user edits are retained. Changing a provider's endpoint does not transfer an existing opt-in to a new service.

## Distribution checks

```powershell
pnpm run check:distribution
```

This scans repository candidates for personal machine paths, credential-like literals, and accidentally included private configuration or logs. It also checks production compatibility code for fixed endpoint URLs. Pass an extracted package directory to scan the files actually distributed:

```text
node scripts/check-distribution.mjs <extracted-package-directory>
```

Tests and documentation use reserved example domains and fictitious credentials. Keep local runtime files, captures, Profiles, and notes under ignored directories. Package identity, public repository URLs, and upstream license attribution are intentional public metadata.
