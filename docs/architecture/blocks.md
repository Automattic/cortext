# Editor Blocks

Cortext runs Gutenberg with a short, explicit block list. `ALLOWED_BLOCK_TYPES` in `src/components/initEditor.js` owns the list, and `getEditorSettings()` passes it to every `EditorProvider` (Canvas and RowEditor) as `allowedBlockTypes`.

## Why allowlist, not denylist

The block editor checks the allowlist while it renders. That filters the inserter, slash search, paste, and programmatic inserts.

-   Third-party blocks registered later in the page load start hidden. We do not have to chase plugin names.
-   Removing a block from the list does not unregister it. `createBlock` and stored content keep working; the block just stops appearing in the inserter. That lets Cortext insert the locked `core/post-title` header while keeping it out of the user's picker.

## Supported blocks

Grouped by job. Edit `ALLOWED_BLOCK_TYPES` in `src/components/initEditor.js`; this doc should follow that list.

### Text and structure

`core/paragraph`, `core/heading`, `core/list`, `core/list-item`, `core/quote`, `core/pullquote`, `core/verse`, `core/code`, `core/preformatted`, `core/html`, `core/math`, `core/footnotes`, `core/details`, `core/post-title`.

### Media

`core/image`, `core/gallery`, `core/video`, `core/audio`, `core/file`, `core/cover`, `core/media-text`.

### Layout

`core/columns`, `core/column`, `core/group`, `core/separator`, `core/spacer`.

### Interactive

`core/button`, `core/buttons`, `core/accordion`, `core/accordion-item`, `core/accordion-heading`, `core/accordion-panel`, `core/social-link`, `core/social-links`.

### Utility

`core/table`, `core/embed`, `core/table-of-contents`, `core/icon`.

### Document metadata

`core/post-date`, `core/post-time-to-read`. Both read `postId` and `postType` from editor context, so they work directly in a Cortext document without a Query Loop. `core/post-time-to-read` accepts `displayMode: "words"` to show a word count instead of reading time.

### Reusable

`core/pattern` (internal placeholder for unsynced patterns), `core/block` (synced patterns).

### Cortext-native

`cortext/data-view`, `cortext/document-icon`, `cortext/document-cover`, `cortext/document-properties`.

## What stays out

These blocks stay out for specific reasons:

-   **External feeds** (`core/latest-posts`, `core/rss`, `core/archives`, `core/calendar`, `core/tag-cloud`, `core/page-list`, `core/home-link`, `core/latest-comments`, `core/categories`): read or render content the KB does not host.
-   **Site chrome** (`core/site-logo`, `core/site-title`, `core/site-tagline`, `core/navigation` family, `core/template-part`, `core/loginout`): belong to the theme or site shell, not to a document.
-   **Query Loop family** (`core/query`, `core/post-template`, `core/read-more`, `core/query-pagination*`, `core/query-no-results`, `core/query-title`, `core/query-total`): KB pages are documents, not feeds.
-   **Query-only post-context** (`core/post-content`, `core/post-featured-image`, `core/post-navigation-link`, `core/post-terms`, `core/post-author-biography`, `core/post-comment*`): only make sense inside a Query Loop. Cortext documents use `cortext/document-cover` instead of `core/post-featured-image`.
-   **Comments family**: not enabled on Cortext pages.
-   **Taxonomy / archive** (`core/avatar`, `core/breadcrumbs`, `core/term-*`, `core/terms-query`): Cortext doesn't expose taxonomy archives.
-   **Legacy and niche** (`core/more`, `core/nextpage`, `core/search`, `core/shortcode`, `core/text-columns`): not useful in a KB document.

## Special cases

### `core/post-title` is allowed, but hidden from the inserter

Cortext's `EnsureHeaderBlocks` (in `src/components/EditorBody.js`) inserts the title as a locked header. `insertBlocks` checks `allowedBlockTypes`; if we drop `core/post-title`, the header never lands.

To keep the block out of the picker, `initEditor.js` registers a `blocks.registerBlockType` filter that flips `supports.inserter` to `false`. The `cortext/document-*` header blocks do this in their own `block.json`.

### Post-author and post-excerpt require `register_post_type` supports

`core/post-author`, `core/post-author-name`, and `core/post-excerpt` rely on the post type declaring `supports: ['author']` or `supports: ['excerpt']`. Cortext's `crtxt_document` post type declares neither, so these blocks would fail or render empty. Leave them out until those supports exist.

### The `collections` inserter category

`src/components/collectionsBlockCategory.js` registers a `collections` category at module load, before the `../blocks` barrel runs. Without that, Gutenberg drops `"category": "collections"` while it processes each block registration.

Categories show up in the full inserter panel that the Quick Inserter's "Browse All" button opens (`CortextInserterSidebar`). `cortext/data-view` ("Collection view") leads the picker there; the `cortext/document-*` blocks share the category but stay hidden via `inserter: false`.

## Extending the list

Add or remove an entry in `ALLOWED_BLOCK_TYPES`. Run `pnpm test:unit -- tests/js/initEditor.test.js` to check the new entry lands in the expected group. The unit test covers the kept blocks and the documented exclusions; update the relevant assertion when the change is intentional.

If the new block ships with WordPress core under a name like `core/foo-bar`, also check whether it requires a `register_post_type` `supports` flag. The WP docs list those requirements per block. If it does, register the support on the post type before adding the block here.
