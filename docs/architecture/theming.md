# Theming

Two kinds of themes exist in Cortext, and they use different APIs. Conflating them leads to wrong-shaped proposals, so the split is load-bearing.

## Content themes

The active WordPress block theme. Applies to published public pages on the front-end. Cortext does not interfere with the active theme; anything a row publishes as a page inherits templates, parts, and CSS from the site's theme exactly as any other WordPress content would.

## Shell themes

Token bundles (palette, typography, spacing) that style the workspace chrome: sidebar, canvas frame, inspector, toolbar. Cortext ships two shell themes, Cortext Light and Cortext Dark, and the Phase 1 contract covers a light/dark toggle.

Shell themes are a bounded cosmetic API. They define what the workspace looks like, not how it is laid out.

## What the contract covers, and what it does not

Covered: color tokens, typography scale, spacing scale, surface treatments. Anything a third-party shell theme needs to feel at home.

Not covered: component positioning, DataViews placement, sidebar structure, canvas grid, inserter layout. Cortext's product identity (sidebar-plus-canvas grid, component layout, DataViews placement) must not shift across installs. Structural overrides would ship a different product on every site; the token contract gives customization freedom without fragmenting the UX.

Structural theming is permanently out of scope.

## Phase 1 scope

- Token contract for the core palette, typography, and spacing.
- Light/dark toggle wired to the shell.
- Opt-in header/footer block patterns.
- Dark mode is chrome-only. The Gutenberg canvas stays light because blocks, inserters, and pickers are authored for light backgrounds.

## Later phases

- Phase 2: accent picker; public stability promise for the token contract.
- Phase 4: `cortext_theme_tokens` PHP filter opens shell themes to third parties as token bundles.
