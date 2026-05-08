# Roadmap

Cortext is still a prototype. The next goal is simple: make the WordPress-native
knowledge base model clear enough to test in public.

## Current prototype

The repo already has a usable first shape:

-   A full-screen admin shell.
-   Nested pages backed by Gutenberg.
-   Typed collections with table, grid, and list views.
-   Inline row editing, relation fields, rollups, and row details.
-   Collection views that can be embedded inside pages.
-   Basic public rendering for Cortext pages.
-   Experimental shell theming.

## Before this is production-ready

The storage model, REST responses, block attributes, and theme tokens still need
to settle. Until then, early data is disposable and migrations are not planned.

The next work should focus on:

-   Tightening the core page and collection workflows.
-   Hardening permissions, tests, accessibility, and editor edge cases.
-   Deciding which APIs are internal and which can become public.
-   Designing import/export around multiple sources, not one source too early.
-   Adding migrations only after the data model slows down.

Other ideas can wait until the basic model has had more real use.
