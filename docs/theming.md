# Theming

These are implementation notes for the current prototype, not a stable public
API.

Cortext has two visual surfaces:

-   The shell: sidebar, toolbar, buttons, empty states, and collection views.
-   Content: published pages and the Gutenberg editor canvas.

The shell is Cortext UI. Published content belongs to the active WordPress theme.
Cortext should not push shell colors into public pages or into the editor iframe.

## Current behavior

Cortext has light, dark, and system color modes for the shell. The preference is
stored locally in the browser for now.

Collection views stay on a light surface even when the shell is dark. That is a
practical choice: DataViews and several WordPress controls still assume a light
admin canvas.

## Tokens

Shell colors are controlled by CSS custom properties in
`src/styles/_tokens.scss`. They are useful for local experiments, but they are
not a public theme API yet.

If we make shell theming public later, the contract should stay small: colors,
basic radius, and maybe accent choices. Layout changes should stay out of scope.
