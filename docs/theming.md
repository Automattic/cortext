# Theming

Cortext draws a line between two kinds of themes: the shell, and the content. They serve different surfaces, use different APIs, and carry different compatibility promises.

## Two kinds of themes

| | Shell theme | Content theme |
|-|-|-|
| What it styles | The Cortext workspace chrome (sidebar, canvas frame, toolbars) | Published public pages |
| API surface | Token contract (CSS custom properties) | WordPress block theme (templates + CSS) |
| Who ships it | Cortext (phase 1), plus third parties (phase 4) | Any WordPress theme installed on the site |
| Customisable | Bounded: cosmetic tokens only | Unbounded: the full theme API |
| Coexists with WP themes | Yes. Shell theming does not touch the active WP theme | Yes. Cortext does not interfere with the active theme |

Both theme types are themeable. What is deliberately not themeable is the *structure* of the workspace: sidebar + canvas grid, DataViews placement, block inspector positioning. Those stay consistent across installs because the product identity rides on them. The shell-theme API is therefore a bounded cosmetic surface, not a full override hook.

## Shell theming: the token contract (v1)

The token contract is the API. Shell themes change values in it; they do not add new layout, new regions, or new components. Tokens are CSS custom properties declared on `.cortext-root`.

### Color

| Token | Light default | Dark override |
|-|-|-|
| `--cortext-color-canvas` | `#fff` | `#2a2a2a` |
| `--cortext-color-surface` | `#fff` | `#2a2a2a` |
| `--cortext-color-surface-raised` | `#f0f0f0` | `#383838` |
| `--cortext-color-border` | `#e0e0e0` | `#3e3e3e` |
| `--cortext-color-text` | `#1e1e1e` | `#f0f0f0` |
| `--cortext-color-text-muted` | `#757575` | `#a0a0a0` |
| `--cortext-color-accent` | `var(--wp-admin-theme-color, #3858e9)` | (same cascade) |
| `--cortext-color-accent-contrast` | `#fff` | `#fff` |
| `--cortext-color-shadow` | `rgba(0, 0, 0, 0.12)` | `rgba(0, 0, 0, 0.4)` |

### Typography

| Token | Default |
|-|-|
| `--cortext-font-family` | `inherit` (tracks wp-admin) |
| `--cortext-font-size-body` | `13px` |
| `--cortext-font-size-ui` | `13px` |

### Spacing and structure

| Token | Default |
|-|-|
| `--cortext-space-xs` | `4px` |
| `--cortext-space-sm` | `8px` |
| `--cortext-space-md` | `12px` |
| `--cortext-space-lg` | `16px` |
| `--cortext-space-xl` | `24px` |
| `--cortext-radius-sm` | `2px` |
| `--cortext-border-width` | `1px` |

The contract is emitted from two places: `src/styles/_tokens.scss` for the admin shell chrome, and `Cortext\Theming\Tokens::get_iframe_inline_css()` for the Gutenberg canvas iframe (injected via `editor_settings['styles']` so the values cross the iframe boundary). Keeping the two sources synchronized is the current maintenance cost. Phase 2 unifies them behind a single source of truth.

The contract deliberately does not reach the public frontend. Published pages are the active block theme's domain; Cortext does not emit any tokens, styles, or patterns on `wp_head` or anywhere else outside the editing surface.

## Dark mode

Phase 1 supports a three-way preference: Light, Dark, or Match system. The toggle lives in the sidebar header.

**Dark mode paints shell chrome.** The shell root carries `data-theme="dark"`, and that covers every chrome surface: sidebar, toolbars, and the canvas column that frames the iframe. The Gutenberg iframe interior is a separate surface: Cortext does not paint inside the iframe, so the active block theme and its `theme.json` keep control of it. Rationale for the split: Gutenberg blocks, inserters, color pickers, and media inspectors are authored against light backgrounds, and coordinating dark overrides across the block ecosystem is out of scope for phase 1. The same split shows up in Figma and VS Code: dark chrome around a content area that the document itself controls.

Persistence is `localStorage` for phase 1, keyed `cortext.colorScheme`. A pre-mount inline script (`Cortext\Theming\Preferences::get_bootstrap_js()`) stamps `data-theme` on the root before React mounts so the first paint matches the preference with no flash. Phase 3 moves persistence to user meta so the preference follows the user across browsers.

## Phased roadmap

- **Phase 1 (current)**: token contract v1, light/dark/auto shell toggle. Persistence in localStorage. Contract not yet public; internal consumers only.
- **Phase 2**: consolidate the SCSS and PHP emitters behind a single source. Publish the contract as stable. Ship an accent picker.
- **Phase 3**: per-user preference persistence (user meta).
- **Phase 4**: `cortext_theme_tokens` PHP filter. Third parties can ship shell themes as token bundles. Contract becomes part of the public API surface.

## Extending (preview)

Once phase 4 lands, a shell theme will look like:

```php
add_filter( 'cortext_theme_tokens', function ( $tokens ) {
	$tokens['color']['accent'] = '#8b5cf6';
	$tokens['color']['surface-raised'] = '#efe9ff';
	return $tokens;
} );
```

Structural layout is permanently out of scope. A shell theme cannot move the sidebar, remove the block inspector, or insert arbitrary regions. If a site needs structural divergence, the right tool is a WordPress plugin that replaces Cortext on that install, not a Cortext shell theme.
