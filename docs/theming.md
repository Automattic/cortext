# Theming

Keep two surfaces apart.

The shell is Cortext's UI: sidebar, toolbar buttons, empty states, and the frame around the work area. Cortext owns those pieces. Shell themes change them through CSS custom properties on `.cortext-root`.

Content is the other side. Published pages and the inside of Gutenberg's editor iframe follow the active WordPress block theme. Cortext does not add shell tokens to `wp_head` or pass shell colors into the iframe.

## Collection canvas

Collections are the awkward case. They render in the shell, but they are not document content. They are also not ready to follow arbitrary shell colors, because DataViews and many `@wordpress/components` controls still assume a light admin surface.

So collection routes get a light canvas of their own: `.cortext-canvas__table`. The Cortext shell can be dark around it, but the table stays on a surface DataViews handles well.

Do not confuse that with `--cortext-canvas-frame-surface`. That token still paints `.cortext-shell__canvas`: the empty state, the frame behind page routes, and the shell background around the editor iframe. Collection tables cover that frame with their light canvas. The dark override for `--cortext-canvas-frame-surface` is still live, even though collection routes hide it.

## The token contract (v1)

The contract lives in `src/styles/_tokens.scss`. These tokens name Cortext jobs, not Gutenberg variables. WordPress still provides useful defaults: the accent follows the admin/components accent, and base-styles handle ordinary spacing and density.

Theme authors should target Cortext roles instead of relying on whichever `--wp-*` variable happens to affect the right piece of chrome today.

### Shell roles

| Token | What it controls |
|-|-|
| `--cortext-shell-surface` | Root shell and shell toolbar surface |
| `--cortext-sidebar-surface` | Sidebar background |
| `--cortext-sidebar-item-hover-surface` | Hover surface for sidebar controls |
| `--cortext-sidebar-item-selected-surface` | Selected page/drop-target surface |
| `--cortext-canvas-frame-surface` | Shell frame around the work area; collection tables may cover it with their own canvas |
| `--cortext-chrome-border` | Borders between shell regions |
| `--cortext-text` | Primary shell text |
| `--cortext-text-muted` | Secondary shell text |
| `--cortext-accent` | Shell accent, defaulting to `--wp-components-color-accent` / `--wp-admin-theme-color` |
| `--cortext-accent-contrast` | Text/icon color on accent backgrounds |
| `--cortext-shadow-color` | Shell drag-preview shadow |

### Button roles

| Token | What it controls |
|-|-|
| `--cortext-button-surface` | Default shell button surface |
| `--cortext-button-text` | Default shell button text/icon color |
| `--cortext-button-hover-surface` | Hover/focus surface for shell buttons |
| `--cortext-button-pressed-surface` | Pressed shell button surface |
| `--cortext-button-primary-surface` | Primary shell button surface |
| `--cortext-button-primary-hover-surface` | Primary shell button hover/focus surface |
| `--cortext-button-primary-text` | Primary shell button text/icon color |

### Foundation roles

| Token | Default source |
|-|-|
| `--cortext-shell-font-family` | `inherit` |
| `--cortext-shell-font-size` | WordPress base-styles medium font size |
| `--cortext-shell-radius` | WordPress base-styles small radius |
| `--cortext-shell-border-width` | WordPress base-styles border width |

Spacing stays internal for now. The shell uses WordPress base-styles grid units directly. We should only expose spacing tokens if shell themes need to control density.

## Dark mode

Cortext has a three-way preference: Light, Dark, or Match system. The toggle lives in the sidebar header.

Dark mode changes shell chrome: sidebar, toolbar controls, empty state, and the editor frame. It does not darken the editor iframe. The active block theme owns the document surface.

Collection tables stay light for the same practical reason. DataViews renders in the shell, but its controls are still built for a light admin surface. Making that surface themeable is a separate job from darkening Cortext chrome.

Preference is stored in `localStorage` under `cortext.colorScheme`. `Cortext\Theming\Preferences::get_bootstrap_js()` stamps `data-theme` on the shell root before React mounts so reloads in dark don't flash light first.

## Roadmap

- Phase 1 (current): internal semantic token contract, light/dark/auto shell toggle, localStorage persistence.
- Phase 2: stable shell contract and an accent picker.
- Phase 3: per-user persistence through user meta.
- Phase 4: `cortext_theme_tokens` filter. Third parties can ship shell themes as token bundles, and the contract becomes public API.

## Extending (preview)

During phase 1, local experiments can use an override stylesheet loaded in the Cortext admin screen:

```css
.cortext-root {
	--cortext-sidebar-surface: #191724;
	--cortext-sidebar-item-selected-surface: #26233a;
	--cortext-button-primary-surface: #eb6f92;
	--cortext-button-primary-text: #191724;
}
```

Structural layout stays out of scope. A shell theme can't move the sidebar, remove the block inspector, or add new regions. The contract is cosmetic only.
