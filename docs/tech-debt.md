# Tech debt and upstream gaps

A running log of the workarounds in this codebase. Most are here because a primitive is missing in WordPress core or Gutenberg rather than because we cut corners. The high-impact items live at the top; trivial ones at the bottom.

Each entry is tagged `[upstream]` (we're waiting on Gutenberg or core) or `[internal]` (ours to schedule), and broken into **What** (the problem), **Where** (the code that's load-bearing), and **Solution** (how this gets cleaner). Numbers are stable cross-references: code that works around an entry tags itself with `tech-debt.md#N`, so `grep -r 'tech-debt.md#3' src/` lights up every spot affected.

Pair with [decisions.md](decisions.md) for choices we've made peace with and [roadmap.md](roadmap.md) for net-new product work.

## 1. DataViews has no inline cell editing `[upstream]`

**What.** DataViews v6 ships display layouts and a separate `DataForm` for editing, but no way to make a table cell editable in place. So we mount our own editor from `field.render` (a display renderer in the docs, but the only seam we have), keep edit state per cell, and route saves back through a `RowMutationContext` since `field.render` only gets `{ item }`. Tab and Shift+Tab between cells live in the same layer: editors intercept Tab, ask the parent for the next editable cell via `requestNext`, and the target cell pops open via the `editRequest` channel that also handles auto-focusing the title cell of a fresh row.

**Where.** `src/components/EditableCell.js`, `RowMutationContext` and `requestNext` in `src/components/CollectionDataViews.js`, plus a sliver of `src/index.scss`.

**Solution.** What we'd want upstream: an `editable` mode on the table layout that uses each field's `Edit` per cell, an `onSaveItem(item, changes)` prop on `<DataViews>`, native cell-to-cell keyboard navigation, and a layout contract for "this control is rendered inline." With those, `RowMutationContext`, `requestNext`, most of `EditableCell`, and the layout couplings tracked in #5 all go away. It's the biggest entry on this page (~530 lines of `EditableCell` plus context wiring and the navigation walker). File a Gutenberg issue with the use case and proposed shape; `docs/roadmap.md` lists upstream issues as a stretch success metric.

## 2. Rows aren't in `core-data`'s entity store `[internal]`

**What.** `useCollectionRows` fetches rows with raw `apiFetch` and keeps its own state, including a `requestId` race guard and a `refresh()` counter callers bump after creating or updating a row. Mutations POST directly via `apiFetch`. The dynamic `crtxt_{slug}` post types are registered with `show_in_rest`, so `core-data`'s resolver should discover their schema lazily; we just haven't wired it.

**Where.** `src/hooks/useCollectionRows.js`, with side effects in `src/components/CollectionDataViews.js` (`saveRowField`, `onCreated`).

**Solution.** Switch to `useEntityRecords('postType', \`crtxt_${slug}\`, query)` plus `saveEntityRecord` for writes. `core-data` then handles caching, race protection, and post-mutation invalidation. Knock-on workarounds it deletes:

- The `refresh()` handle exists only because rows aren't reactive.
- Half of `RowMutationContext` (also driven by #1) exists because cells can't reach a `core-data` store that isn't there.
- `onCreated` runs optimistic `lastPage = ceil((totalItems+1)/perPage)` arithmetic against possibly stale `paginationInfo`. With reactive pagination we'd watch `totalPages` in an effect.

Worth a small spike before committing; `core-data`'s schema cache for rarely-changing post types is the only real risk.

## 3. `view.sort` isn't forwarded to REST `[internal]`

**What.** `buildQueryArgs` ignores `view.sort` entirely. As a placeholder, we pin `orderby=date order=asc` whenever `view.sort.field` is unset so newly created rows land at the bottom of the table. If the user picks a sort via the DataViews UI, we silently drop it. Result: the sort UI looks interactive but doesn't stick, and the asc-by-date assumption leaks into the page-jump on row creation.

**Where.** `src/hooks/useCollectionRows.js` (`buildQueryArgs`), and the conditional in `onCreated` in `src/components/CollectionDataViews.js`.

**Solution.** Translate `view.sort` to REST `orderby/order`. Native fields (`title`, `date`, `id`, `menu_order`) map directly. For `field-{id}` keys, add a `rest_{post_type}_query` filter on the row CPT (`includes/PostType/CollectionEntries.php`) that recognizes `orderby=field-X` and rewrites it to `meta_value`/`meta_value_num` with the matching `meta_key`. Standard WordPress pattern; same filter sets us up for #4.

## 4. `view.filters` isn't forwarded to REST `[internal]`

**What.** Filters round-trip through block attributes and feed `prefillFromFilters` for the New-row prefill, but they don't filter the loaded dataset. The "filter prefill" feature works because we read the stored filter, not because the server applied it. Filters appear functional but the result set never shrinks, which gets loud once a real collection has more than a page of rows.

**Where.** `src/hooks/useCollectionRows.js` (`buildQueryArgs`), and `prefillFromFilters` in `src/components/CollectionDataViews.js`.

**Solution.** Extend the same REST filter as #3 with a `meta_query` translation. `is`/`isAny`/`contains` map cleanly to `=`/`IN`/`LIKE` against the right `meta_key`. Once this lands, prefill becomes a side effect of real filtering rather than its only consumer.

## 5. Inline-edit layout couplings `[internal]`

**What.** Two small but real internal mechanisms exist because DataViews doesn't have an inline-edit contract (#1):

- **Column anchoring via overlay.** DataViews renders an actual `<table>` with default `table-layout: auto`, so columns auto-size to their widest cell content. Mounting an editor inline would change the column's intrinsic width and reflow the whole column. We always render the display shell and overlay the editor on top via `position: absolute`, so the table only sees the display state's intrinsic width and the column stays anchored.
- **Row height pin.** The shell's `min-height` is hardcoded to 40px to match `__next40pxDefaultSize`, the height of TextControl/NumberControl/SelectControl with the modern WP size flag. If WP changes the default control height, the pin desyncs and rows jitter again.

**Where.** `src/components/EditableCell.js` and the `.cortext-editable-cell` rules in `src/index.scss`.

**Solution.** Both go away if DataViews lands inline editing (#1) and exposes a layout contract for cells. Until then the overlay is a clean enough pattern to keep, and the height pin is one CSS line worth maintaining. Worth tracking separately so the next person editing the cell layout knows the constraints rather than re-deriving them.

## 6. DataViews has no multiselect form control `[upstream]`

**What.** DataViews v6 ships `text`, `integer`, `email`, `datetime`, `radio`, `select`, `toggleGroup`, `boolean`, and `checkbox` controls but no multiselect. Our wrapper uses `FormTokenField` and translates between option labels (what the field shows) and option values (what we store as meta). Cost is small (the wrapper is short and self-contained) but every collection with a multiselect field carries the patch.

**Where.** `src/components/MultiselectEdit.js`.

**Solution.** A `multiselect` dataform-control upstream that DataForm and a future inline-edit mode (#1) resolve from `Edit: 'multiselect'`. File a Gutenberg issue or PR.

## 7. DataViews has no `footer` slot `[upstream, soft]`

**What.** The "+ New" affordance lives in our own div outside `<DataViews>`, with a small CSS layer to make the wrapper flex correctly around DataViews' default `height: 100%`. `<DataViews>` has a `header` slot but no symmetric footer.

**Where.** `src/components/CollectionDataViews.js` (`cortext-data-view__footer` div), `src/index.scss` (`.cortext-data-view` flex layout).

**Solution.** More "tidy up later" than tech debt: switch to DataViews free composition (already supported via `children`) and lay out `<DataViews.Layout />` and `<DataViews.Pagination />` ourselves. Free composition works today; an upstream `footer` prop would just be neater. Pick free composition before filing upstream.

## 8. `CheckboxControl` ignores `hideLabelFromVision` `[upstream]`

**What.** `CheckboxControl` always renders its `label` prop as a visible `<label>` next to the input regardless of `hideLabelFromVision` (verified against `node_modules/@wordpress/components/build-module/checkbox-control/index.mjs`). DataViews columns already show the field label in the header, so passing `label={ label }` echoed it next to every checkbox. We pass `aria-label={ label }` instead, which the component forwards to the underlying input. Screen readers still get a label; sighted users no longer see it twice. Risk: the next contributor reaches for `label` (the documented prop) and the duplicate quietly returns.

**Where.** Checkbox cell in `src/components/EditableCell.js`.

**Solution.** File a Gutenberg bug or PR. In the meantime, the `tech-debt.md#8` comment next to `aria-label` is the signal.

## 9. WorDBless can't integration-test the rows endpoint `[internal]`

**What.** WorDBless uses `Db_Less_Wpdb`, an in-memory store where `wp_insert_post` and `get_post` work via the object cache but `WP_Query` SQL returns zero results. The `RowsController` unit tests cover routing, permissions, validation, query-arg building, and row formatting (the last two via reflection), but cannot exercise the full path of inserting rows and verifying they come back from `GET /cortext/v1/rows`. A bug in the `WP_Query` translation (e.g. a wrong `meta_query` compare operator) would slip past unit tests.

**Where.** `tests/php/test-rest-rows-controller.php`.

**Solution.** Either switch the PHP test harness to `wp-env` + `WP_UnitTestCase` (which runs against a real database) or rely on e2e coverage in `tests/e2e/specs/data-view-block.spec.js` to close the gap. The e2e suite already exercises row loading, but dedicated integration tests for sort, filter, and pagination against real data would be more targeted.
