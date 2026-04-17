# Architecture

## Content model

### CPTs

Two post types:

- `cortext_page` holds workspace documents. Free-form Gutenberg canvas, hierarchical. Static registration with `hierarchical=true`, supporting editor, title, revisions, author, and page-attributes.
- `cortext_collection_{slug}` is one dynamically-registered CPT per collection. Registered at `init` priority 10 from the `cortext_collections` option. Supports editor, title, and revisions (rows are also editable pages). Has `taxonomies=['cortext_supertag']`.

Every collection row is a post with its own `post_content`. That means any row is itself an editable page that can embed a Collection View block. Collection-in-collection works out of the box.

### Taxonomy: `cortext_supertag` (cross-type taxonomy)

The polymorphism primitive. The pitch calls this a "cross-type taxonomy" (user-facing name pending a final catchy label); internally the WordPress slug is `cortext_supertag`, a working name inspired by Tana's super tags. If the user-facing name lands before implementation, rename the slug to match.

A single global taxonomy, registered at `init` priority 5 with empty `object_type=[]`, then attached to every collection CPT via the `taxonomies` argument when each collection CPT is registered at priority 10.

- Term meta (`cortext_properties`) carries the supertag's property schema: `[{uuid, label, type, config}]`.
- `show_in_rest=true` enables supertag CRUD at `/wp/v2/cortext_supertag`.
- Caps are shared across all CPTs the taxonomy is attached to (a WordPress taxonomy constraint). Per-collection gating on supertag assignment, if needed later, goes through `map_meta_cap`.

### Properties

```ts
{
  uuid: string,                 // stable identity, becomes meta key _cortext_{uuid}
  label: string,                // human-facing, not used as key
  type: 'text' | 'number' | 'email' | 'url'
      | 'select' | 'multiselect'
      | 'date' | 'datetime' | 'checkbox'
      | 'relation' | 'formula',
  config: { /* per-type options */ }
}
```

Phase 2 adds: `image`, `file`, `user_ref`, `post_ref`, `color`, `repeater`, `group`, conditional display.

### Meta registration

At `init` priority 10 (after both the CPTs and the supertag taxonomy exist):

1. For each collection in `cortext_collections`, call `register_post_type('cortext_collection_'.$slug, [..., 'taxonomies' => ['cortext_supertag']])`. For each property, call `register_post_meta` with the meta key `_cortext_{uuid}`.
2. For each supertag term, call `register_post_meta` for each contributed property, with the same `_cortext_{uuid}` key, on every collection CPT. The same meta key on multiple subtypes is explicitly supported (WP 4.9.8+).

Registration is idempotent. It happens on `init` rather than `rest_api_init` to avoid the default-value propagation issue in Trac #56718.

## The `resolved_schema` contract

Clients read one field to know which properties apply to a row. There are two contexts.

### Row schema

For editing a single row, for bindings inside its page, for detail views.

```
GET /wp/v2/cortext-collection-tasks/{id}?_fields=id,title,meta,cortext_row_resolved_schema
```

Returns the union of the collection CPT's own property schemas and this row's assigned supertag terms' contributed property schemas.

Two rows in the same collection can have different row schemas if they carry different supertags.

### View schema

For DataViews rendering a list. DataViews needs one `fields` array for the whole list.

```
GET /cortext/v1/collections/{slug}/view-schema?filters=...
```

Returns the union of the collection CPT's property schemas and the contributed schemas of every supertag present on at least one row in the filtered list.

Rows lacking a given supertag return `undefined` from `getValue` for that column; DataViews renders an empty cell.

### Shape of a schema entry

```ts
{
  uuid: string,
  label: string,
  metaKey: string,              // _cortext_{uuid}
  type: PropertyType,
  config: { /* per-type */ },
  source: {
    kind: 'collection' | 'supertag',
    id: number,                 // collection CPT id in registry, or term id
    label: string               // for disambiguation: "Status (from Urgent)"
  }
}
```

### Caching

Row schemas are cached by `(post_type, sorted assigned term tt_ids)`. View schemas are cached by `(post_type, filter signature)`. Invalidation triggers: collection property CRUD, supertag CRUD, and row term assignment changes. Hook `edited_term`, `created_term`, `deleted_term`, `set_object_terms`, and the custom property-edit REST route.

### Unassignment semantics

Removing a supertag from a row does not delete contributed meta values. Reassigning restores visibility. This matches Notion's "remove tag, keep data" behavior. No `set_object_terms` hook is needed for cleanup.

## UI shell

A single React SPA mounted on a full-screen admin page.

```
┌───────────────┬────────────────────────────────────┐
│               │  Page/Row title                     │
│    Sidebar    ├────────────────────────────────────┤
│    ━━━━━━     │                                     │
│    Pages      │   EditorProvider + BlockCanvas      │
│    └ child    │   (documents and rows)              │
│    ━━━━━━     │                                     │
│    Collections│   or                                │
│    - Tasks    │                                     │
│    - Docs     │   <DataViews>                       │
│    ━━━━━━     │                                     │
│    Supertags  │                                     │
│    - Urgent   │                                     │
└───────────────┴────────────────────────────────────┘
```

Chrome is hidden via the `is-fullscreen-mode` body class (the Site Editor pattern). Phase 2 may move to a custom URL via rewrite rule and `template_redirect`. The React shell is URL-agnostic, so the move is plumbing rather than architecture.

### Bootstrap (follows the `edit-site` recipe)

1. PHP registers the admin page, adds `is-fullscreen-mode` on `load-{hook}`, preloads REST via `block_editor_rest_api_preload()`, enqueues scripts with deps `['wp-editor', 'wp-block-editor', 'wp-block-library', 'wp-blocks', 'wp-components', 'wp-data', 'wp-dataviews', 'wp-keyboard-shortcuts', 'wp-media-utils']`, calls `get_current_screen()->is_block_editor(true)`, and inlines settings from `get_block_editor_settings([], new WP_Block_Editor_Context(['name' => 'cortext/editor']))`.
2. JS `initializeEditor('cortext-root', settings)` runs `createRoot`, `registerCoreBlocks`, registers Cortext blocks, registers the `cortext/property` Block Bindings source, then renders `<App />`.
3. Provider stack: `<StrictMode><ShortcutProvider><SlotFillProvider><InternalRouter><Shell /></InternalRouter></SlotFillProvider></ShortcutProvider></StrictMode>`.

### Sidebar data

- Pages: `useEntityRecords('postType', 'cortext_page', {per_page: 100, _fields: 'id,title,parent,menu_order'})`, client-side tree build.
- Collections: custom route `/cortext/v1/collections` returning collection definitions from the option.
- Supertags: `useEntityRecords('taxonomy', 'cortext_supertag', {per_page: 100, _fields: 'id,name,slug,meta'})`.

## Property editing: DataForm plus Block Bindings

### Layer 1: DataForm (primary editor)

The `@wordpress/dataviews` package ships a sibling called `DataForm` that renders a typed editor for a single record from the same `fields` definitions DataViews uses.

- Mounted at the top of every row's page (above the block canvas) or in a right-sidebar panel.
- Same field controls as DataViews cell editing: date picker, select, relation picker modal, multiselect chips.
- Driven by the row-resolved schema. Automatically shows collection properties plus any applied supertags.
- Zero bespoke UI per property type. Each type is defined once in `buildDataViewsField`, and both DataViews and DataForm consume it.

### Layer 2: Block Bindings (inline content and theme rendering)

Register one custom Block Bindings source, `cortext/property`, that exposes every property as a bindable source for any block attribute.

PHP (frontend render):

```php
register_block_bindings_source('cortext/property', [
  'label' => 'Cortext Property',
  'uses_context' => ['postId', 'postType'],
  'get_value_callback' => function($args, $block, $attr) {
    $post_id = $block->context['postId'] ?? get_the_ID();
    return get_post_meta($post_id, '_cortext_' . $args['uuid'], true);
  },
]);
```

JS (editor UI and in-place editing):

```js
import { registerBlockBindingsSource } from '@wordpress/blocks';

registerBlockBindingsSource({
  name: 'cortext/property',
  usesContext: ['postId', 'postType'],
  getFieldsList({ select, context }) {
    const schema = selectResolvedSchema(select, context.postType, context.postId);
    return Object.fromEntries(
      schema.properties.map(p => [
        `${p.source.kind}:${p.uuid}`,
        { label: p.label, type: dataTypeFor(p.type), args: { uuid: p.uuid } }
      ])
    );
  },
  getValues({ select, context, bindings }) { /* read meta via core-data */ },
  setValues({ dispatch, context, bindings }) { /* write meta via core-data */ },
  canUserEditValue: () => true,
});
```

What this unlocks:

- Property values flow into a row's own free-form block content. Bind a heading to `$status`, a paragraph to `$notes`, and so on.
- Documents can reference arbitrary row data. A dashboard page showing the active sprint's name, for example.
- Classic and block themes can render bound values on the frontend.
- All property types are bindable, including relations (chip list), multiselect, and formula-computed values.
- Core's `core/term-data` binding source cannot expose term meta, so a custom source is required for supertag-contributed properties. It's not optional.

## DataViews integration

### The Collection View block (`cortext/collection-view`)

- Attributes: `collectionSlug`, `viewConfig` (filters, sort, layout, visibleFields).
- `edit`: mounts `<DataViews>` inside `<div contentEditable={false} tabIndex={-1}>` to prevent Gutenberg's contenteditable wrapper from stealing focus.
- `save`: a placeholder shell, `<div data-cortext-collection-view data-slug data-config>…</div>`, usable for frontend hydration.
- The dedicated collection page mounts the same DataViews component when a collection is clicked in the sidebar.

### Add-column-on-the-fly

A Cortext-specific "+" button after the last column header. Clicking it opens a popover form (label, type, config), which POSTs to `/cortext/v1/collections/{slug}/properties`. Meta hot-reload registers the new key, the view-schema cache invalidates, and the column appears immediately.

### Layouts in phase 1

Only `table`, `grid`, and `list`. All three ship with DataViews. Phase 2 adds a custom board layout via `<DataViews>{children}</DataViews>` composition, consuming `view.groupBy`, plus a custom calendar layout.

### Fields builder

```ts
function buildDataViewsField(property): Field {
  // Maps Cortext property types to DataViews field shape.
  // text, number: direct. select: 'text' + elements.
  // multiselect: 'array' + custom Edit/render (chips).
  // relation: custom render/Edit (modal picker).
  // formula: 'text' with computed value via getValue.
}
```

### Public frontend rendering

Technically feasible today. `@wordpress/dataviews/wp` is source-agnostic and has no wp-admin dependency. Shipping it requires:

1. Enqueuing `wp-dataviews`, `wp-components`, `wp-data`, `wp-element`, `wp-i18n`, and `wp-blocks` via `wp_enqueue_scripts`.
2. Enqueuing CSS: design tokens, components, dataviews (around 100KB minified combined).
3. Injecting data and the REST nonce via `wp_localize_script` or inline JSON.
4. Rendering a `<div data-cortext-collection-view>` placeholder that the frontend entry script hydrates.

Phase-1 stretch goal; otherwise slips to phase 2.

## Formulas

Experimental in phase 1:

1. A safe AST evaluator (tiny parser, whitelisted nodes, no `eval`, no `Function` construction). Supports literals, `prop('name')`, arithmetic, string concat, comparisons, ternary, and a standard library: `sum`, `avg`, `min`, `max`, `length`, `days_between`, `today`, `format_date`, `if`, `lower`, `upper`.
2. Client-only evaluation. Computed at render, not stored as meta. Read-only column in DataViews.
3. Phase 2 adds a PHP-side evaluator for server-side filter and sort on formula values.

## REST API surface

Mostly standard WP REST:

- `GET|POST /wp/v2/cortext-pages`: documents.
- `GET|POST /wp/v2/cortext-collection-{slug}`: collection rows.
- `GET /wp/v2/cortext-collection-{slug}/{id}?_fields=...,cortext_row_resolved_schema`: row plus row schema.
- `GET|POST /wp/v2/cortext_supertag`: supertag CRUD.

Custom routes:

- `GET|POST|PUT|DELETE /cortext/v1/collections[/{slug}]`: collection definitions (option-backed).
- `POST|PUT /cortext/v1/collections/{slug}/properties`: CRUD collection property schema.
- `POST|PUT /cortext/v1/supertags/{termId}/properties`: CRUD supertag property schema.
- `GET /cortext/v1/collections/{slug}/view-schema?filters=...`: list-scoped view schema.

### Meta hot-reload

When a new property is added mid-request, its meta key is not yet registered. The fix hooks `rest_request_before_callbacks` to re-run the meta registration pass against the current property list before the REST request proceeds.

## Key WordPress APIs

- `register_post_type` (pages plus dynamic collection CPTs, each with `taxonomies => ['cortext_supertag']`)
- `register_taxonomy` for `cortext_supertag` (global, empty `object_type`, `show_in_rest=true`)
- `register_post_meta` with `object_subtype` and `show_in_rest.schema` — the same meta key can be registered on multiple subtypes (WP 4.9.8+), which is what lets a cross-type tag's fields attach to rows across collections.
- `register_term_meta` for cross-type tag property schemas.
- `register_rest_field` for `cortext_row_resolved_schema`.
- `register_block_bindings_source` (PHP) / `registerBlockBindingsSource` (JS) for `cortext/property`.
- `rest_request_before_callbacks` for meta hot-reload.
- `is-fullscreen-mode` body class for the chrome-hiding admin shell.

## Known risks

- **DataViews focus inside a block's `edit`**: contenteditable conflicts are the most likely footgun. `contentEditable={false}` wrapper is the mitigation. Validate early.
- **Block Bindings `setValues` for non-scalar types**: text, number, URL are straightforward; relation and multiselect are untested. Fall back to read-only bindings if it fights.
- **`resolved_schema` cache invalidation**: must cover collection property CRUD, supertag CRUD, and term assignment changes. Miss any and stale schemas ship.
- **Gutenberg version coupling**: DataViews API changed in 6.9 (`isValid`) and 7.0 (`groupBy`). Pin the minor version; floor is 6.9.
- **Formula evaluator security**: treat formula input as untrusted. Whitelist AST nodes strictly.
