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

**What.** Three small but real internal mechanisms exist because DataViews doesn't have an inline-edit contract (#1):

- **Column anchoring via overlay.** DataViews renders an actual `<table>`; Cortext switches it to `table-layout: fixed` so resize widths behave as real column constraints instead of intrinsic-size hints. Mounting an editor inline would still change the column's content sizing and row geometry. We always render the display shell and overlay the editor on top via `position: absolute`, so the table only sees the display state while the editor is open.
- **Row height pin.** The shell's `min-height` is hardcoded to 40px to match `__next40pxDefaultSize`, the height of TextControl/NumberControl/SelectControl with the modern WP size flag. If WP changes the default control height, the pin desyncs and rows jitter again.
- **Density mirror.** DataViews paints row height via the td's `padding-block`, varied per density (`has-compact-density` / `has-comfortable-density`). The shell's hover/edit highlight lives on the shell itself, so the gray floated inside the larger row instead of covering it. We zero the td's `padding-block` so the shell becomes the row, then replicate DataViews's per-density row heights via `min-height` overrides on the shell (and `.cortext-cell-checkbox`, which shares the shell's dimensions). Balanced and comfortable mirror DataViews v6 exactly (12 / 16); compact is intentionally tighter than the upstream default (4 -> 0) so the row matches the 40px editor floor, and that's the density we set as the project default in `createDefaultView` and `DEFAULT_LAYOUTS`. If upstream bumps the balanced/comfortable paddings, those two row heights silently desync until we update the numbers.

**Where.** `src/components/EditableCell.js` and the `.cortext-editable-cell`, `.cortext-cell-checkbox`, and `.cortext-data-view .dataviews-view-table` rules in `src/index.scss`.

**Solution.** All three go away if DataViews lands inline editing (#1) and exposes a layout contract for cells (or a CSS variable for cell padding the shell can hook into). Until then the overlay is a clean enough pattern to keep, the height pin is one CSS line worth maintaining, and the density mirror is the price of painting hover/edit highlights edge to edge. Worth tracking separately so the next person editing the cell layout knows the constraints rather than re-deriving them.

## 6. DataViews has no multiselect form control `[upstream]`

**What.** DataViews v6 ships `text`, `integer`, `email`, `datetime`, `radio`, `select`, `toggleGroup`, `boolean`, and `checkbox` controls but no multiselect. Cortext used to bridge that with `FormTokenField`, but option editing outgrew it: multiselect now opens the same option picker as Select so users can create, recolor, rename, delete, and migrate options from the cell. That gives us one option-management surface, but it also means every multiselect cell still carries a custom editor instead of a DataViews-native control.

**Where.** `src/components/MultiselectEdit.js`.

**Solution.** A `multiselect` dataform-control upstream that DataForm and a future inline-edit mode (#1) resolve from `Edit: 'multiselect'`. It would need hooks for custom option rendering and option management, not just a token input, otherwise Cortext would still need the picker.

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

## 10. DataViews `FieldType` union has no `number` or `url` `[upstream]`

**What.** DataViews v6's `FieldType` union is `'text' | 'integer' | 'datetime' | 'date' | 'media' | 'boolean' | 'email' | 'array'`. Cortext has `number` (decimals allowed) and `url`, neither of which has an exact match. We map both to `'text'`: `'integer'` rejects non-integers at validation time, and there's nothing closer for url. The cost lands on the column-level sort comparator: text sort is lexicographic, so `"10"` would sort before `"9"` for a number column. Today this is invisible because `view.sort` isn't forwarded to REST (#3), but the day sort lands, decimal columns will sort wrong unless we add a custom `sort` per field or DataViews ships the missing types.

**Where.** `mapField` in `src/hooks/fieldMapping.js`.

**Solution.** Either DataViews adds `'number'` and `'url'` to the `FieldType` union, or we attach a custom numeric `sort` to number fields when sort lands. Filing a Gutenberg issue is the cheaper play.

## 11. DataViews `Option` type has no `color` `[upstream]`

**What.** DataViews's `Option` shape is `{ value, label, description? }`. Cortext's select / multiselect options can carry a `color` for chip rendering, so we attach `color` as an extra key on each element. DataViews ignores unknown keys today, but a stricter validator upstream would strip it, breaking colored chips silently.

**Where.** `elementsFromOptions` in `src/hooks/fieldMapping.js`. Read by `Chip` (`src/components/fields/Chip.js`) via `formatDisplay` in `src/components/EditableCell.js`.

**Solution.** Add `color` (or a generic decoration slot) to DataViews's `Option` type upstream, then drop the piggyback. File a Gutenberg issue with the chip-render use case.

## 12. `_modified_by` is plugin-stored, not native `[internal]`

**What.** WordPress core stores `post_modified` (timestamp) but not who last edited the post. The "Last edited by" system column needs that information, so a `save_post` hook on entry CPTs records `_modified_by` post meta with the current user ID on every save. Skipped when no user is signed in (CLI imports, cron, seeds, unauthenticated REST) so background writes don't clobber the last real editor with `0`. Risk: third-party plugins that bypass `save_post` (direct DB writes) won't update `_modified_by`. Acceptable for the block's scope; entries created before this PR fall back to the post author when the meta is absent.

**Where.** `record_modified_by` in `includes/PostType/CollectionEntries.php`, read by `format_row` in `includes/Rest/RowsController.php`.

**Solution.** Either core grows native "last editor" tracking (unlikely; long-standing wishlist), or we accept the hook as the canonical answer. No upstream issue to file — this is just a small piece of plugin-managed state.

## 13. System field filtering is deferred `[internal]`

**What.** Filters route through `meta_query`, but system fields (`created_at`, `modified_at`, `created_by`, `modified_by`) live on the post table or in user data, not in post meta. The filter validator rejects all four with a clean 400 rather than silently no-op'ing through the meta_query branch. Users can sort by `created_at` and `modified_at` (free WP_Query orderby) but can't filter on any system field today.

**Where.** `validate_filter_fields` and `build_query_args` in `includes/Rest/RowsController.php`.

**Solution.** Add date-range filter operators with native `date_query` for `created_at` / `modified_at`, and JOIN-to-users filtering for `created_by` / `modified_by` (paired with #14, since the JOIN cost is shared with display-value sorting).

## 14. Sort on display-value properties is an open architectural decision `[internal]`

**What.** `created_by`, `modified_by`, future Person properties, Relation, value-Rollup, and Files all share the same pattern: stored value is an internal handle (user ID, post ID, attachment ID), useful sort is on the displayed string (display name, related-row title, filename). Sort by stored is meaningless from the UI; sort by display requires a JOIN (or in-memory sort). PR C ships sort only on the timestamp system fields and rejects sort on `_by` keys at the validator. The same problem will hit Relation and Rollup when those types ship (RSM-1468), so the architecture should be settled once.

**Where.** `validate_sort_field` in `includes/Rest/RowsController.php` (rejects `_by` keys today). `enableSorting: false` for the `_by` system fields in `systemFields` (`src/hooks/fieldMapping.js`).

**Solution.** A single decision shared with the relations/rollups work: JOIN-and-sort in `build_query_args`, in-memory sort after fetch, or a custom REST query path. Pick when picking up RSM-1468; until then, sort UI on display-value properties stays disabled. Tracked in RSM-1793.

## 15. DataViews table columns lack interaction extension points `[upstream]`

**What.** DataViews persists table column order in `view.fields` and widths in `view.layout.styles`, but it doesn't expose a table-column interaction layer: no resize handles, min/max width contract, double-click autofit, reorder callback, drag preview, stable header/cell refs, or supported way to opt into `table-layout: fixed`. Cortext therefore portals resize and dnd-kit drag handles into DataViews-rendered `<th>` elements, snapshots header geometry during drag, mutates inline widths during resize for immediate feedback, and overrides internal table/cell wrapper CSS so narrow columns behave as hard constraints rather than intrinsic-size hints.

Double-click autofit is the trickiest piece. With no measurement hook upstream, we clone the cell into a hidden subtree that has to recreate every ancestor that affects layout: a `.cortext-data-view` wrapper for our scoped overrides, a real `<tbody>` or `<thead>` for upstream's tbody-scoped rules, an append next to the live `.dataviews-wrapper` for font inheritance, and `display: block` on the wrapper so flex sizing on the parent doesn't push the measurement around. Then the persisted width subtracts the cell's own padding and border (we read border-box, write content-box), and a 2px buffer absorbs proportional-digit rounding so `2007` doesn't clip where `1939` fits. Each ancestor and constant is a place the live DOM can drift away from us.

**Where.** `src/components/DataViewColumnInteractions.js`, `src/components/dataViewColumns.js`, the `DataViewColumnInteractions` mount in `src/components/CollectionDataViews.js`, and the column affordance / table wrapper rules in `src/index.scss`.

**Solution.** Upstream DataViews could expose table-column APIs that cover `onChangeFields`, `onChangeColumnStyle`, resize handle rendering, per-field min/max widths, double-click autofit, drag overlay/insertion affordances, and stable header/cell slots or refs. If DataViews owned that layer, Cortext could drop the portal/DOM-query adapter, the wrapper min-width overrides, most of the dnd-kit column glue, the cloned-measurement gymnastics, and the direct DOM mutation used for live resize feedback.

## 16. DataViews has no per-column menu-item slot `[upstream, soft]`

**What.** DataViews' column-header dropdown (Sort / Add filter / Move / Hide) is a closed list — there's no `field.menuItems` to inject Rename / Duplicate / Delete. To keep a single dropdown per column, we hide DataViews' built-in trigger on custom-field `<th>`s via CSS and portal our own combined trigger in (Sort / Move / Hide *plus* Rename / Duplicate / Delete). Title and system fields keep the built-in trigger. Main's drag-handle click-forward (`DataViewColumnInteractions`) iterates header buttons and skips `display: none` ones via `offsetParent`, so it lands on whichever trigger is visible. Filter is intentionally absent — Cortext doesn't surface column-level filters in the header.

**Where.** `src/components/fields/ColumnHeaderActions.js` (combined dropdown), `src/index.scss` (`.dataviews-view-table th:has(.cortext-column-header-marker) > .dataviews-view-table-header-button { display: none }`), `src/components/DataViewColumnInteractions.js` (visible-button click forward).

**Risk.** Re-implementing Sort / Move / Hide ourselves means new DataViews items in those menus won't show up here automatically. If main's drag handle stops calling `.click()` on the header trigger, the column-name click-to-open behavior would need a different forward.

**Solution.** A `field.menuItems` (array or render-prop) on DataViews fields, appended to the built-in dropdown. Other consumers (Pattern Manager, Pages, Site Editor) would benefit too. File as a Gutenberg feature request.

## 17. Ghost `+` column is a synthetic field pinned in `view.fields` `[internal]`

**What.** The `+ add field` column is a synthetic DataViews field (`__add_field`) — no data, no label, pinned last in `view.fields` for table layout. We rely on `enableHiding: false` to keep it out of the column-visibility menu. If DataViews stops honoring that flag, the synthetic leaks into the menu and confuses the column list.

**Where.** `GHOST_FIELD` and the view-sync effect in `src/components/CollectionDataViews.js`.

**Solution.** If `enableHiding` ever stops working, fork the field list in `CollectionDataViews.js` — pass the synthetic to the table layout but hide it from the visibility menu.

## 18. Field management is table-layout only `[internal]`

**What.** Rename / Duplicate / Delete only show up in the table-layout column-header kebab. Grid and list layouts have no schema actions and no ghost `+`. Users there can still create fields via the toolbar Add field button, but they have to switch to table to manage existing fields.

**Where.** `ColumnHeaderActions` mounts only when `view.type === 'table'` (`src/components/CollectionDataViews.js`).

**Solution.** A toolbar "Manage fields" panel listing every custom field with per-row rename / duplicate / delete, available in every layout.

## 19. Select / multi-select fields ship with no options `[internal]`

**What.** Add field creates the field immediately when you click a type — there's no second step for type-specific config. For select / multi-select that means the column starts empty; users have to add options via wp-admin or by re-saving through REST.

**Where.** `src/components/fields/AddFieldPopover.js` (no options input). The REST route already accepts an `options` array; the UI just doesn't surface it.

**Solution.** A field-edit dialog from the column kebab (next to Rename / Duplicate / Delete) with an options editor — one-per-line textarea, or a chip list with colors. Until then, options live in wp-admin or REST.

## 20. Table layout overrides couple to DataViews internals `[upstream, soft]`

**What.** DataViews ships `table-layout: auto; width: 100%` plus per-cell padding rules. We flip to `table-layout: fixed; width: max-content` with explicit per-cell widths so adding or removing a field doesn't reflow every other column, and match DataViews' selector specificity to override the last-cell padding so the ghost column stays slim. Result: a content-sized table that scrolls horizontally on overflow. Depends on DataViews' class names and selector specificity staying put.

**Where.** `src/index.scss`, around the `.dataviews-view-table` block.

**Solution.** A `tableLayout` (or similar) prop on DataViews so consumers can pick between "auto with redistribution" and "fixed with content-sized columns", plus per-field `width` hints so columns can be pinned without overriding DataViews CSS.

## 21. Field-meta cleanup uses a global delete `[internal]`

**What.** `cleanup_after_field_delete` calls `delete_post_meta_by_key( "field-<id>" )`, which wipes that key from every post — not just Cortext entry CPTs. The collision risk is theoretical (`<id>` is a globally unique `crtxt_field` post ID, so any postmeta keyed that way belongs to a Cortext entry by construction), but the code doesn't enforce that. A scoped `DELETE pm … INNER JOIN wp_posts p … WHERE p.post_type IN (…)` would prove the scope, but WorDBless (#9) can't run JOINs and its in-memory `$wpdb->posts` isn't exposed via SQL — `WP_Query`/`get_posts` against dynamic entry CPTs returns empty in the mock, so the per-post fallback also can't be unit-tested here.

**Where.** `cleanup_after_field_delete` in `includes/PostType/CollectionEntries.php`.

**Solution.** Stand up an integration environment with a real `wpdb` (`wp-env` + WP_PHPUnit), move the cleanup to a scoped JOIN, and keep WorDBless for the parts that don't need a real database.

## 22. Block editor selects on scrollbar drag `[upstream]`

**What.** Gutenberg selects a block on any `mousedown` that bubbles up to the block wrapper. Inside the data-view block, dragging the dataviews scrollbar fires a mousedown on the scrolling element and pulls a bounding box around the whole block. Gutenberg has no primitive for "this region scrolls, don't select on click." We listen for `mousedown` on `.cortext-data-view` in capture phase, sniff scrollbar-gutter clicks by geometry (target's computed `overflow-x/y` is `auto`/`scroll`, the element actually overflows, and the click landed past `clientWidth` or `clientHeight`), then `stopPropagation` so the event never reaches Gutenberg. Cell, row, and header clicks keep bubbling and select normally.

**Where.** The mousedown effect on `tableWrapperRef` in `src/components/CollectionDataViews.js`.

**Solution.** A Gutenberg API for declaring interactive scroll regions on a block (or a way to opt mousedowns out of selection per descendant) would let us drop the heuristic. Until then the geometry sniff is the cleanest signal we have. The brittleness is in browser scrollbar pseudo-element behavior; the day someone introduces an overlay-scrollbar shim or a custom scroll library, this would need rethinking.

## 23. Embedded data-view block has no width/height controls `[internal]`

**What.** The `cortext/data-view` block exposes `align` (default / wide / full) for width but nothing for height. A freshly inserted block needs some visible height or it collapses to its toolbar, so we set `min-height` from `var(--cortext-data-view-block-min-height, 480px)`. The number is a guess: roughly fits a header, ~10 compact rows, footer, and pagination. It doesn't track the block's density or `perPage`, so a comfortable block with `perPage: 25` shows the same default viewport as a compact block with 5 rows.

**Where.** `--cortext-data-view-block-min-height` in `src/styles/_tokens.scss`, the `.wp-block-cortext-data-view .cortext-data-view` rule in `src/index.scss`, `src/blocks/data-view/block.json` (no `height` attribute today).

**Solution.** Add a `height` (or "rows visible") attribute to the block with an inspector control, fall back to the variable when unset, and let the variable stay as a theme-overridable default. Computing the default from `density × perPage` is a smaller win; once the per-block control exists, the default rarely matters.

## 24. Workspace notices filtered by id prefix `[upstream, soft]`

**What.** Gutenberg's editor store fires off its own "Page updated" snackbar on every successful save. Autosave runs constantly here, so that toast would never stop popping up. Our workaround is a custom `SnackbarList` that only shows notices whose id starts with `cortext-`; everything else gets dropped on the floor, including any third-party plugin notice or a future first-party one we'd actually want to surface.

**Where.** `CortextSnackbars` in `src/components/Canvas.js`, paired with the `id: 'cortext-autosave-error'` we set on the autosave error notice in `src/hooks/useAutosave.js`.

**Solution.** Upstream could expose a way to suppress the editor's default save notice, or scope notices per surface so we don't have to share a global stream. Until then, anything Cortext wants visible has to opt in with a `cortext-` id.

## 25. dnd-kit doesn't observe `inert` `[upstream, soft]`

**What.** Collapsed branches of the page tree stay mounted so the expand/collapse animation can run. The wrapper gets `inert` so focus, screen readers, and click events skip the subtree, but dnd-kit doesn't pay attention to that. It walks its registered droppables in JavaScript, asks each one for its bounding rect, and treats them as live drop targets whether anything visible is there or not. Without intervention, a drag can land on a row you can't see. The workaround is to thread an `isHidden` prop down through `PageRow` and pass `disabled: isHidden` to every `useDroppable`. Anything else that wants this animation pattern has to do the same drilling.

**Where.** The `isHidden` prop chain through `src/components/PageRow.js`, plus the wrapper's `inert` attribute in the same file.

**Solution.** dnd-kit honoring `inert` (or computed `pointer-events: none`) on an ancestor would let us drop the prop-drilling. Until then, any tree-shaped surface that uses a CSS-clipped collapse animation has to thread `disabled` through its rows itself.

## 26. Sidebar rename input pinned via WP component internals `[upstream]`

**What.** The page-row rename uses `<TextControl size="compact" __next40pxDefaultSize>`, which should produce a 32px input matching the 32px row. It doesn't, on its own: the wrapping `BaseControl > field > InputControl > container` chain still contributes vertical space, so opening rename used to bump the row a few pixels. The fix pins `height` / `min-height` / `max-height` to `$grid-unit-40` and zeroes `padding-block` on every layer in that chain (`.components-base-control`, `.components-base-control__field`, `.components-input-control`, `.components-input-control__container`, `.components-input-control__input`). It works, but it couples Cortext to WP component-internal class names. If WP refactors `TextControl` (renames a class, drops a wrapper, restructures the DOM), the input loses its height pin and the row starts bumping again, silently.

**Where.** The `&__rename` block in `src/index.scss`. The e2e test `keeps the rename input inside the page row height` in `tests/e2e/specs/sidebar-layout.spec.js` is the tripwire: it asserts the input never overflows the row's bounding rect, so a WP-internals refactor would surface there before reaching production.

**Solution.** Either WP exposes a "fit-the-row" size for `TextControl` (or a CSS variable hook for input height), or we replace the rename `TextControl` with a plain `<input>` styled to match the row. The plain input is the more reliable path: drops the WP-internals coupling, but adds a small amount of styling and accessibility plumbing we currently get for free. Worth doing the day this test fails on a WP bump.

## 27. `Menu` outside-click only watches one document `[upstream]`

**What.** WP's `Menu` (privateApis, Ariakit underneath) only sees clicks on the document the popover renders in. The `cortext/data-view` block renders inside Gutenberg's editor iframe, so clicks on the editor sidebar or top toolbar never reach Ariakit and the column dropdown stays open until the user clicks back into the canvas. We add a `mousedown` listener on `window.parent.document` while the menu is open and short-circuit when there isn't a parent (the Cortext admin isn't in an iframe).

**Where.** The `useEffect` block in `FieldActions` in `src/components/fields/ColumnHeaderActions.js`.

**Solution.** Either Ariakit grows a way to register extra documents for outside-click detection, or WP's wrapper does it for us. We drop the listener once that ships.

## 28. `Menu.Item` has no destructive variant `[upstream]`

**What.** The legacy `MenuItem` from `@wordpress/components` accepted `isDestructive` and rendered the row in red. The new privateApis `Menu.Item` dropped that prop without a replacement (verified in `node_modules/@wordpress/components/build-types/menu/types.d.ts` against `ItemProps`). For the Delete column action we paint the red ourselves with a className and one CSS rule, scoped to inactive rows so the focus/hover highlight overrides it.

**Where.** The Delete `Menu.Item` in `src/components/fields/ColumnHeaderActions.js` and `.cortext-column-header-actions__destructive-item` in `src/index.scss`.

**Solution.** Add `isDestructive` (or a `variant: 'destructive'`) to `Menu.Item` upstream. One-line change here once it ships.

## 29. `Menu.Popover` doesn't portal by default `[upstream]`

**What.** Without `portal` set, `Menu.Popover` renders inline at its mount point. Our column trigger lives inside a `<th>` whose `text-transform: uppercase` cascades into the menu items and turns every label into ALL CAPS. We pass `portal` explicitly. Most popovers in the system portal by default; this one doesn't.

**Where.** The `<Menu.Popover portal …>` in `src/components/fields/ColumnHeaderActions.js`.

**Solution.** Flip the default upstream. Trivial PR.

## 30. `Menu` submenus only accept menu primitives `[upstream]`

**What.** `Menu.SubmenuTriggerItem` opens a nested `Menu.Popover`, but the popover's children have to be `Menu.Item` / `Menu.Group` / `Menu.Separator`. Our "Edit field" submenu has tile previews (Number / Bar / Ring), labelled rows with right-anchored values, and three more popovers for format, color, and time choices. None of that fits the menu-primitive contract, so the format panel stays as a sibling popover, we run the hover-with-grace bridge ourselves, and the parent menu's `hideOnInteractOutside` filter ignores clicks landing in `.cortext-format-submenu` or `.cortext-format-submenu__flyout`.

**Where.** `openFormat` / `scheduleClose` and `hideMenuOnInteractOutside` in `src/components/fields/ColumnHeaderActions.js`. `FieldFormatPopover` and its flyouts in `src/components/fields/FieldFormatPopover.js`.

**Solution.** An arbitrary-content submenu variant in WP's `Menu` (or upstream Ariakit) would let the format panel mount as a real submenu, with outside-click and focus management owned by the library. Until then the manual bridge stays.

## 31. Block editor has no non-serialized before/after block chrome slot `[upstream]`

**What.** Page identity actions ("Add icon" / "Add cover") are editor chrome, but the ideal visual placement is immediately before the page title inside the block canvas. Persisting an actions block put UI into post content, while portalling controls into the iframe coupled us to BlockList DOM and block hover/selection behavior. The current compromise renders editor-only actions from the canvas shell, outside the persisted `BlockList`, and inserts only the real dynamic blocks (`cortext/page-icon`, `cortext/page-cover`) into content.

**Where.** `PageIdentityActions` and `EnsureHeaderBlocks` in `src/components/Canvas.js`; legacy no-op registration in `includes/Editor/PageHeaderActionsBlock.php`.

**Solution.** Gutenberg could expose a non-serialized block chrome slot/fill, e.g. "before/after this block" keyed by `clientId`, block name, and root list. Fills would participate in editor layout and focus order but stay out of block order, list view, serialization, copy/paste, movers, undo history as content, and frontend rendering. Cortext could then render the identity actions before the root `core/post-title` without storing a fake block or querying iframe DOM.

## 32. Public pages render the title twice `[internal]`

**What.** `PageIdentity::prepend_header_blocks` slips a locked `core/post-title` block into `post_content` on insert, so the editor canvas can show the title inline as part of the BlockList. The public template still calls `the_title()` immediately before `the_content()`, and `core/post-title` resolves to the same `post_title` again, so every page created after this filter landed renders its title twice publicly. Older pages (no title block in their content) are fine until the editor next persists them.

**Where.** `prepend_header_blocks` in `includes/PostType/PageIdentity.php`, paired with `the_title()` in `templates/single-crtxt_page.php`.

**Solution.** Stop baking `core/post-title` into `post_content` and mount the editor's title input as canvas chrome above `BlockCanvas`, the way Gutenberg itself does it. The template keeps `the_title()` as the single source of truth; the editor keeps an inline-editable title; pages already saved with the block get a small migration that strips it. Until then `the_title()` is the authoritative render and the duplication is the cost of the canvas-as-blocklist shape.

## 33. Frontend stylesheet doesn't carry the cover/icon rules `[internal]`

**What.** `.cortext-page-cover-block` and `.cortext-page-icon` rules live in `src/index.scss`, which only builds to the admin shell bundle. The PHP `render_callback`s emit the same wrapper classes for the public frontend, but `src/frontend.scss` has no matching rules, so on a public `crtxt_page` the cover banner renders at intrinsic image size and the icon block falls back to inline-default layout.

**Where.** `src/index.scss` (cover/icon block rules) versus `src/frontend.scss` (no matching rules), enqueued by the public template.

**Solution.** Extract the cover/icon block rules into a partial both stylesheets `@use`, so admin and frontend stay in sync without copy-paste drift. The shell-only chrome (hover replace/remove, picker popovers) stays in `index.scss`; only the persisted block markup needs to be shared.

## 34. WP-icon variant renders blank on the public frontend `[internal]`

**What.** `PageIconBlock::render` emits a marker span (`<span class="cortext-page-icon--wp" data-icon="…">`) for the `wp` icon variant and relies on a frontend hydration step to fill in the SVG. `frontend.js` is CSS-only, so nothing fills it and the icon disappears on the public page; the saved color is also dropped. Emoji and image variants render server-side and are fine.

**Where.** Case `'wp'` in `includes/Editor/PageIconBlock.php`, paired with `src/frontend.js` (no hydration).

**Solution.** Either ship the SVG inline server-side (a small build-time generator that reads `@wordpress/icons` and emits a name-to-markup PHP map, refreshed on install) or hydrate from `data-icon` markers in `frontend.js` (smaller PHP surface, adds a public script). The inline-color is a one-line fix in either path. Until then, surface the limitation in the picker copy or restrict the saved variant to emoji + image for public-rendered pages.

## 35. Nested `Popover` outside clicks do not close the host `[upstream]`

**What.** `Popover` handles outside clicks one popover at a time. In the option editor, the main picker opens a second popover for an individual option's color/menu controls. After a color edit, the first click outside both popovers closed only the small option menu; the main picker stayed open because the host never saw that same outside click. We now listen for `pointerdown` while the option menu is open and ask the host to close when the click lands outside both popovers.

**Where.** The pointer listener in `EditOptionsPopover` (`src/components/fields/EditOptionsPopover.js`) and the `onRequestClose` plumbing through `EditableCell`, `MultiselectEdit`, and `ColumnHeaderActions`.

**Solution.** `Popover` needs a parent/child dismissal story: either close the whole stack when a click lands outside all related popovers, or expose enough event detail for a host popover to opt into that behavior without a document-level listener.
