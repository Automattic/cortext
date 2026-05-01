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

**Where.** `src/components/DataViewColumnInteractions.js`, `src/components/dataViewColumns.js`, the `DataViewColumnInteractions` mount in `src/components/CollectionDataViews.js`, and the column affordance / table wrapper rules in `src/index.scss`.

**Solution.** Upstream DataViews could expose table-column APIs that cover `onChangeFields`, `onChangeColumnStyle`, resize handle rendering, per-field min/max widths, double-click autofit, drag overlay/insertion affordances, and stable header/cell slots or refs. If DataViews owned that layer, Cortext could drop the portal/DOM-query adapter, the wrapper min-width overrides, most of the dnd-kit column glue, and the direct DOM mutation used for live resize feedback.

## 16. DataViews has no public per-column menu-item slot `[upstream, soft]`

**What.** DataViews v6's column header dropdown (Sort / Add filter / Move left / Move right / Hide column) is a closed list — `column-header-menu.js` hardcodes the items and there's no `field.menuItems` (or similar) prop to inject schema actions like Rename / Duplicate / Delete. PR D therefore portals a separate kebab button next to DataViews' built-in column-header trigger and `DataViewColumnInteractions`' resize/reorder handles. Two dropdowns per column is more visual clutter than the Notion-style single combined menu we wanted, but it keeps Cortext out of DataViews' internal dropdown markup.

**Where.** `src/components/fields/ColumnHeaderActions.js`.

**Risk.** If DataViews changes how it positions content inside its header `<th>` (flexbox refactor, slot reordering), the kebab placement may need adjustment. Filter is intentionally omitted today (Cortext doesn't expose column-level filters in the visible header).

**Solution.** Upstream a public per-column extension surface in DataViews: a `field.menuItems` array (or render-prop) that the built-in column header dropdown appends to its existing items. This would let downstream consumers (Cortext, Pattern Manager, Pages, Site Editor) add domain-specific actions in the existing dropdown rather than next to it. File this as a Gutenberg feature request once the PR D approach is in production.

## 17. Ghost-column synthetic field is pinned in `view.fields` `[internal]`

**What.** The `+ add field` ghost column is a synthetic DataViews field (`__add_field`) that has no data and no label. The block always pins it last in `view.fields` for the table layout and excludes it from the user-facing column visibility menu via `enableHiding: false`. If DataViews changes how `enableHiding` is honored, the synthetic could appear as a user-toggleable entry in the visibility menu, which would confuse the column list.

**Where.** `GHOST_FIELD` and the view-sync effect in `src/components/CollectionDataViews.js`.

**Solution.** If the visibility menu starts surfacing the synthetic, fork the field list in `CollectionDataViews.js` so the visibility menu sees only the data fields while DataViews' table layout still receives the synthetic.

## 18. Field schema actions are table-layout only in PR D `[internal]`

**What.** Rename, duplicate, and delete are surfaced via the column header kebab in the table layout. Grid and list layouts have no schema-action affordance and the ghost-column `+` is hidden as well; users in those layouts can still create fields via the toolbar Add field button but can't manage existing fields without switching to table.

**Where.** `ColumnHeaderActions` mounts only when `view.type === 'table'` (`src/components/CollectionDataViews.js`).

**Solution.** A top-level "Manage fields" UI (toolbar modal or a dedicated panel) that lists all custom fields with rename / duplicate / delete actions and works in every layout.

## 19. Select / multi-select fields are created without inline option editing `[internal]`

**What.** The Add field popover follows Notion's click-to-create model: clicking a type creates the field immediately. Select / multi-select fields are created with no pre-defined options, so users have to add option values via wp-admin (or by re-saving the field through the REST API). Notion sidesteps this by auto-discovering options from cell values; Cortext doesn't have that auto-discovery.

**Where.** `src/components/fields/AddFieldPopover.js` (no options textarea), `includes/Rest/FieldsController.php` (still accepts an `options` array on `POST /cortext/v1/collections/<id>/fields` — the route is option-aware, only the UI doesn't surface it).

**Solution.** A field-edit dialog accessible from the column header dropdown's Rename/Duplicate/Delete neighborhood, with a small options editor (one-per-line textarea or a Notion-style chip list with colors). Until then, users edit options in wp-admin or via REST.

## 19. Table layout overrides couple to DataViews internals `[upstream, soft]`

**What.** DataViews ships `table-layout: auto; width: 100%` plus per-cell padding rules (`.dataviews-view-table tr td:last-child { padding-right: 48px }`, `.dataviews-view-table__cell-content-wrapper { min-width: 15ch }`). Cortext flips the layout to `table-layout: fixed; width: max-content` with explicit per-cell widths so adding or removing a field doesn't reflow every other column, and matches DataViews' selector specificity to override the last-cell padding so the trailing ghost column stays slim. The result is a content-sized table with horizontal scroll on overflow — closer to Notion's shape — but it depends on DataViews' class names and CSS specificity remaining stable.

**Where.** `src/index.scss`, around the `.dataviews-view-table` block.

**Solution.** Upstream a `tableLayout` (or similar) prop on DataViews that exposes "auto with redistribution" vs. "fixed with content-sized columns" as a documented choice, plus per-field `width` hints so consumers can pin column widths without touching DataViews CSS.

