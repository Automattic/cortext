# Theming

These are implementation notes for the current beta, not a stable
public API.

Cortext has two visual surfaces:

- The shell: sidebar, toolbar, buttons, empty states, and collection views.
- Content: published pages and the block editor canvas.

The shell is Cortext UI. Published content belongs to the active WordPress
theme. Cortext should not push shell colors into public pages or into the
editor iframe.

## Current behavior

Cortext has light, dark, and system color modes for the shell. The
preference is stored locally in the browser for now.

Collection views stay on a light surface even when the shell is dark. That
is a practical choice: DataViews and several WordPress controls still
assume a light admin canvas. Row detail is treated the same way; it is a
canvas-adjacent surface and stays light in both shell modes.

## Tokens

Shell colors are controlled by CSS custom properties:

- `src/styles/_tokens.scss`: shell chrome tokens. Live on `:root` for the
  accent/danger/option palette (so popovers and the editor iframe can
  resolve them) and on `.cortext-root` for surfaces, text, borders and
  state overlays (so dark mode can override via
  `.cortext-root[data-theme="dark"]`).
- `src/styles/_tokens-row-detail.scss`: row-detail tokens. Scoped to
  `.cortext-row-detail, .cortext-row-detail-modal`. Light-only by design;
  see "current behavior" above.

The tokens are useful for local experiments, but they are not a public
theme API yet. If shell theming becomes public later, the contract should
stay small: colors, basic radius, and maybe accent choices. Layout
changes should stay out of scope.

## Cortext-owned vs editor-owned accents

`var(--cortext-accent)` is the brand color for Cortext-rendered UI:
sidebar primary buttons, popover focus rings, row-detail input focus
rings, drag/drop indicators, the beta notice icon, cell link color,
relation chip focus, format-submenu selected tile, the canvas progress
bar, and so on.

`var(--wp-admin-theme-color)` is intentionally kept in a small set of
places where the surface belongs to the editor or follows the editor's
conventions:

- `.cortext-cell-bar` / `.cortext-cell-ring` default color: the "default"
  value in the number-format palette means "follow site default", which
  is the editor's accent.
- `cortext/document-icon` block selection outline: matches the editor's
  block-selection convention so it does not visually diverge from other
  blocks in the canvas.
- `FieldFormatPopover.js` default-color swatch: same semantic as the
  bar/ring above; "default" maps to the editor's accent.

If you add a new piece of Cortext UI, default to `--cortext-accent`. Only
fall back to `--wp-admin-theme-color` when the surface is genuinely
editor-owned or needs to track the editor's chrome.

## Destructive signal

`var(--cortext-danger)` is the Cortext-owned destructive red, with
`var(--cortext-danger-strong)` for hover/active states. Same value as
WordPress's destructive red so the visual stays familiar. Both live on
`:root` so popover-mounted destructive items can resolve them.

## Where this leaves us

The shell now reads from a coherent token contract. Light and dark
remain the two visible modes. The door is open for named variants
(`[data-cortext-variant="..."]`) and a font-family toggle to land later
without touching every shell-owned selector again. Those are feature
work, not part of this refactor.
