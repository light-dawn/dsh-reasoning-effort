# dsh-reasoning-effort

[简体中文](README.md) · [Development](DEVELOPMENT.md)

Adjust reasoning effort in DSH's native model selector and enable DeepSeek request compatibility for individual models in Settings.

Package: `@light-dawn/dsh-reasoning-effort`, development version `0.10.0-dev.2`. Targets DSH Desktop `0.2.2-rc.1`. Not published to npm.

## Usage

1. Save a custom provider and model in DSH.
2. Open **Settings → Models** and locate the model in its provider card.
3. For a model confirmed to support the DeepSeek thinking format, click **Enable reasoning control**.
4. Select Off, Low, High, or Max in the chat model menu.

Each model is enabled separately. The provider, model ID, and API address come from the active configuration. No particular relay is built in, and installation does not select any models.

The preset supports `llm-pi-ai` with `openai-completions` and models that accept these request fields:

| Level | `thinking.type` | `reasoning_effort` |
| --- | --- | --- |
| Off | `disabled` | Omitted |
| Low | `enabled` | `low` |
| High | `enabled` | `high` |
| Max | `enabled` | `max` |

Instructions use `system`; the official adapter replays thinking history. The plugin does not discover endpoint capabilities. Enable the preset only where the service supports it.

## Disabling and existing settings

**Disable reasoning control** stops maintenance for the model and reverts only plugin-written values the user has not changed. Original handwritten settings remain, so DSH or another interface may still display existing levels after plugin management is disabled.

Custom levels and conflicting compatibility settings are preserved until an explicit repair action. An intentional `reasoningEfforts: false` is respected. Changing a provider's endpoint does not transfer an existing opt-in to the new service.

The model-settings button manages configuration; Off in the chat slider disables thinking for a request. Default uses the configured provider effort. Without one, the official adapter in DSH `0.2.2-rc.1` disables thinking.

## Install the development version

In DSH Desktop **Plugins → Add plugin**, enter:

```text
github:light-dawn/dsh-reasoning-effort
```

When switching from upstream, disable or remove `@ayanehana/dsh-reasoning-effort` first to avoid duplicate controls. Reload when prompted.

Alternatively, build from source:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm pack --pack-destination dist
```

For local installation, use an absolute path to the `.tgz` archive or the extracted directory containing `package.json`. A Windows path starts with its drive letter; omit any leading slash introduced by a rendered file link.

## Validation

Type, localization, slider/model-settings regressions, configuration protection, and restore tests pass. Actual DSH `0.2.2-rc.1` modules verify per-model opt-in, startup and update maintenance, all four efforts, tool-history replay, and scoped restore in an isolated Profile. All HTTP requests are intercepted with fictitious credentials and simulated SSE.

Full desktop window installation, live API calls, other DSH versions, and Web Profile have not completed end-to-end validation. See [DEVELOPMENT.md](DEVELOPMENT.md) for repeatable checks.

## Attribution and license

Based on [HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort). Upstream slider, animation, model selection, effort memory, MIT copyright, and [license](LICENSE) are preserved. This fork adds user-selected per-model request compatibility, conflict handling, and restore.
