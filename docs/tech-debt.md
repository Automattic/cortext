# Tech debt and upstream gaps

Most of the workarounds in this codebase exist because a primitive is missing in WordPress core or Gutenberg, not because we cut corners. Filing the upstream issues is the highest-leverage cleanup; the internal items unblock as the upstream pieces land.

Pair with [decisions.md](decisions.md) for choices we're at peace with, and [roadmap.md](roadmap.md) for net-new product work.

Each entry is numbered. Code that works around a numbered item references it as `tech-debt.md#N`, so `grep -r 'tech-debt.md#3'` shows every spot affected.

## Upstream (Gutenberg)

### 1. No inline cell editing in DataViews

**Where it bites.** `src/components/EditableCell.js`, `RowMutationContext` plumbed through `src/components/CollectionDataViews.js` (notably `requestNext` for Tab navigation).

**Today.** `field.render` is documented as a display renderer, but we use it to mount `EditableCell`, which holds local edit state and swaps to a control on click. The save callback is threaded via React context because `field.render` only receives `{ item }` and has no access to a mutation hook. Tab and Shift+Tab between cells are also implemented in this layer: text-like and select editors intercept Tab, ask the parent for the next editable cell via `requestNext`, and the target cell pops open via the same `editRequest` channel that handles new-row title focus. A handful of CSS workarounds in `src/index.scss` keep the column from reflowing when an editor mounts: cell wrapper pinned to 40px (matching `__next40pxDefaultSize`), `min-width: 0` so it can shrink below the editor's intrinsic min-width, `> * { width: 100% }` to stop TextControl/Dropdown trigger Buttons from sizing to their own content. All of this would be DataViews's job in a native inline-edit mode.

**Cleaner.** An `editable` mode on the DataViews table layout that uses each field's `Edit` per cell, plus an `onSaveItem(item, changes)` prop on `<DataViews>`, plus native cell-to-cell keyboard navigation, plus a layout contract for "this control is rendered inline in a cell." With those, `RowMutationContext`, `requestNext`, most of `EditableCell`, and the layout-prop CSS go away.

**Cost.** Roughly 530 lines in `EditableCell.js` plus the context wiring, the `requestNext` walker in `CollectionDataViews.js`, and the cell-layout CSS. Reading `field.render` against its documented intent. Brittle coupling to `__next40pxDefaultSize` (40px hardcoded in our cell SCSS) means upstream height changes could reintroduce row reflow until we re-tune.

**Action.** File a Gutenberg issue with the use case and proposed shape. `docs/roadmap.md` lists upstream issues as a stretch success metric.

### 2. No multiselect form control in DataViews

**Where it bites.** `src/components/MultiselectEdit.js`.

**Today.** DataViews v6 ships `text`, `integer`, `email`, `datetime`, `radio`, `select`, `toggleGroup`, `boolean`, and `checkbox` controls but no multiselect. `MultiselectEdit` wraps `FormTokenField` and translates between option labels and option values manually.

**Cleaner.** A `multiselect` dataform-control upstream that DataForm (and a future inline-edit mode, see #1) resolves from `Edit: 'multiselect'`.

**Cost.** Small. The wrapper is short and self-contained, but every collection with a multiselect field carries the patch.

**Action.** File a Gutenberg issue or PR.

### 3. No `footer` slot on DataViews

**Where it bites.** `src/components/CollectionDataViews.js` (`cortext-data-view__footer` div), `src/index.scss` (`.cortext-data-view` flex layout).

**Today.** The "+ New" affordance sits in our own div outside `<DataViews>`, with a small CSS layer to make the wrapper flex correctly around DataViews' default `height: 100%`. `<DataViews>` has a `header` slot but no symmetric footer.

**Cleaner.** Either an upstream `footer` prop, or switch to DataViews free composition (already supported via `children`) and lay out `<DataViews.Layout />` / `<DataViews.Pagination />` ourselves. Free composition works today; the prop would just be tidier.

**Cost.** A handful of CSS lines and a wrapper div. The smallest debt on this page.

**Action.** Free composition is local cleanup we can do whenever; consider before filing upstream.

### 7. `CheckboxControl` silently ignores `hideLabelFromVision`

**Where it bites.** Checkbox cell in `src/components/EditableCell.js`.

**Today.** `CheckboxControl` always renders its `label` prop as a visible `<label>` next to the input regardless of `hideLabelFromVision` (verified against `node_modules/@wordpress/components/build-module/checkbox-control/index.mjs`). DataViews columns already show the field label in the header, so passing `label={ label }` echoed it next to every checkbox. We work around it by passing `aria-label={ label }` instead, which the component forwards to the underlying input via `additionalProps`. Screen readers still get a label; sighted users no longer see it twice.

**Cleaner.** Either teach `CheckboxControl` to honour `hideLabelFromVision` (wrap the label with `VisuallyHidden` when set), or expose a documented prop for "label this for assistive tech only."

**Cost.** Tiny — one prop swap. The risk is that any future contributor adding a checkbox cell reaches for `label` again, since that's the documented prop.

**Action.** File a Gutenberg bug or PR. Until it lands, keep using `aria-label` for any inline checkbox controls.

## Internal (Cortext)

### 4. Rows aren't in `core-data`'s entity store

**Where it bites.** `src/hooks/useCollectionRows.js`, `src/components/CollectionDataViews.js` (`saveRowField`, `onCreated`, `RowMutationContext`).

**Today.** `useCollectionRows` fetches rows with raw `apiFetch` and keeps its own state, including a `requestId` race guard and a `refresh()` counter that callers bump after creating or updating a row. Mutations POST directly via `apiFetch` and then call `refresh()`.

**Cleaner.** Replace the hook with `useEntityRecords('postType', \`crtxt_${slug}\`, query)` and use `saveEntityRecord('postType', ...)` for writes. `core-data` handles caching, race protection, and post-mutation invalidation.

**Cost.** Three knock-on workarounds:
- The `refresh()` handle exists only because rows aren't reactive.
- `RowMutationContext` (also driven by #1) threads a save callback through React context because cells can't reach a `core-data` store that isn't there.
- `onCreated` runs optimistic `lastPage = ceil((totalItems+1)/perPage)` arithmetic against possibly stale `paginationInfo`. With reactive pagination we'd watch `totalPages` in an effect and navigate when the new row's page resolves.

**Risk.** Dynamic `crtxt_{slug}` post types are registered with `show_in_rest`, so `core-data`'s resolver should discover their schema lazily. Worth a small spike before committing.

### 5. `view.sort` isn't sent to REST

**Where it bites.** `src/hooks/useCollectionRows.js` (`buildQueryArgs`), `src/components/CollectionDataViews.js` (`onCreated` page-jump).

**Today.** `buildQueryArgs` ignores `view.sort` entirely. When `view.sort.field` is unset we pin `orderby=date order=asc` so newly created rows land at the bottom of the table; when the user sets a sort via the DataViews UI, we silently drop it.

**Cleaner.** Translate `view.sort` to REST `orderby/order`. Native fields (`title`, `date`, `id`, `menu_order`) map directly. For `field-{id}` keys, add a `rest_{post_type}_query` filter on the row CPT (`includes/PostType/CollectionEntries.php`) that recognizes `orderby=field-X` and rewrites it to `meta_value`/`meta_value_num` with the matching `meta_key`.

**Cost.** Sort UI looks interactive but doesn't stick. The hardcoded asc-by-date default also leaks into `onCreated`'s page-jump (gated by `view.sort.field` to keep the override conservative).

### 6. `view.filters` isn't sent to REST

**Where it bites.** `src/hooks/useCollectionRows.js` (`buildQueryArgs`), `src/components/CollectionDataViews.js` (`prefillFromFilters`).

**Today.** Filters round-trip through block attributes and feed `prefillFromFilters` for the New-row prefill, but they don't filter the loaded dataset. The filter prefill works because we read the stored filter, not because the server applied it.

**Cleaner.** Extend the same REST filter as #5 to translate `view.filters` clauses into `meta_query`. `is`/`isAny`/`contains` map cleanly to `=`/`IN`/`LIKE` against the right `meta_key`.

**Cost.** Filters appear functional but don't reduce the result set. The gap will get loud once a real collection has more than a page of rows.

## Sequencing

If these get scheduled:

1. File Gutenberg issues for #1, #2, #3, #7 (cheap; doesn't block anything).
2. Move rows into `core-data` (#4). Deletes the most code and unblocks reactive pagination, which simplifies the page-jump on creation.
3. Forward `view.sort` (#5). Standard WP filter pattern; same filter sets up #6.
4. Forward `view.filters` (#6). Builds on #5; turns prefill into a side effect of real filtering instead of its only purpose.
5. Switch the New-row footer to free composition (#3 internal half). Local cleanup once `core-data` removes the surrounding code.
