# Tech debt and upstream gaps

A running log of the workarounds in this codebase. Most are here because a primitive is missing in WordPress core or Gutenberg rather than because we cut corners. The high-impact items live at the top; trivial ones at the bottom.

Each entry is tagged `[upstream]` (we're waiting on Gutenberg or core) or `[internal]` (ours to schedule), and broken into **What** (the problem), **Where** (the code that's load-bearing), and **Solution** (how this gets cleaner). Numbers are stable cross-references: code that works around an entry tags itself with `tech-debt.md#N`, so `grep -r 'tech-debt.md#3' src/` lights up every spot affected.

Pair with [decisions.md](decisions.md) for choices we've made peace with and [roadmap.md](roadmap.md) for net-new product work.

## 1. DataViews has no inline cell editing `[upstream]`

**What.** DataViews v6 ships display layouts and a separate `DataForm` for editing, but no way to make a table cell editable in place. So we mount our own editor from `field.render` (a display renderer in the docs, but the only seam we have), keep edit state per cell, and route saves back through a `RowMutationContext` since `field.render` only gets `{ item }`. Tab and Shift+Tab between cells live in the same layer: editors intercept Tab, ask the parent for the next editable cell via `requestNext`, and the target cell pops open via the `editRequest` channel that also handles auto-focusing the title cell of a fresh row.

**Where.** `src/components/EditableCell.js`, `RowMutationContext` and `requestNext` in `src/components/CollectionDataViews.js`, plus a sliver of `src/index.scss`.

**Solution.** What we'd want upstream: an `editable` mode on the table layout that uses each field's `Edit` per cell, an `onSaveItem(item, changes)` prop on `<DataViews>`, native cell-to-cell keyboard navigation, and a layout contract for "this control is rendered inline." With those, `RowMutationContext`, `requestNext`, most of `EditableCell`, and the layout couplings tracked in #5 all go away. It's the biggest entry on this page (~530 lines of `EditableCell` plus context wiring and the navigation walker). File a Gutenberg issue with the use case and proposed shape; `docs/roadmap.md` lists upstream issues as a stretch success metric.

## 2. Rows aren't in `core-data`'s entity store `[internal]`

Updated by [#80](https://github.com/priethor/cortext/pull/80) and #179.

**What.** Rows still sit outside `core-data`. `useCollectionRows` owns fetch state, the `requestId` race guard, the manual `refresh()` counter, and the choice between server and client mode. #80 moved the normal table path to paged REST requests, then changed the fallback from one `per_page=-1` request to pages of 100 fetched with a small concurrency cap. #179 exposed the same gap from another angle: trashing or restoring a row can change relation chips and rollups in other open collections. Since there is no shared row store, the client fires small row and document-trash events, then lets open row queries and the sidebar Trash list refetch.

The dynamic `crtxt_{slug}` post types already use `show_in_rest`, so `core-data` can probably discover them lazily. We have not wired rows through it yet. Mutations still POST directly with `apiFetch`, then ask the hook to refetch.

**Where.** `src/hooks/useCollectionRows.js`, `src/hooks/rowInvalidation.js`, `src/hooks/documentTrashInvalidation.js`, and `src/hooks/useTrashedDocuments.js`, with call sites in `src/components/CollectionDataViews.js` (`saveRowField`, `onCreated`, row trash), `src/components/SidebarTrash.js`, `src/router/EntityRoute.js`, and forced client mode in `src/components/relations/RelationEditor.js`.

**Solution.** Switch to `useEntityRecords('postType', \`crtxt_${slug}\`, query)` plus `saveEntityRecord` for writes once the remaining query shapes can be expressed there. `core-data` would then own caching, race protection, and post-mutation invalidation. Knock-on workarounds it deletes:

- The `refresh()` handles and invalidation events exist only because rows aren't reactive.
- Half of `RowMutationContext` (also driven by #1) exists because cells can't reach a `core-data` store that isn't there.
- `onCreated` runs optimistic `lastPage = ceil((totalItems+1)/perPage)` arithmetic against possibly stale `paginationInfo`. With reactive pagination we'd watch `totalPages` in an effect.
- The server/client planner becomes normal resolver queries instead of a local fetch policy.

Worth a small spike before committing; `core-data`'s schema cache for rarely-changing post types is the only real risk.

That does not mean every document-shaped query belongs in `core-data`. Single records and mutations should use the entity store when WordPress can model them. Cross-type product views, like Trash, can stay behind `/cortext/v1/documents/*` endpoints.

## 3. Sorting support is split between REST and client mode `[internal]`

Updated by [#80](https://github.com/priethor/cortext/pull/80) and RSM-1459.

**What.** #80 fixed the old bad state where the sort UI changed but REST ignored it. RSM-1459 moved the supported scalar collection sorts into `/cortext/v1/rows`: title, timestamps, text-like fields, number, date/datetime, select, checkbox, email, and URL. With no explicit sort, REST still uses oldest-first ordering so new rows land at the bottom of the table.

The debt is the split brain. The client has an allow-list for server-safe sorts, and `FieldTypeRegistry` / `RowsFilterQuery` own the PHP version of the same story. Unsupported display-value sorts fall back to client mode: fetch all pages, then let DataViews sort locally. That keeps the result honest, but it is not where we want sorting to live long-term.

The hard cases are still display-value sorts: users, relations, list-style rollups, files, and any field where the value users see is not the value stored in meta. That broader choice is tracked in #14.

**Where.** The query planner and sort allow-lists in `src/hooks/useCollectionRows.js`, the `onCreated` no-sort branch in `src/components/CollectionDataViews.js`, `FieldTypeRegistry`, and `RowsFilterQuery::validate_sort()`.

**Solution.** Make REST the source of truth for sortable fields and expose that capability to the client instead of mirroring it by hand. Resolve #14 for display-value sorts, then remove the client fallback for sorting except where DataViews really needs a local-only view state.

## 4. Filtering support is split between REST and client mode `[upstream, internal]`

Updated by [#80](https://github.com/priethor/cortext/pull/80) and RSM-1459.

**What.** #80 made simple field filters real on the server. RSM-1459 expanded that to the supported Notion-style operators, title filters, split-term search, and nested `AND` / `OR` groups through `RowsFilterQuery` and `RowsMetaQuery`. When the server cannot handle a filter, the hook falls back to client mode, fetches all pages, applies grouped filters in a small Cortext wrapper, and lets DataViews handle the remaining flat search/sort/pagination work.

The cost is another split support matrix. The client checks field type, operator, grouping, and value shape before choosing server mode. PHP validates the same contract from the collection schema. `FieldTypeRegistry` is Cortext's local stand-in for an upstream field-query capability contract: sortable, filterable, text-like, storage type, and supported operators. WordPress post meta and DataViews each know part of that story, but neither exposes the whole contract for custom field types today. System fields are still deferred (#13), display-value fields are still client-only, and grouped filters only go server-side when every descendant is supported.

**Where.** `FieldTypeRegistry`, `serverFilterNode` / `buildQueryPlan` in `src/hooks/useCollectionRows.js`, `filterSortAndPaginateWithGroups` in `src/components/groupedFilters.js`, `RowsFilterQuery`, `RowsMetaQuery`, and `prefillFromFilters` in `src/components/CollectionDataViews.js`.

**Solution.** Make the server-owned capability map the only local source of truth, then shrink it if DataViews or WordPress grows a first-class query-capability contract for custom fields. System fields need the date/user handling from #13, and display-value fields need dedicated query semantics instead of pretending stored meta is the UI value.

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

**Solution.** More "tidy up later" than tech debt: switch to DataViews free composition (already supported via `children`) and lay out `<DataViews.Layout />` and `<DataViews.Pagination />` ourselves. Free composition works today; an upstream `footer` prop would just be neater. This is separate from table-internal footer rows for calculations; see #36 for that harder gap.

## 8. `CheckboxControl` ignores `hideLabelFromVision` `[upstream]`

**What.** `CheckboxControl` always renders its `label` prop as a visible `<label>` next to the input regardless of `hideLabelFromVision` (verified against `node_modules/@wordpress/components/build-module/checkbox-control/index.mjs`). DataViews columns already show the field label in the header, so passing `label={ label }` echoed it next to every checkbox. We pass `aria-label={ label }` instead, which the component forwards to the underlying input. Screen readers still get a label; sighted users no longer see it twice. Risk: the next contributor reaches for `label` (the documented prop) and the duplicate quietly returns.

**Where.** Checkbox cell in `src/components/EditableCell.js`.

**Solution.** File a Gutenberg bug or PR. In the meantime, the `tech-debt.md#8` comment next to `aria-label` is the signal.

## 9. WorDBless can't integration-test the rows endpoint `[internal]`

**What.** WorDBless uses `Db_Less_Wpdb`, an in-memory store where `wp_insert_post` and `get_post` work via the object cache but `WP_Query` SQL returns zero results. `InMemoryPostsQuery` now covers the simple query shapes used by document listing and page-trash cascade tests: post type, status, parent, `meta_key` / `meta_value`, search, ordering, and pagination. That keeps those tests useful, but it is still an approximation of WordPress queries, not a real database.

The harder gap remains the rows endpoint. `RowsController` unit tests cover routing, permissions, validation, query-arg building, and row formatting (the last two via reflection), but cannot exercise the full path of inserting rows and verifying they come back from `GET /cortext/v1/rows`. `RowsFilterQuery` and `RowsMetaQuery` build SQL for custom compares and grouped filters; a wrong join, `meta_query` compare, or title sentinel would still slip past WorDBless-only tests.

**Where.** `tests/php/InMemoryPostsQuery.php`, `tests/php/test-documents.php`, `tests/php/test-rest-documents-controller.php`, `tests/php/test-page-trash-cascade.php`, `tests/php/test-rest-document-trash-controller.php`, and `tests/php/test-rest-recents-controller.php`, plus the still-limited row coverage in `tests/php/test-rest-rows-controller.php`.

**Solution.** Keep the in-memory shim for simple document queries, but test the row endpoint against a real `wpdb` before treating sort/filter/pagination as covered. Either add a `wp-env` + `WP_UnitTestCase` suite for rows, or rely on targeted e2e coverage in `tests/e2e/specs/data-view-block.spec.js` until that suite exists. Once real database coverage exists, the shim should stay limited to tests that only need cheap post lookup behavior.

## 10. DataViews `FieldType` union has no decimal `number` or `url` `[upstream]`

**What.** DataViews v6's `FieldType` union is `'text' | 'integer' | 'datetime' | 'date' | 'media' | 'boolean' | 'email' | 'array'`. Cortext has `number` (decimals allowed) and `url`, neither of which has an exact match. We map numbers to `'integer'` so the filter UI can offer numeric operators, then disable DataViews' integer-only validator, attach a decimal-aware sort comparator, and provide a decimal-safe number filter control because the built-in integer `between` control applies whole-number min/max bounds. URLs still map to `'text'`, which is close enough for contains/starts-with filters but not an exact semantic type.

**Where.** `mapField` in `src/hooks/fieldMapping.js`.

**Solution.** DataViews adds a decimal-friendly `'number'` type and a `'url'` type, or exposes a cleaner way for consumers to supply custom field controls/operator sets without borrowing the nearest built-in type. Filing a Gutenberg issue is the cheaper play.

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

**What.** `created_by`, `modified_by`, Person-style fields, Relations, relation-backed Rollups, and Files all share the same problem: the stored value is an internal handle, while the useful sort is the displayed value. Sorting by user ID, row ID, or attachment ID is not what users mean. Sorting by display name, related-row title, filename, or a computed rollup value needs either JOINs, denormalized display values, or an in-memory pass.

Relations and list-style rollups now keep sorting disabled. Scalar rollups can sort in the client while the table has all rows loaded, but the REST query path still cannot order by computed rollup values because they are not stored as row meta. `build_query_args` falls back to the default date ordering if a rollup sort reaches the server.

**Where.** `validate_sort_field` and `build_query_args` in `includes/Rest/RowsController.php`; `enableSorting: false` for display-value fields in `systemFields` and `mapField` (`src/hooks/fieldMapping.js`).

**Solution.** Pick one model for display-value sorting: JOIN-and-sort in `build_query_args`, denormalize sortable display values into row meta, or keep fetching all rows and sort in memory. The answer should cover system user fields, Relations, Rollups, Person, and Files at the same time. Tracked in RSM-1793.

## 15. DataViews table columns lack interaction extension points `[upstream]`

**What.** DataViews persists table column order in `view.fields` and widths in `view.layout.styles`, but it doesn't expose a table-column interaction layer: no resize handles, min/max width contract, double-click autofit, reorder callback, drag preview, stable header/cell refs, or supported way to opt into `table-layout: fixed`. Cortext therefore portals resize and dnd-kit drag handles into DataViews-rendered `<th>` elements, snapshots header geometry during drag, mutates inline widths during resize for immediate feedback, and overrides internal table/cell wrapper CSS so narrow columns behave as hard constraints rather than intrinsic-size hints.

Double-click autofit is the trickiest piece. With no measurement hook upstream, we clone the cell into a hidden subtree that has to recreate every ancestor that affects layout: a `.cortext-data-view` wrapper for our scoped overrides, a real `<tbody>` or `<thead>` for upstream's tbody-scoped rules, an append next to the live `.dataviews-wrapper` for font inheritance, and `display: block` on the wrapper so flex sizing on the parent doesn't push the measurement around. Then the persisted width subtracts the cell's own padding and border (we read border-box, write content-box), and a 2px buffer absorbs proportional-digit rounding so `2007` doesn't clip where `1939` fits. Each ancestor and constant is a place the live DOM can drift away from us.

**Where.** `src/components/DataViewColumnInteractions.js`, `src/components/dataViewColumns.js`, the `DataViewColumnInteractions` mount in `src/components/CollectionDataViews.js`, and the column affordance / table wrapper rules in `src/index.scss`.

**Solution.** Upstream DataViews could expose table-column APIs that cover `onChangeFields`, `onChangeColumnStyle`, resize handle rendering, per-field min/max widths, double-click autofit, drag overlay/insertion affordances, and stable header/cell slots or refs. If DataViews owned that layer, Cortext could drop the portal/DOM-query adapter, the wrapper min-width overrides, most of the dnd-kit column glue, the cloned-measurement gymnastics, and the direct DOM mutation used for live resize feedback.

## 16. DataViews has no per-column menu-item slot `[upstream, soft]`

**What.** DataViews' column-header dropdown (Sort / Add filter / Move / Hide) is a closed list — there's no `field.menuItems` to inject Rename / Duplicate / Delete or Calculate. To keep a single dropdown per column, we hide DataViews' built-in trigger on custom-field `<th>`s via CSS and portal our own combined trigger in (Sort / Move / Hide *plus* field management and table calculations). Title and system fields keep the built-in trigger. Main's drag-handle click-forward (`DataViewColumnInteractions`) iterates header buttons and skips `display: none` ones via `offsetParent`, so it lands on whichever trigger is visible. Filter is intentionally absent — Cortext doesn't surface column-level filters in the header.

**Where.** `src/components/fields/ColumnHeaderActions.js` (combined dropdown), `src/index.scss` (`.dataviews-view-table th:has(.cortext-column-header-marker) > .dataviews-view-table-header-button { display: none }`), `src/components/DataViewColumnInteractions.js` (visible-button click forward).

**Risk.** Re-implementing Sort / Move / Hide ourselves means new DataViews items in those menus won't show up here automatically. Calculation controls add one more reason this custom menu has to stay in lockstep with DataViews. If main's drag handle stops calling `.click()` on the header trigger, the column-name click-to-open behavior would need a different forward.

**Solution.** A `field.menuItems` (array or render-prop) on DataViews fields, appended to the built-in dropdown. Other consumers (Pattern Manager, Pages, Site Editor) would benefit too. File as a Gutenberg feature request.

## 17. Add-field header piggybacks on the DataViews actions column `[upstream, soft]`

**What.** The table's `+ add field` button now sits in DataViews' row-actions column header. `ColumnHeaderActions` finds `th.dataviews-view-table__actions-column` and portals the button there; CSS hides the built-in "Actions" label and keeps the header cell sticky on the right. This is cleaner than the old synthetic `__add_field` column because it no longer leaks into `view.fields`, but it still leans on DataViews internals. If the class name, header rendering, or sticky-column markup changes, the button can disappear or stop lining up with the row kebabs.

The create-field flow also has to reveal the new trailing column itself. It carries the created field ID back to `CollectionDataViews`, waits until the field marker exists in the rendered header, then scrolls `.dataviews-wrapper` to the right edge. The interaction feels right, but it still depends on DataViews' DOM shape.

**Where.** `src/components/fields/ColumnHeaderActions.js` (actions-column lookup and portal), `src/components/CollectionDataViews.js` and `src/components/dataViewScroll.js` (created-field reveal and `.dataviews-wrapper` scroll), `src/index.scss` (`.dataviews-view-table__actions-column` overrides), and the legacy `__add_field` cleanup in `src/components/CollectionDataViews.js`.

**Solution.** DataViews exposes a trailing table-header slot, an add-column slot, or a header action area separate from per-row actions, plus refs for the table scroll wrapper and rendered headers. Then the portal targets a real extension point, the reveal code stops querying DataViews DOM, the sticky/header-label CSS disappears, and `__add_field` stays only as migration cleanup for old saved views.

## 18. Field management is table-layout only `[internal]`

**What.** Rename / Duplicate / Delete only show up in the table-layout column-header kebab. Grid and list layouts have no schema actions. Users there can still create fields via the toolbar Add field button, but they have to switch to table to manage existing fields.

**Where.** `ColumnHeaderActions` mounts only when `view.type === 'table'` (`src/components/CollectionDataViews.js`).

**Solution.** A toolbar "Manage fields" panel listing every custom field with per-row rename / duplicate / delete, available in every layout.

## 19. Select / multi-select fields ship with no options `[internal]`

**What.** Add field creates the field immediately when you click a type — there's no second step for type-specific config. For select / multi-select that means the column starts empty; users have to add options via wp-admin or by re-saving through REST.

**Where.** `src/components/fields/AddFieldPopover.js` (no options input). The REST route already accepts an `options` array; the UI just doesn't surface it.

**Solution.** A field-edit dialog from the column kebab (next to Rename / Duplicate / Delete) with an options editor — one-per-line textarea, or a chip list with colors. Until then, options live in wp-admin or REST.

## 20. Table layout overrides couple to DataViews internals `[upstream, soft]`

**What.** DataViews ships `table-layout: auto; width: 100%` plus per-cell padding rules. We flip to `table-layout: fixed; width: max-content` with explicit per-cell widths so adding or removing a field doesn't reflow every other column. We also override the actions-column header so the add-field button stays pinned beside the row kebabs. The table sizes to its content and scrolls horizontally on overflow. Depends on DataViews' class names and selector specificity staying put.

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

**What.** The `cortext/data-view` block exposes `align` (default / wide / full) for width but nothing for height. For now the block sizes to its content: short tables fit their rows, long tables grow with the page, and empty blocks fall back to DataViews' no-results state. That default is easy to understand, but authors still can't say "show 10 rows and scroll the rest." A long table stretches the document.

**Where.** `src/blocks/data-view/block.json` (no `height` attribute today). The block-mode size rule lives in `src/index.scss` next to the `.wp-block-cortext-data-view .cortext-data-view > .dataviews-wrapper` override.

**Solution.** Add a `height` (or "rows visible") attribute to the block with an inspector control, and clamp the shell to that value when set. A density-aware default would help, but the per-block control is the part that matters.

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

**What.** `Menu.SubmenuTriggerItem` opens a nested `Menu.Popover`, but the popover's children have to be `Menu.Item` / `Menu.Group` / `Menu.Separator`. Our "Edit field" submenu has tile previews (Number / Bar / Ring), labelled rows with right-anchored values, and three more popovers for format, color, and time choices. The Calculate submenu is simpler, but it still needs the same hover bridge so it feels like the adjacent Edit field menu. None of that fits the menu-primitive contract cleanly, so these panels stay as sibling popovers, we run the hover-with-grace bridge ourselves, and the parent menu's `hideOnInteractOutside` filter ignores clicks landing in `.cortext-format-submenu`, `.cortext-format-submenu__flyout`, or `.cortext-table-calculation-submenu`.

**Where.** `openFormat` / `openCalculation` / `scheduleClose` and `hideMenuOnInteractOutside` in `src/components/fields/ColumnHeaderActions.js`. `FieldFormatPopover` and its flyouts in `src/components/fields/FieldFormatPopover.js`. `TableCalculationMenu` and its flyouts in `src/components/TableCalculationMenu.js`.

**Solution.** An arbitrary-content submenu variant in WP's `Menu` (or upstream Ariakit) would let these panels mount as real submenus, with outside-click and focus management owned by the library. Until then the manual bridge stays.

## 31. Block editor has no non-serialized before/after block chrome slot `[upstream]`

**What.** Document identity actions ("Add icon" / "Add cover") are editor chrome, but the ideal visual placement is immediately before the document title inside the block canvas. Persisting an actions block put UI into post content, while portalling controls into the iframe coupled us to BlockList DOM and block hover/selection behavior. The current compromise renders editor-only actions from the canvas shell, outside the persisted `BlockList`, and inserts only the real dynamic blocks (`cortext/document-icon`, `cortext/document-cover`) into content.

**Where.** `DocumentIdentityActions` and `EnsureHeaderBlocks` in `src/components/EditorBody.js`; legacy no-op registration in `includes/Editor/PageHeaderActionsBlock.php`.

**Solution.** Gutenberg could expose a non-serialized block chrome slot/fill, e.g. "before/after this block" keyed by `clientId`, block name, and root list. Fills would participate in editor layout and focus order but stay out of block order, list view, serialization, copy/paste, movers, undo history as content, and frontend rendering. Cortext could then render the identity actions before the root `core/post-title` without storing a fake block or querying iframe DOM.

## 32. Public pages render the title twice `[internal]`

**What.** `DocumentIdentity::prepend_header_blocks` slips a locked `core/post-title` block into `post_content` on insert, so the editor canvas can show the title inline as part of the BlockList. The public template still calls `the_title()` immediately before `the_content()`, and `core/post-title` resolves to the same `post_title` again, so every page created after this filter landed renders its title twice publicly. Older pages (no title block in their content) are fine until the editor next persists them.

**Where.** `prepend_header_blocks` in `includes/PostType/DocumentIdentity.php`, paired with `the_title()` in `templates/single-crtxt_page.php`.

**Solution.** Stop baking `core/post-title` into `post_content` and mount the editor's title input as canvas chrome above `BlockCanvas`, the way Gutenberg itself does it. The template keeps `the_title()` as the single source of truth; the editor keeps an inline-editable title; pages already saved with the block get a small migration that strips it. Until then `the_title()` is the authoritative render and the duplication is the cost of the canvas-as-blocklist shape.

## 33. Frontend stylesheet doesn't carry the cover/icon rules `[internal]`

**What.** `.cortext-document-cover-block` and `.cortext-document-icon` rules live in `src/index.scss`, which only builds to the admin shell bundle. The PHP `render_callback`s emit the same wrapper classes for the public frontend, but `src/frontend.scss` has no matching rules, so on a public `crtxt_page` the cover banner renders at intrinsic image size and the icon block falls back to inline-default layout.

**Where.** `src/index.scss` (cover/icon block rules) versus `src/frontend.scss` (no matching rules), enqueued by the public template.

**Solution.** Extract the cover/icon block rules into a partial both stylesheets `@use`, so admin and frontend stay in sync without copy-paste drift. The shell-only chrome (hover replace/remove, picker popovers) stays in `index.scss`; only the persisted block markup needs to be shared.

## 34. WP-icon variant renders blank on the public frontend `[internal]`

**What.** `DocumentIconBlock::render` emits a marker span (`<span class="cortext-document-icon--wp" data-icon="…">`) for the `wp` icon variant and relies on a frontend hydration step to fill in the SVG. `frontend.js` is CSS-only, so nothing fills it and the icon disappears on the public page; the saved color is also dropped. Emoji and image variants render server-side and are fine.

**Where.** Case `'wp'` in `includes/Editor/DocumentIconBlock.php`, paired with `src/frontend.js` (no hydration).

**Solution.** Either ship the SVG inline server-side (a small build-time generator that reads `@wordpress/icons` and emits a name-to-markup PHP map, refreshed on install) or hydrate from `data-icon` markers in `frontend.js` (smaller PHP surface, adds a public script). The inline-color is a one-line fix in either path. Until then, surface the limitation in the picker copy or restrict the saved variant to emoji + image for public-rendered pages.

## 35. Nested `Popover` outside clicks do not close the host `[upstream]`

**What.** `Popover` handles outside clicks one popover at a time. In the option editor, the main picker opens a second popover for an individual option's color/menu controls. After a color edit, the first click outside both popovers closed only the small option menu; the main picker stayed open because the host never saw that same outside click. We now listen for `pointerdown` while the option menu is open and ask the host to close when the click lands outside both popovers.

**Where.** The pointer listener in `EditOptionsPopover` (`src/components/fields/EditOptionsPopover.js`) and the `onRequestClose` plumbing through `EditableCell`, `MultiselectEdit`, and `ColumnHeaderActions`.

**Solution.** `Popover` needs a parent/child dismissal story: either close the whole stack when a click lands outside all related popovers, or expose enough event detail for a host popover to opt into that behavior without a document-level listener.

## 36. Table footer content lives outside DataViews' table contract `[upstream, internal]`

**What.** DataViews owns the table markup, but it has no place for footer content: no footer-row slot, no per-column summary cell, no table-aligned bulk-action area, and no "filtered rows before pagination" result. The calculation footer has to find the rendered `.dataviews-view-table`, watch for it with a `MutationObserver`, and portal a `<tfoot>` into the table after DataViews renders.

In table layout, bulk row actions use that same footer row. Selected-row controls and column summaries sit on one line, which is the right layout, but the plumbing is awkward. `CollectionDataViews` passes the table bulk controls into the portaled footer, and `index.scss` manages the checkbox-width spacer, overflow, and stacking so the buttons stay clickable without painting over the block selection outline. Grid still uses the composed DataViews footer because there is no table summary row to align with.

For calculations, we also need rows after search/filter but before pagination. DataViews does not hand that list back to consumers, so `CollectionDataViews` runs DataViews' `filterSortAndPaginate` helper a second time with `page` and `perPage` removed.

Calculation state also stays in Cortext. `view.calculations` lives on the DataViews view object because embedded data-view blocks already persist that object, and named saved views do not exist yet. `normalizeView` prunes stale calculation entries when fields disappear or their type changes. That keeps the saved shape honest, but it is still Cortext state attached to a DataViews object that upstream knows nothing about.

**Where.** `src/components/TableCalculationsFooter.js` (table lookup, observer, `<tfoot>` portal), `src/components/CollectionDataViews.js` (second filtering pass, table bulk controls, and footer mount), `src/index.scss` (footer-row alignment and overflow rules), `src/components/tableCalculations.js` (operation matrix and result formatting), and `src/components/dataViewColumns.js` (view cleanup).

**Solution.** DataViews needs either a table `renderFooter` / `renderSummaryRow` slot, or a column-level summary API that gets the filtered, unpaginated rows and leaves space for table-level selection controls. Then we can drop the DOM lookup and portal. A helper that returns filtered rows before pagination would remove the second `filterSortAndPaginate` pass. Internally, saved named views should eventually make `calculations` part of Cortext's own saved view schema instead of just an extra key on embedded block state.

## 37. DataViews has no relation/reference field primitive `[upstream]`

**What.** Relation fields are stored as row post IDs, but the UI behavior is a reference field: search rows in a target collection, pick one or many, optionally create a missing row, render linked row chips, and navigate to the referenced collection/row. DataViews has no `relation` / `reference` field type and DataForm has no async record-picker control that accepts a target entity/query and cardinality. Cortext therefore maps relations to the closest DataViews metadata type, carries relation-specific metadata on the field object, renders relation display chips from `field.render`, and ships a custom picker backed by `useCollectionRows`. The same gap will get louder when row-modal opening and richer relation previews land.

**Where.** `mapField` / `buildRender` in `src/hooks/fieldMapping.js`, `src/components/relations/RelationEditor.js`, `src/components/relations/RelationReferences.js`, relation setup in `src/components/fields/AddFieldPopover.js`, and the `.cortext-relation-*` rules in `src/index.scss`.

**Solution.** Upstream DataViews/DataForm (or shared WP components) could expose a generic reference field/control: target entity config, single vs multi cardinality, async search, optional create-new affordance, token/chip rendering hooks, and a supported action slot for opening or navigating to referenced records. Cortext would still own the backend relation sync and reverse-field semantics, but could drop most of the custom relation picker/display code and stop smuggling relation metadata through DataViews field objects.

## 38. Command palette embedding needs host glue `[upstream, soft]`

**What.** Cortext uses `@wordpress/commands` for command registration and palette state, but the stock menu is built for wp-admin. On the Cortext screen we need a scoped app palette: keep Core's commands out, avoid a second cmd+K menu, return focus to the workspace after a command runs, and put workspace recents in their own section instead of mixing them into suggestions. That leaves some glue in Cortext: a local data registry, a `wp-core-commands` dequeue, a bundled stylesheet import, a canvas ref for focus return, and a local command-menu renderer.

The awkward bit is `CortextCommandMenu`. `@wordpress/commands` has a built-in "Recent" group, but that means recently used commands, not Cortext workspace history, and there is no public way to add a custom group. So Cortext renders the menu itself while still reading from the upstream command store. That is better than patching `node_modules` or poking the DOM after render, but upgrades need a close look at the upstream menu markup, CSS classes, keyboard behavior, and `cmdk` wiring.

The user-facing placeholder is still Core's generic "Search commands and settings" string too. Fine for this slice, but it will feel off once the palette grows into actual Cortext search.

**Where.** `src/components/CommandPalette.js`, `src/components/CortextCommandMenu.js`, the `canvasRef` passed from `src/router.js`, `dequeue_core_command_palette` in `includes/Admin/Screen.php`, and the `@wordpress/commands` stylesheet import and Cortext command-menu overrides in `src/index.scss`.

**Solution.** Upstream could make app-owned palettes less ad hoc: a scoped command registry or namespace API, a supported way for full-screen admin apps to opt out of Core's admin palette, a custom input label, an explicit focus-return target or after-close callback, and a group/section API for registered commands or command loaders. With those, Cortext could keep registering commands through `@wordpress/commands`, render workspace recents through an upstream extension point, and drop the local menu renderer plus most of this shell-specific wiring.

## 39. Row detail relation editing is deferred `[internal]`

**What.** Relation fields look like regular row fields in the detail view, but they are not regular meta. A plain `editPost( { meta } )` save would only update the current row. It would skip `RowsController::update_row_field()` and `Relations::sync_relation_value()`, so the row on the other side of the relation could be left pointing at stale data. For now, row detail shows relations but does not let you edit them.

**Where.** `isRowDetailFieldEditable` in `src/components/RowDetailView.js`.

**Solution.** Reuse the relation picker in row detail and save relation changes through the row-field endpoint, not through generic post meta edits. Once DataViews has a real relation/reference field primitive (#37), there should be less custom wiring here.

## 40. Autosave has to infer save completion `[upstream, soft]`

**What.** `savePost()` gives us a promise when Cortext starts the save. If a save is already running, though, Gutenberg only tells us about it through selectors like `isSavingPost()` and `didPostSaveRequestFail()`. There is no promise to await. `flushNow()` has to keep its own small list of waiters and release them when `isSaving` flips back to false.

The same selector shape affects user-visible save side effects. `didPostSaveRequestSucceed()` and `didPostSaveRequestFail()` are level signals, not one-shot events. They can stay true after the save that set them, so mounting autosave on a different row or changing `recentTarget` can otherwise replay an old success into status and Recents. The hook tracks the previous `isSaving` value and only treats success as current when this hook observed the save finish.

**Where.** `savePromiseRef`, `savingWaitersRef`, `prevIsSavingRef`, `flushNow`, and the save-status effect in `src/hooks/useAutosave.js`.

**Solution.** Gutenberg could expose the current save promise, make `savePost()` return the in-flight promise when one already exists, or expose per-save completion events/state keyed to a request. Then Cortext could drop the waiter bookkeeping and the local `isSaving` edge detection.

## 41. Favorite rows have their own sidebar-row shape `[internal, soft]`

**What.** Favorites look like sidebar rows, but they are not normal page-tree rows. They are shortcuts, they should never show the active selection state, and they are sortable only inside the Favorites section. Sharing the whole row as both a navigation button and a dnd-kit sortable handle made clicks repaint the hover state and feel like a flash. The current row splits those jobs: the icon is the drag handle, the title is a plain navigation button, and the star is the remove action. It works, but it means Favorites carry a small custom row shape alongside `PageRow` and `CollectionRow`.

**Where.** `src/components/SidebarFavorites.js`, plus the `.cortext-sidebar__favorite-*` rules in `src/index.scss`.

**Solution.** Extract a shared sidebar-row primitive with explicit slots for title navigation, drag handle, menu/actions, selected state, and shortcut-only rows. Then `PageRow`, `CollectionRow`, and `SidebarFavorites` can share the same interaction contract without reusing the wrong DOM shape for Favorites.

## 42. Row properties need a real document block `[internal, important]`

**What.** Important. Row documents now look much closer to pages in the editor, but their collection-field properties are still Cortext shell UI sitting above the block-editor iframe. That is fine for this pass: the form works, and full-page mode can hide it. It is not fine as the long-term publishing model. Because the properties sit outside `post_content`, public themes never see them through `the_content()`, and we cannot get the Notion order (cover, icon, title, properties, body) without another one-off surface. If rows can be published, this is the next architectural gap to close.

**Where.** `RowProperties` in `src/components/RowProperties.js`, mounted from `src/components/Canvas.js` for full-page row documents and `src/components/RowDetailView.js` for side/modal row detail. There is still no `cortext/document-properties` block or PHP render callback.

**Solution.** Build `cortext/document-properties` as a locked dynamic block, in the same family as `cortext/document-cover` and `cortext/document-icon`. Its `edit()` should reuse the row-property form inside the editor iframe. Its `render_callback` should read the row's collection schema and meta, then emit frontend HTML for public themes. The header-block insertion path should place it after cover/icon/title on row documents. The full-page hide/show control then becomes an editor visibility preference, not the source of truth for whether properties exist in the document.

## 43. Row recents still target the parent collection `[internal]`

**What.** Recents stores row identity (`kind: row`, row id, and parent collection id), but the response still sends the parent collection as the clickable path. Row documents now have their own document URLs, so this is only a first-pass fallback: it gets the user back to the right table, but not directly into the row document they touched. The stored identity is enough to improve the target without changing the saved meta shape.

**Where.** Row handling in `includes/Rest/RecentsController.php`, row clicks in `src/components/SidebarRecents.js`, recent row commands in `src/components/CommandPalette.js`, and the row-recents e2e coverage in `tests/e2e/specs/recents.spec.js`.

**Solution.** Have row recents return the row document path, or give recents a route target shape instead of a single path string. That target should use the same document URL helper as row detail and relations, so sidebar recents and palette recents open the row directly instead of stopping at the parent collection.

## 44. Recents tracking is wired at each call site `[internal]`

**What.** There is no workspace activity layer. Each surface that counts as a visit or edit calls `touchRecent` itself: route resolution, page autosave, sidebar rename, row field save, row creation, and relation-created rows. That makes the behavior easy to understand right now, but future write paths can forget to update recents unless the reviewer knows to look for it.

**Where.** `src/router/EntityRoute.js`, `src/hooks/useAutosave.js`, `src/components/Sidebar.js`, `src/components/CollectionDataViews.js`, and `src/components/relations/RelationEditor.js`.

**Solution.** If more activity surfaces appear, move this behind a small workspace activity helper or event. Route visits can stay in the router, but writes should eventually report through the same mutation path instead of each component remembering to call `touchRecent`. If rows move into `core-data` (#2), that would be a natural time to centralize row touches too.

## 45. Select server sort uses stored values, not option order `[internal]`

**What.** Server-side row sorting treats select fields as scalar stored values. That keeps `GET /cortext/v1/rows` sortable without joining or decoding option metadata, but it differs from Notion-style curated option ordering.

**Where.** `RowsFilterQuery::apply_sort_clauses()` in `includes/Rest/RowsFilterQuery.php`.

**Solution.** If users expect select order to follow the field's configured options, compile select sorts into an option-order `CASE` expression generated from the field schema. Until then, document stored-value sorting as the v1 behavior.

## 46. Row filters extend `WP_Meta_Query` with custom compares `[upstream, soft]`

**What.** `RowsMetaQuery` keeps row filters on WordPress's native meta-query tree instead of building a parallel SQL compiler, but core's compares do not cover every database-style operator Cortext needs. `LIKE` always wraps both sides, so starts-with and ends-with need one-sided patterns. Multi-value fields need "no meta row has this value" for `isNone` / `notContains`, which is not the same as a plain `!=` join. Title filters also live on `wp_posts.post_title`, outside post meta, so they ride through a sentinel clause.

**Where.** `RowsMetaQuery` in `includes/Rest/RowsMetaQuery.php`, called from `RowsFilterQuery::meta_query_sql()`.

**Solution.** Upstream `WP_Meta_Query` could grow one-sided `LIKE` compares and value-bearing negative `NOT EXISTS` compares. A structured title-query helper in `WP_Query` would cover the title sentinel separately. If those land, `RowsMetaQuery` shrinks back toward a thin adapter or disappears.

## 47. Cascading Popovers need manual fallback placement `[upstream, soft]`

**What.** `@wordpress/components` `Popover` can shift a submenu along the cross axis, but it does not try a left-side fallback when a `right-start` cascading submenu runs past the viewport edge. Cortext now measures the outer menu and the portaled submenu, starts on the side that keeps the submenu away from the column dropdown, then switches to `left-start` or `bottom-start` if the first placement clips. This keeps Format and Calculate submenus usable near the right side of the table, but it is still a local placement policy layered on top of Popover.

**Where.** `useSubmenuPlacement` in `src/hooks/useSubmenuPlacement.js`, wired into `src/components/fields/FieldFormatPopover.js` and `src/components/TableCalculationMenu.js`.

**Solution.** WordPress Popover could expose fallback placements, or pass enough Floating UI middleware through for consumers to say "try right, then left, then bottom" without measuring after render. If that lands, Cortext can drop `useSubmenuPlacement` and let the Popover own cascading-menu collision handling.

## 48. Cortext document layer is still thin `[internal]`

**What.** Pages and collection rows both opt into `cortext-document`, and there is now a shared reader: `Cortext\Documents`, `GET /cortext/v1/documents`, `useDocuments`, trash listing, and recents formatting all use the same document shape. That removes the old one-off trash enumerator and gives cross-type search/list code one place to start.

The layer is still mostly read-only. Pages still go through the page tree and `core-data`, rows still go through `useCollectionRows`, and restore/delete still fan out into page-tree refresh, row-query invalidation, collection context refresh, and Trash refresh. Favorites, routing, URL targets, and activity tracking also still ask "page or row?" in places that should only need "document." Row documents in recents still route back to their parent collection (#43), so the document shape carries a path, but not always the final document target users expect.

**Where.** `includes/Documents.php`, `includes/Rest/DocumentsController.php`, `includes/Rest/RecentsController.php`, `src/hooks/useDocuments.js`, `src/hooks/useTrashedDocuments.js`, `src/components/SidebarTrash.js`, `src/router/useResolveEntity.js`, `src/router/EntityRoute.js`, `src/hooks/documentTrashInvalidation.js`, and `src/hooks/rowInvalidation.js`.

**Solution.** Keep `Cortext\Documents` as the cross-type reader, then move shared document behavior behind it one piece at a time: URL targets, invalidation, activity/recents, favorites, and trash refresh. Individual records can still use `core-data` or row endpoints where WordPress models them well. Cross-type views can stay under `/cortext/v1/documents`; shared document features should not rebuild the same page/row branching every time.

## 49. DataViews has no row reorder API `[upstream]`

**What.** Manual order lives on the row posts, but DataViews doesn't give us row refs, drag handles, drop targets, or an `onReorder` hook. Cortext has to decorate the layouts after DataViews renders them: find rows by internal class selectors, match them to `rows` by visible index, portal dnd-kit handles into the first data cell, place fixed drop targets over row gaps, clone a few cells for the drag preview, and hold CSS transforms while the REST request and refetch finish.

That makes row reorder sensitive to DataViews DOM changes: density classes, bulk-selection cells, fullscreen mode, block embedding, and scroll containers all matter. Grid still uses before/after card targets because a linear row gap doesn't map cleanly to a two-dimensional card layout. Fine for v1, but it is one more reason this belongs in a DataViews API instead of a DOM adapter.

**Where.** `src/components/DataViewRowReorder.js`, `src/components/RowDragHandle.js`, the mount in `src/components/CollectionDataViews.js`, and the row-reorder rules in `src/index.scss`.

**Solution.** DataViews could expose stable row ids/refs, a row-handle render prop, keyboard-aware reorder callbacks, a table/list gap model, and row preview/drop indicator hooks. Cortext would keep the REST/manual-order policy and drop the selectors, MutationObserver, portals, and transform bookkeeping.

## 50. Public page layout doesn't use WordPress align classes `[internal]`

**What.** The public template constrains non-block content to 650 px via a blanket `max-width` on `.cortext-public-page__body > :not(.wp-block-cortext-data-view)`. The data-view block breaks out of that constraint by virtue of the exclusion. This is fragile — it doesn't honor `alignwide`, `alignfull`, or any other block alignment, and will break for other wide blocks. The proper fix is to adopt WordPress's `align*` layout classes and `theme.json` content/wide widths so blocks opt into breakout with standard markup rather than CSS exclusions.

**Where.** `src/frontend.scss`, the `.cortext-public-page__body` rule with the FIXME comment.

**Solution.** Use `wp_get_layout_style` or emit the `is-layout-constrained` class with `contentSize` / `wideSize` on the body wrapper, then add `alignwide` or `alignfull` to the data-view block's wrapper attributes in `DataView.php`. Remove the exclusion hack.

## 51. DataView block shares a frontend bundle with page chrome `[internal]`

**What.** The `cortext-frontend` script and style handle serves double duty: it hydrates the DataView block (React, DataViews, field renderers) and provides general page chrome (body font, content column, title styles). Both `Assets.php` and the render callback in `DataView.php` enqueue the same handle, creating a registration race where the first caller's dependency list wins and the second is silently ignored. The DataView block should provision its own script and style (e.g. `cortext-data-view-view`) via `viewScript`/`viewStyle` in `block.json` or its own dedicated handles in the render callback, so its dependencies (`wp-components`, `wp-api-fetch`, etc.) are self-contained. `cortext-frontend`, if it makes sense to exist, should only cover general concerns: page chrome, light/dark mode toggle, etc.

**Where.** `includes/Block/DataView.php` (render callback enqueue), `includes/Frontend/Assets.php` (page-level enqueue), `src/frontend.js` (single entry point for both concerns).

**Solution.** Split `src/frontend.js` into two entry points: one for page chrome (`cortext-frontend`) and one for the DataView block (`cortext-data-view-view`). The block entry handles hydration and declares its own dependencies. The page entry stays minimal. Update `webpack.config.js` with the new entry point, and update `DataView.php` to enqueue the block-specific handle.

## 51. DataViews selection is page-local `[upstream, internal]`

**What.** DataViews accepts a controlled `selection`, but layouts only receive the IDs for rows in the current `data` array. Its built-in clicks are page-local too: table rows handle plain and modifier clicks, grid cards handle modifier clicks, and neither layout gives us shift-range selection across the rendered page. Cortext needs selected row IDs to survive pagination. It also needs the selected row objects later for bulk Trash actions and partial-failure cleanup.

`CollectionDataViews` keeps the real selection state: selected IDs, a cache of selected row objects seen on previous pages, a shift-click anchor, and a capture-phase click-intent layer. That layer translates DataViews' visible-page selection changes into Cortext's persistent selection. The pure helpers in `dataViewSelection.js` keep the merge behavior testable. This works, but it is tied to DataViews layout class names and event order.

**Where.** Selection state and `captureSelectionIntent` in `src/components/CollectionDataViews.js`, helper functions in `src/components/dataViewSelection.js`, and coverage in `tests/js/components/dataViewSelection.test.js` plus `tests/e2e/specs/data-view-block.spec.js`.

**Solution.** DataViews could treat selection as a persistent ID set, with range selection and consistent modifier behavior across table and grid. It should not filter hidden IDs out of the controlled value before handing it to layouts. Bulk actions also need either all selected items, or an item resolver for selected IDs that are not on the current page. With that, Cortext can drop the row cache, click-intent capture, and most of `dataViewSelection.js`.

## 52. Bulk row trash fans out through per-row REST calls `[internal, soft]`

**What.** Bulk row trash still calls the same row REST delete endpoint as the single-row action. The client sends one `DELETE /wp/v2/<row post type>/<id>` request per selected row, capped at four concurrent requests by `allSettledWithConcurrency`. That cap keeps a large selection from flooding the server, and the `Promise.allSettled`-style result list keeps partial failures easy to handle.

That is acceptable for the current DataView scale. It is not a real bulk operation, though. Moving 100 rows to Trash still means 100 REST writes, just in a small queue. There is no atomic all-or-nothing behavior, no server-side progress state, and no way to resume if the browser goes away mid-run.

**Where.** `requestDeleteRows` in `src/components/CollectionDataViews.js`, the queue helper in `src/components/allSettledWithConcurrency.js`, and coverage in `tests/js/components/allSettledWithConcurrency.test.js`.

**Solution.** If collections start moving large row sets to Trash, add a collection-row bulk trash endpoint or an async job endpoint with progress polling. That endpoint should own permission checks, trash order, partial-failure reporting, and cleanup. Then the DataView action can send selected IDs once instead of managing a client-side queue.
