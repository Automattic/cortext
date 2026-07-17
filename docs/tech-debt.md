# Tech debt and upstream gaps

A running log of the workarounds in this codebase. Most are here because a primitive is missing in WordPress core or Gutenberg rather than because we cut corners.

The doc has two sections. **Upstream opportunities** are gaps in Gutenberg, WordPress, or supporting libraries; if upstream fills them, the corresponding plugin code disappears. **Internal debt** is work we own to schedule.

Each entry has a stable slug anchor (`td-…`). Code that works around an entry tags itself with `tech-debt.md#td-slug`, so `grep -r 'tech-debt.md#td-row-sort-split' src/` lights up every spot affected. Entries follow **What** (the problem), **Where** (the load-bearing code), and **Solution** (how this gets cleaner).

Pair with [decisions.md](decisions.md) for choices we've made peace with and [roadmap.md](roadmap.md) for net-new product work.

---

## Upstream opportunities

### DataViews and field views

<a id="td-dataviews-inline-editing"></a>

**DataViews has no inline cell editing.**

**What.** DataViews v17 can render values and edit them through a separate `DataForm`, but it cannot turn a rendered value into an inline editor. Cortext mounts its own editor from `field.render` (documented as a display renderer, but the only hook available), keeps edit state per cell, and sends saves through `RowMutationContext` because `field.render` only receives `{ item }`. Tab and Shift+Tab live in the same layer: editors catch Tab, ask the parent for the next editable cell through `requestNext`, and the target cell opens through the same `editRequest` channel used to focus the title cell in a fresh row. Table, grid, and list use that surface when a visible field supports it.

DataViews renders an actual `<table>`; Cortext switches it to `table-layout: fixed` so resize widths behave as real column constraints, renders the display shell, and overlays the editor on top via `position: absolute` so the table only sees the display state while the editor is open. The shell's `min-height` is pinned to 40px to match `__next40pxDefaultSize`, the height of TextControl/NumberControl/SelectControl with the modern WP size flag. DataViews paints row height via the td's `padding-block`, varied per density; the shell zeroes that padding and replicates the per-density row heights via `min-height` overrides so the hover/edit highlight covers the row edge to edge. Balanced and comfortable mirror DataViews 17 (12 / 16); compact is intentionally tighter than upstream (4 → 0) to match the 40px editor floor, and compact is the default in `createDefaultView` and `DEFAULT_LAYOUTS`.

**Where.** `src/components/EditableCell.js`, `RowMutationContext` and `requestNext` in `src/components/CollectionDataViews.js`, plus the `.cortext-editable-cell`, `.cortext-cell-checkbox`, and `.cortext-data-view .dataviews-view-table` rules in `src/components/CollectionDataViews.scss`.

**Solution.** An `editable` mode on DataViews layouts that uses each field's `Edit` per value, an `onSaveItem(item, changes)` prop on `<DataViews>`, native cell-to-cell keyboard navigation where the layout supports it, and a documented path for controls rendered inline. That would remove `RowMutationContext`, `requestNext`, most of `EditableCell`, and the overlay / height pin / density mirror.

<a id="td-dataviews-multiselect-control"></a>

**DataViews cannot manage Cortext options from its array control.**

**What.** DataViews v17 renders arrays with `FormTokenField`. Cortext uses the same option picker for Select and Multiselect so users can create, recolor, rename, delete, and migrate options from a cell. The built-in array control has no hooks for that workflow, so every multiselect cell still uses a custom editor.

**Where.** `src/components/MultiselectEdit.js`.

**Solution.** Add hooks for custom option rendering and option management to the array control, or add a `multiselect` control that DataForm and a future inline-edit mode can resolve from `Edit: 'multiselect'`.

<a id="td-dataviews-layout-slots"></a>

**DataViews has no layout extension slots (append rows or footer).**

**What.** DataViews owns layout markup but exposes no place to add content. Cortext needs two slots.

The first is an append row at the bottom of a layout for the "+ New" affordance. Table and list use a Cortext footer mounted just outside `<DataViews>`, with a CSS layer that works around DataViews' default `height: 100%`. Grid is trickier: the button needs to sit with the cards, so Cortext finds the last rendered `.dataviews-view-grid__row` and portals a grid cell into it. Empty grid views fall back to a local grid shell until DataViews renders a real grid row.

The second is a footer row for column summaries and table-level bulk actions. The calculation footer has to find the rendered `.dataviews-view-table`, watch for it with a `MutationObserver`, and portal a `<tfoot>` into the table after DataViews renders. Table bulk-action controls share that footer row so selected-row controls and column summaries sit on one line. Calculations also need rows after search/filter but before pagination, which DataViews does not hand back; Cortext runs DataViews' `filterSortAndPaginate` helper a second time with `page` and `perPage` removed.

**Where.** `DataViewNewRowButton` in `src/components/DataViewNewRowButton.js`, `GridNewRowPortal` in `src/components/GridNewRowPortal.js`, `TableCalculationsFooter` in `src/components/TableCalculationsFooter.js`, the footer mount and second filtering pass in `src/components/CollectionDataViews.js`, and the footer / new-row-card / footer-row rules in `src/components/CollectionDataViews.scss`, `src/components/CollectionDataViews.grid.scss`, and `src/components/CollectionDataViews.list.scss`.

**Solution.** Upstream needs an append-item slot per layout (covers "+ New"), a table `renderFooter` / `renderSummaryRow` slot (covers calculations and table-level bulk actions), and a helper that returns filtered rows before pagination (covers summary computation). The internal `view.calculations` storage concern is separate; see [td-table-calculations-schema](#td-table-calculations-schema).

<a id="td-dataviews-option-color"></a>

**DataViews `Option` type has no `color`.**

**What.** DataViews's `Option` shape is `{ value, label, description? }`. Cortext's select / multiselect options can carry a `color` for chip rendering, so `color` is attached as an extra key on each element. DataViews ignores unknown keys today, but a stricter validator upstream would strip it, breaking colored chips silently.

**Where.** `elementsFromOptions` in `src/hooks/fieldMapping.js`. Read by `Chip` (`src/components/fields/Chip.js`) via `formatDisplay` in `src/components/EditableCell.js`.

**Solution.** Add `color` (or a generic decoration slot) to DataViews's `Option` type upstream.

<a id="td-dataviews-column-interactions"></a>

**DataViews table columns lack interaction extension points.**

**What.** DataViews persists table column order in `view.fields` and widths in `view.layout.styles`, but exposes no table-column interaction layer: no resize handles, min/max width contract, double-click autofit, reorder callback, drag preview, stable header/cell refs, or supported way to opt into `table-layout: fixed`. Cortext therefore portals resize and dnd-kit drag handles into DataViews-rendered `<th>` elements, snapshots header geometry during drag, mutates inline widths during resize for immediate feedback, and overrides internal table/cell wrapper CSS so narrow columns behave as hard constraints rather than intrinsic-size hints. Double-click autofit is the trickiest piece because there is no measurement hook upstream; the workaround clones the cell into a hidden subtree that recreates every ancestor affecting layout. See the comment block in `DataViewColumnInteractions.js` for the measurement details.

**Where.** `src/components/DataViewColumnInteractions.js`, `src/components/dataViewColumns.js`, the `DataViewColumnInteractions` mount in `src/components/CollectionDataViews.js`, and the column affordance / table wrapper rules in `src/components/DataViewColumnInteractions.scss` and `src/components/CollectionDataViews.scss`.

**Solution.** DataViews table-column APIs that cover `onChangeFields`, `onChangeColumnStyle`, resize handle rendering, per-field min/max widths, double-click autofit, drag overlay/insertion affordances, and stable header/cell slots or refs. If DataViews owned that layer, Cortext could drop the portal/DOM-query adapter, the wrapper min-width overrides, most of the dnd-kit column glue, the cloned-measurement gymnastics, and the direct DOM mutation used for live resize feedback.

<a id="td-dataviews-header-extension-slots"></a>

**DataViews has no per-column header extension slots.**

**What.** DataViews' column-header dropdown (Sort / Add filter / Move / Hide) is a closed list: no `field.menuItems` hook for Rename / Duplicate / Delete or Calculate, and no header accessory slot for the field-description help icon. To keep one dropdown per column, Cortext hides DataViews' built-in trigger on custom-field `<th>`s via CSS and portals its own combined trigger in (Sort / Move / Hide _plus_ field management and table calculations). Custom field descriptions add a small help trigger next to that replacement header trigger. Title and system fields keep the built-in trigger. The drag-handle click-forward (`DataViewColumnInteractions`) iterates header buttons and skips `display: none` ones via `offsetParent`, so it lands on whichever trigger is visible. Filter is intentionally absent: Cortext doesn't surface column-level filters in the header.

**Where.** `src/components/fields/ColumnHeaderActions.js` (table-only items and the header portal), `src/components/fields/FieldActionsMenu.js` (shared field actions and description help trigger), `src/components/fields/ColumnHeaderActions.scss` (custom header layout and help-trigger z-index), `src/components/CollectionDataViews.scss` (`.dataviews-view-table th:has(.cortext-column-header-marker) > .dataviews-view-table-header-button { display: none }`), and `src/components/DataViewColumnInteractions.js` (visible-button click forward).

**Solution.** Two header extension points: a `field.menuItems` array or render prop appended to the built-in dropdown, plus a header accessory/help slot rendered next to the label. Other consumers (Pattern Manager, Pages, Site Editor) would benefit too.

<a id="td-dataviews-actions-column-piggyback"></a>

**Add-field header piggybacks on the DataViews actions column.**

**What.** The table's `+ add field` button sits in DataViews' row-actions column header. `ColumnHeaderActions` finds `th.dataviews-view-table__actions-column` and portals the button there; CSS hides the built-in "Actions" label and keeps the header cell sticky on the right. The old synthetic `__add_field` column leaked into `view.fields`. Using the actions column avoids that, but still depends on DataViews internals. The create-field flow also reveals the new trailing column itself: it carries the created field ID back to `CollectionDataViews`, waits until the field marker exists in the rendered header, then scrolls `.dataviews-layout__container` to the right edge.

**Where.** `src/components/fields/ColumnHeaderActions.js` (actions-column lookup and portal), `src/components/CollectionDataViews.js` and `src/components/dataViewScroll.js` (created-field reveal and layout scroll), `src/components/CollectionDataViews.scss` (`.dataviews-view-table__actions-column` overrides), and the legacy `__add_field` cleanup in `src/components/CollectionDataViews.js`.

**Solution.** A trailing table-header slot, an add-column slot, or a header action area separate from per-row actions, plus refs for the table scroll wrapper and rendered headers. Then the portal targets a real extension point, the reveal code stops querying DataViews DOM, and the sticky/header-label CSS disappears.

<a id="td-dataviews-table-layout-overrides"></a>

**Table layout overrides couple to DataViews internals.**

**What.** DataViews ships `table-layout: auto; width: 100%` plus per-cell padding rules. Cortext flips to `table-layout: fixed; width: max-content` with explicit per-cell widths so adding or removing a field doesn't reflow every other column. The actions-column header override keeps the add-field button pinned beside the row kebabs. The table sizes to its content and scrolls horizontally on overflow. Depends on DataViews' class names and selector specificity staying put.

**Where.** `src/components/CollectionDataViews.scss`, around the `.dataviews-view-table` block.

**Solution.** A `tableLayout` (or similar) prop on DataViews so consumers can pick between "auto with redistribution" and "fixed with content-sized columns", plus per-field `width` hints so columns can be pinned without overriding DataViews CSS.

<a id="td-dataviews-query-capability-contract"></a>

**DataViews has no query-capability contract for custom field types.**

**What.** Each Cortext field type advertises its sortable / filterable / text-like / storage-type / supported-operators contract via `FieldTypeRegistry`, a local stand-in. WordPress post meta and DataViews each know part of that story, but neither exposes the whole contract for custom field types today. The client uses the registry to decide whether a sort or filter can go to the server; PHP validates the same contract from the collection schema. Mirroring the contract in both places is fragile and falls back to client mode whenever the answer is "no" (see [td-row-sort-split](#td-row-sort-split) and [td-row-filter-split](#td-row-filter-split) for the consequences).

**Where.** `FieldTypeRegistry` in `src/hooks/`, `serverFilterNode` / `buildQueryPlan` in `src/hooks/useCollectionRows.js`, and `RowsFilterQuery::validate_sort()` / `validate_filter_fields` in `includes/Rest/RowsFilterQuery.php`.

**Solution.** A first-class query-capability contract for custom fields, either on DataViews directly or on WordPress post meta. Custom types would declare sortable / filterable operators once; consumers (DataViews, REST) would consume that declaration without each consumer re-mirroring the contract.

<a id="td-dataviews-relation-primitive"></a>

**DataViews has no relation/reference field primitive.**

**What.** Relation fields store row post IDs, but the UI behaves like a reference field: search rows in another collection, pick one or many, create a missing row, show row chips, and open the row from the chip. DataViews has no `relation` / `reference` field type and DataForm has no async record picker that accepts a target entity/query and cardinality. Cortext maps relations to the closest DataViews metadata type, carries relation-specific metadata on the field object, renders relation chips from `field.render`, ships a custom picker that pages and searches `/cortext/v1/rows`, and routes chip clicks through its own peek state. The picker also asks REST to put exact title matches on the first page, so "Create row" does not offer a duplicate just because the match would otherwise sit later in the results.

**Where.** `mapField` / `buildRender` in `src/hooks/fieldMapping.js`, `src/components/relations/RelationEditor.js`, `src/components/RowProperties.js`, `src/hooks/useCollectionRowsByIds.js`, `RowsController`'s `include` handling, `RowsFilterQuery::apply_search_order_clauses()`, `src/components/relations/RelationReferences.js`, `src/components/relations/relationUtils.js`, `src/components/DocumentPeekProvider.js`, `src/components/DocumentPeekHost.js`, `src/components/CurrentViewModeContext.js`, relation setup in `src/components/fields/AddFieldPopover.js`, and the `.cortext-relation-*` rules in `src/components/CollectionDataViews.scss` and `src/components/RowDetailView.scss`.

**Solution.** A generic reference field/control in DataViews/DataForm: target entity config, single vs multi cardinality, async search with a selected-record resolver, optional create-new button, token/chip rendering hooks, and a supported action slot for opening or navigating to referenced records. Cortext would still own the backend relation sync and reverse-field semantics, but could drop most of the custom picker, chip, search-order guard, and open-action code.

<a id="td-dataviews-row-reorder"></a>

**DataViews has no row reorder API.**

**What.** Manual order lives on the row posts, but DataViews doesn't give row refs, drag handles, drop targets, or an `onReorder` hook. Cortext decorates the layouts after DataViews renders them: finds rows by internal class selectors, matches them to `rows` by visible index, portals dnd-kit handles into the first table or list data cell, and uses the grid card itself as the drag activator. It places fixed drop targets over row gaps, clones part of each row or card for the drag preview, and holds CSS transforms while the REST request and refetch finish.

That makes row reorder sensitive to DataViews DOM changes: density classes, bulk-selection cells, fullscreen mode, block embedding, and scroll containers all matter. Grid still uses before/after card targets because a linear row gap doesn't map cleanly to a two-dimensional card layout.

**Where.** `src/components/DataViewRowReorder.js`, `src/components/RowDragHandle.js`, the mount in `src/components/CollectionDataViews.js`, and the row-reorder rules in `src/components/DataViewRowReorder.scss`.

**Solution.** Stable row ids/refs, a row-handle render prop, keyboard-aware reorder callbacks, a table/list gap model, and row preview/drop indicator hooks. Cortext would keep the REST/manual-order policy and drop the selectors, MutationObserver, portals, and transform bookkeeping.

<a id="td-dataviews-selection-page-local"></a>

**DataViews selection is page-local.**

**What.** DataViews accepts a controlled `selection`, but layouts only receive the IDs for rows in the current `data` array. Its built-in clicks are page-local too: table rows handle plain and modifier clicks, grid cards handle modifier clicks, and neither layout gives consumers shift-range selection across the rendered page. Cortext needs selected row IDs to survive pagination and needs the selected row objects later for bulk Trash actions and partial-failure cleanup. `CollectionDataViews` keeps the real selection state: selected IDs, a cache of selected row objects seen on previous pages, a shift-click anchor, and a capture-phase click-intent layer that translates DataViews' visible-page selection changes into Cortext's persistent selection.

**Where.** Selection state and `captureSelectionIntent` in `src/components/CollectionDataViews.js`, helper functions in `src/components/dataViewSelection.js`, and coverage in `tests/js/components/dataViewSelection.test.js` plus `tests/e2e/specs/data-view-block.spec.js`.

**Solution.** DataViews treats selection as a persistent ID set, with range selection and consistent modifier behavior across table and grid, and does not filter hidden IDs out of the controlled value before handing it to layouts. Bulk actions also need either all selected items, or an item resolver for selected IDs that are not on the current page.

<a id="td-dataviews-loading-skeletons"></a>

**Loading skeletons track DataViews layouts by hand.**

**What.** DataViews has no loading slot for individual layouts. Cortext renders `CollectionRowsSkeleton` beside `<DataViews>` while the first page loads; without it, the collection pane collapses and jumps when rows arrive. The placeholder has table/list row variants and a grid card variant, so switching layouts does not briefly show the wrong shape. The brittle part is sizing: the table/list skeleton copies DataViews row heights for compact, balanced, and comfortable density. The grid skeleton has its own card size and gap, so it can drift from the real grid when DataViews changes its markup or the user changes density.

**Where.** `CollectionRowsSkeleton` in `src/components/Skeleton.js`, the rows-skeleton mount in `src/components/CollectionDataViews.js`, and the `.cortext-collection-skeleton` / `.cortext-data-view__rows-skeleton` rules in `src/components/Skeleton.scss` and `src/components/CollectionDataViews.scss`.

**Solution.** A loading slot per layout, or at least row/card size CSS variables. Cortext could then follow the active layout instead of copying its constants.

<a id="td-dataviews-view-state-shape"></a>

**DataViews view state has one active layout shape.**

**What.** DataViews emits one active `view` shape: one `type`, one `fields` array, and one `layout` object. Cortext needs layout switches to preserve table columns, grid/list display fields, density, card media settings, and query state without one layout overwriting another. The adapter stores Cortext-owned buckets (`layoutByType` and `fieldsByType`) beside the DataViews view, hydrates the active layout before render, and merges DataViews changes back into the canonical view after each change. Block attributes and public DataViews state now carry keys upstream does not know about. When a new layout setting is added, the adapter, normalizer, and public renderer all need to move together.

**Where.** `src/components/dataViewAdapter.js`, `src/components/dataViewViewState.js`, `normalizeView` in `src/components/dataViewColumns.js`, the DataViews mounts in `src/components/CollectionDataViews.js` and `src/components/PublicDataView.js`, and the data-view block attributes in `src/blocks/data-view/block.json`.

**Solution.** Native per-layout settings on DataViews would let Cortext map to upstream's shape instead of carrying separate buckets.

<a id="td-dataviews-grid-density"></a>

**Grid column count ignores density and padding.**

**What.** DataViews v17 calculates the grid's column count with a fixed 32px gap and the container's outer width. The rendered gap is 16px, 24px, or 32px depending on density, and the cards sit inside a padded content area. Near a breakpoint, DataViews can pick the wrong number of columns: rows either leave room for another card or squeeze cards below the selected preview size. Cortext keeps the native density control and saves its value, so it inherits this mismatch.

**Where.** `useGridColumns` in DataViews' grid preview-size picker calculates the count. Cortext stores the setting in `layoutForGridDataViews` in `src/components/dataViewAdapter.js` and lets DataViews render the corresponding gap.

**Solution.** DataViews should calculate columns from the content width and the rendered gap.

<a id="td-dataviews-list-row-hooks"></a>

**DataViews list lacks row-open and compact metadata hooks.**

**What.** DataViews list is close enough to use, but it does not expose the pieces Cortext needs for the list it wants: opening a row from the blank part of the row, keeping focus without a selected-row state, showing metadata as a compact inline run, and placing "+ New" as the last row. Cortext keeps the native layout and fills those gaps locally: empty controlled selection, capture-phase pointer and keyboard handlers for row open, CSS that reshapes DataViews' title/media/field/action DOM, and a footer button styled like a row. The parts to watch are the `.dataviews-view-list > [role="row"]` lookup, `.dataviews-view-list__item` as the focus/open target, and the CSS grid/contents overrides that put title, metadata, media, and actions on one row.

**Where.** List open/focus handling in `src/components/CollectionDataViews.js`, list row lookup in `src/components/dataViewItemLookup.js`, list reorder decoration in `src/components/DataViewRowReorder.js`, `DataViewNewRowButton`'s `list-row` presentation, and the list rules in `src/components/CollectionDataViews.list.scss`.

**Solution.** Row activation/focus hooks, a way to disable selected-row state without losing focus, a compact metadata list variant, and an append-row/item slot. If the native list never grows that shape, write a small Cortext list layout instead of piling more CSS on DataViews internals.

### WordPress components

<a id="td-checkboxcontrol-hide-label"></a>

**`CheckboxControl` ignores `hideLabelFromVision`.**

**What.** `CheckboxControl` always renders its `label` prop as a visible `<label>` next to the input regardless of `hideLabelFromVision` (verified against `node_modules/@wordpress/components/build-module/checkbox-control/index.mjs`). DataViews columns already show the field label in the header, so passing `label={ label }` echoed it next to every checkbox. Cortext passes `aria-label={ label }` instead, which the component forwards to the underlying input. Screen readers still get a label; sighted users no longer see it twice. Risk: the next contributor reaches for `label` (the documented prop) and the duplicate quietly returns.

**Where.** Checkbox cell in `src/components/EditableCell.js`.

**Solution.** Honor `hideLabelFromVision` on `CheckboxControl`. The `tech-debt.md#td-checkboxcontrol-hide-label` comment next to `aria-label` is the signal until then.

<a id="td-textcontrol-row-height"></a>

**Sidebar rename input pinned via WP component internals.**

**What.** The page-row rename uses `<TextControl size="compact" __next40pxDefaultSize>`, which should produce a 32px input matching the 32px row. It doesn't, on its own: the wrapping `BaseControl > field > InputControl > container` chain still contributes vertical space, so opening rename used to bump the row a few pixels. The fix pins `height` / `min-height` / `max-height` to `$grid-unit-40` and zeroes `padding-block` on every layer in that chain (`.components-base-control`, `.components-base-control__field`, `.components-input-control`, `.components-input-control__container`, `.components-input-control__input`). It works, but it couples Cortext to WP component-internal class names. If WP refactors `TextControl` (renames a class, drops a wrapper, restructures the DOM), the input loses its height pin and the row starts bumping again, silently.

**Where.** The `&__rename` block in `src/components/Sidebar.scss`. The e2e test `keeps the rename input inside the page row height` in `tests/e2e/specs/sidebar-layout.spec.js` is the tripwire: it asserts the input never overflows the row's bounding rect, so a WP-internals refactor would surface there before reaching production.

**Solution.** Either a "fit-the-row" size for `TextControl` (or a CSS variable hook for input height), or replace the rename `TextControl` with a plain `<input>` styled to match the row. The plain input is the more reliable path: drops the WP-internals coupling, but adds a small amount of styling and accessibility plumbing that comes free today.

<a id="td-wp-menu-popover-limitations"></a>

**`@wordpress/components` Menu and Popover are missing primitives.**

**What.** Several gaps in `Menu` (privateApis, Ariakit underneath) and `Popover` push policy into consumers.

-   `Menu`'s outside-click is scoped to one document. The `cortext/data-view` block and row properties render inside Gutenberg's editor iframe, so clicks on the editor sidebar or top toolbar never reach Ariakit. Cortext adds a `mousedown` listener on `window.parent.document` while the menu is open.
-   `Menu.Item` has no destructive variant. The legacy `MenuItem` accepted `isDestructive` and rendered the row in red; the new privateApis `Menu.Item` dropped that prop without a replacement (verified in `node_modules/@wordpress/components/build-types/menu/types.d.ts` against `ItemProps`). Cortext paints the red itself with a className and one CSS rule, scoped to inactive rows so focus/hover overrides it.
-   `Menu.Popover` does not portal by default. Inside a `<th>` with `text-transform: uppercase`, that cascades into the menu items. Cortext passes `portal` explicitly everywhere.
-   Submenus only accept menu primitives. `Menu.SubmenuTriggerItem` opens a `Menu.Popover` that only accepts `Menu.Item` / `Menu.Group` / `Menu.Separator` children. Cortext's Edit field and Calculate submenus have tile previews, labelled value rows, and nested popovers, so they stay as sibling popovers with a manual hover bridge. The parent menu ignores outside-clicks that land in `.cortext-format-submenu`, `.cortext-format-submenu__flyout`, or `.cortext-table-calculation-submenu`.
-   Nested `Popover` outside-clicks do not close the host. `Popover` handles outside clicks one popover at a time. In the option editor, after a color edit the first click outside both popovers only closed the small option menu; the main picker stayed open. Cortext listens for `pointerdown` while the option menu is open and asks the host to close when the click lands outside both popovers.
-   Cascading `Popover` has no fallback placement. `Popover` can shift a submenu along the cross axis but does not try a left-side fallback when a `right-start` cascade runs past the viewport edge. Cortext measures the outer menu and the portaled submenu and switches between `right-start`, `left-start`, and `bottom-start` based on clip detection.

**Where.** `src/components/fields/FieldActionsMenu.js` (outside-click document listener, portal opt-in, hover bridge), `src/components/fields/ColumnHeaderActions.js` and `src/components/fields/ColumnHeaderActions.scss` (destructive item class and rule), `FieldFormatPopover` and `TableCalculationMenu` (sibling submenus and outside-click guards), `useSubmenuPlacement` in `src/hooks/useSubmenuPlacement.js`, and `EditOptionsPopover` in `src/components/fields/EditOptionsPopover.js` (nested popover dismiss).

**Solution.** Each of these is a small PR on its own: register extra documents for outside-click detection (or have the WP wrapper do it), add `isDestructive` (or `variant: 'destructive'`) to `Menu.Item`, flip the `Menu.Popover` portal default, allow arbitrary content in submenu popovers, expose a parent/child dismissal story on `Popover`, and pass enough Floating UI middleware through `Popover` for consumers to declare placement fallbacks.

<a id="td-wp-meta-query-compares"></a>

**`WP_Meta_Query` is missing compares row filtering needs.**

**What.** `RowsMetaQuery` keeps row filters on WordPress's native meta-query tree instead of building a parallel SQL compiler, but core's compares do not cover every operator Cortext needs. `LIKE` always wraps both sides, so starts-with and ends-with need one-sided patterns. Multi-value fields need "no meta row has this value" for `isNone` / `notContains`, which is not the same as a plain `!=` join. Title filters also live on `wp_posts.post_title`, outside post meta, so they ride through a sentinel clause.

**Where.** `RowsMetaQuery` in `includes/Rest/RowsMetaQuery.php`, called from `RowsFilterQuery::meta_query_sql()`.

**Solution.** `WP_Meta_Query` grows one-sided `LIKE` compares and value-bearing negative `NOT EXISTS` compares. A structured title-query helper in `WP_Query` would cover the title sentinel separately. `RowsMetaQuery` then shrinks back toward a thin adapter or disappears.

### Block editor and Gutenberg shell

<a id="td-gutenberg-scrollbar-select"></a>

**Block editor selects on scrollbar drag.**

**What.** Gutenberg selects a block on any `mousedown` that bubbles up to the block wrapper. Inside the data-view block, dragging the dataviews scrollbar fires a mousedown on the scrolling element and pulls a bounding box around the whole block. Gutenberg has no primitive for "this region scrolls, don't select on click." Cortext listens for `mousedown` on `.cortext-data-view` in capture phase, sniffs scrollbar-gutter clicks by geometry (target's computed `overflow-x/y` is `auto`/`scroll`, the element actually overflows, and the click landed past `clientWidth` or `clientHeight`), then `stopPropagation` so the event never reaches Gutenberg. Cell, row, and header clicks keep bubbling and select normally.

**Where.** The mousedown effect on `tableWrapperRef` in `src/components/CollectionDataViews.js`.

**Solution.** A Gutenberg API for declaring interactive scroll regions on a block (or a way to opt mousedowns out of selection per descendant). The brittleness is in browser scrollbar pseudo-element behavior; the day someone introduces an overlay-scrollbar shim or a custom scroll library, this needs rethinking.

<a id="td-workspace-notices-prefix-filter"></a>

**Workspace notices filtered by id prefix.**

**What.** Gutenberg's editor store fires off its own "Page updated" snackbar on every successful save. Autosave runs constantly here, so that toast would never stop popping up. The workaround is a custom `SnackbarList` that only shows notices whose id starts with `cortext-`; everything else gets dropped on the floor, including any third-party plugin notice or a future first-party one we'd actually want to surface.

**Where.** `CortextSnackbars` in `src/components/Canvas.js`, paired with the `id: 'cortext-autosave-error'` we set on the autosave error notice in `src/hooks/useAutosave.js`.

**Solution.** A way to suppress the editor's default save notice, or scope notices per surface so we don't have to share a global stream. Until then, anything Cortext wants visible has to opt in with a `cortext-` id.

<a id="td-gutenberg-block-chrome-slot"></a>

**Block editor has no non-serialized before/after block chrome slot.**

**What.** Document identity actions ("Add icon" / "Add cover") are editor chrome, but the ideal visual placement is immediately before the document title inside the block canvas. Persisting an actions block put UI into post content, while portalling controls into the iframe coupled Cortext to BlockList DOM and block hover/selection behavior. The current compromise renders editor-only actions from the canvas shell, outside the persisted `BlockList`, and inserts only the real dynamic blocks (`cortext/document-icon`, `cortext/document-cover`) into content.

**Where.** `DocumentIdentityActions` and `EnsureHeaderBlocks` in `src/components/EditorBody.js`.

**Solution.** A non-serialized block chrome slot/fill, e.g. "before/after this block" keyed by `clientId`, block name, and root list. Fills would participate in editor layout and focus order but stay out of block order, list view, serialization, copy/paste, movers, undo history as content, and frontend rendering. Cortext could then render the identity actions before the root `core/post-title` without storing a fake block or querying iframe DOM.

<a id="td-command-palette-host-glue"></a>

**Command palette embedding needs host glue.**

**What.** Cortext uses `@wordpress/commands` for command registration and palette state, but the stock menu is built for wp-admin. On the Cortext screen the palette needs to be scoped to the app: keep Core's commands out, avoid a second cmd+K menu, return focus to the workspace after a command runs, and put workspace recents in their own section instead of mixing them into suggestions. That leaves some glue in Cortext: a local data registry, a `wp-core-commands` dequeue, a bundled stylesheet import, a canvas ref for focus return, and a local command-menu renderer.

The awkward bit is `CortextCommandMenu`. `@wordpress/commands` has a built-in "Recent" group, but that means recently used commands, not Cortext workspace history, and there is no public way to add a custom group. So Cortext renders the menu itself while still reading from the upstream command store. That is better than patching `node_modules` or poking the DOM after render, but upgrades need a close look at the upstream menu markup, CSS classes, keyboard behavior, and `cmdk` wiring. The user-facing placeholder is still Core's generic "Search commands and settings" string too.

**Where.** `src/components/CommandPalette.js`, `src/components/CortextCommandMenu.js`, the `canvasRef` passed from `src/router.js`, `dequeue_core_command_palette` in `includes/Admin/Screen.php`, the `@wordpress/commands` stylesheet import in `src/index.scss`, and Cortext command-menu overrides in `src/styles/global/_command-palette.scss`.

**Solution.** Make app-owned palettes less ad hoc: a scoped command registry or namespace API, a supported way for full-screen admin apps to opt out of Core's admin palette, a custom input label, an explicit focus-return target or after-close callback, and a group/section API for registered commands or command loaders. With those, Cortext keeps registering commands through `@wordpress/commands`, renders workspace recents through an upstream extension point, and drops the local menu renderer plus most of this shell-specific wiring.

<a id="td-autosave-save-completion"></a>

**Autosave has to infer save completion.**

**What.** `savePost()` gives a promise when Cortext starts the save. If a save is already running, though, Gutenberg only tells us about it through selectors like `isSavingPost()` and `didPostSaveRequestFail()`. There is no promise to await. `flushNow()` has to keep its own small list of waiters and release them when `isSaving` flips back to false.

The same selector shape affects user-visible save side effects. `didPostSaveRequestSucceed()` and `didPostSaveRequestFail()` are level signals, not one-shot events. They can stay true after the save that set them, so mounting autosave on a different row or changing `recentTarget` can otherwise replay an old success into status and Recents. The hook tracks the previous `isSaving` value and only treats success as current when this hook observed the save finish.

**Where.** `savePromiseRef`, `savingWaitersRef`, `prevIsSavingRef`, `flushNow`, and the save-status effect in `src/hooks/useAutosave.js`.

**Solution.** Gutenberg exposes the current save promise, makes `savePost()` return the in-flight promise when one already exists, or exposes per-save completion events/state keyed to a request. Then Cortext drops the waiter bookkeeping and the local `isSaving` edge detection.

<a id="td-gutenberg-header-boundary"></a>

**Block editor controls do not understand Cortext's header boundary.**

**What.** Gutenberg block locks keep cover, icon, title, and row properties from moving, but the root list still has no idea that Cortext's body starts after those blocks. Cortext repairs bad order with block-editor store actions and hides protected insertion points, but two bits of Gutenberg UI still leak through. First, the first body block gets a live "move up" button even though moving it above the title would be wrong; Cortext waits for the toolbar, finds `.block-editor-block-mover-button.is-up-button`, and sets `disabled` / `aria-disabled` itself. Second, Gutenberg only shows the default empty-body appender when the whole root list is empty. A row with title/properties and no body is not empty by that test, so Cortext supplies its own first-block prompt after the header. If Gutenberg renames mover classes or changes the appender contract, this code needs another pass.

**Where.** `HeaderPrefixToolbarGuard`, `syncHeaderBoundaryMoveUpButtons`, `HeaderAwareRootAppender`, and the header-prefix correction in `src/components/EditorBody.js`, with coverage in `tests/e2e/specs/editor-header-blocks.spec.js` and `tests/e2e/specs/data-view-block.spec.js`.

**Solution.** A block-list boundary policy for root lists: a minimum insertion index, a minimum move target, empty-body detection that ignores locked chrome, and mover/appender state from that same boundary. Then Cortext declares "body blocks start after the title/properties prefix" once and drops the toolbar DOM query, the mutation observer, the local button-state restoration, and the custom root appender.

<a id="td-row-detail-toolbar-isolation"></a>

**Row detail toolbars rely on local editor-surface isolation.**

**What.** Row peek and modal now keep their toolbars separate from the parent page editor. The fix is local and covered by e2e: each row editor gets its own `SlotFillProvider`, the row surface says it has no block inspector, and the parent page toolbar is hidden while peek/modal owns the screen. The plumbing stays in the debt log because Gutenberg's toolbar path still runs through `BlockControls`, SlotFill, and portaled popovers, and there is no clean public primitive for saying "this nested editor owns its toolbar and inspector." Cortext avoids the unsafe inspector entrypoint instead of building a row-scoped inspector in this pass.

**Where.** `src/components/RowEditor.js` (`SlotFillProvider` and `EditorSurfaceProvider`), `src/components/EditorSurfaceContext.js`, `src/blocks/data-view/edit.js` (`hasBlockInspector` around the DataView toolbar button), `src/components/RowDetailView.js` (body class while side/modal is open), and `src/styles/global/_shell-root.scss` (parent canvas toolbar hiding).

**Solution.** Editor-instance-scoped `BlockControls`, toolbar popovers, and `InspectorControls`. Cortext then drops the local `SlotFillProvider`, the `hasBlockInspector` context, and the parent-toolbar body class. If row peek/modal needs block settings before that exists upstream, build a row-scoped inspector deliberately rather than routing those actions to the parent inspector.

<a id="td-page-transitions-snapshot"></a>

**Page transitions hold a browser snapshot by hand.**

**What.** Page-to-page navigation rebuilds the editor provider inside the same workspace pane. A normal View Transition cross-fade can expose the empty editor frame while Gutenberg, cover media, and the editor iframe catch up. Cortext keeps the old `cortext-canvas` snapshot above the new one until the new editor says it has painted, then fades the old snapshot away. Import and Published also need a plain opacity fade, because Chrome's default `plus-lighter` blend washes two light panes toward white. That leaves Cortext with a `data-cortext-view-transition` mode on `:root`, custom `::view-transition-*` CSS, a long-running hold animation, and promise plumbing around `startViewTransition()` because the browser update callback may run after `withViewTransition()` has already returned.

**Where.** `withViewTransition` in `src/hooks/viewTransition.js`, the `hold-old-canvas`, `reveal-old-canvas`, and `pane-crossfade` rules in `src/styles/global/_view-transitions.scss`, pane switching in `src/router/EntityRoute.js`, document switching in `src/components/Canvas.js`, editor readiness in `src/components/EditorBody.js`, and the navigation lifecycle coverage in `tests/e2e/specs/navigation-lifecycle.spec.js`.

**Solution.** A first-class hold/release hook in the View Transitions API, or a reliable editor-surface "painted" signal from Gutenberg for document swaps. Replace the mode flag and long CSS hold animation with that primitive when it exists.

<a id="td-collection-owner-block-template"></a>

**Full-page collections need a dynamic block-template hook.**

**What.** A full-page collection needs a locked `cortext/data-view` block whose `collectionId` is the collection post's own ID. WordPress and Gutenberg can give a CPT a static template, but not one that fills attributes from the just-created post and then treats that block as the body. See [td-collection-owner-body-contract](#td-collection-owner-body-contract) for the local workarounds this gap produces.

**Where.** No code on the upstream side; the workarounds live in the internal entry linked above.

**Solution.** A dynamic block-template registration that reads attributes from the current post at insert time. Either an option on `register_post_type` (`template_callback`) or a `block-templates`-style API that supports per-post resolved attributes. With that, the post-insert seed, backfill, and editor fallback go away.

### Other libraries

<a id="td-dnd-kit-inert"></a>

**dnd-kit does not observe `inert`.**

**What.** Collapsed branches of the page tree stay mounted so the expand/collapse animation can run. The wrapper gets `inert` so focus, screen readers, and click events skip the subtree, but dnd-kit doesn't pay attention to that. It walks its registered droppables in JavaScript, asks each one for its bounding rect, and treats them as live drop targets whether anything visible is there or not. Without intervention, a drag can land on a row you cannot see. The workaround is to thread an `isHidden` prop down through `PageRow` and pass `disabled: isHidden` to every `useDroppable`. Anything else that wants this animation pattern has to do the same drilling.

**Where.** The `isHidden` prop chain through `src/components/PageRow.js`, plus the wrapper's `inert` attribute in the same file.

**Solution.** dnd-kit honors `inert` (or computed `pointer-events: none`) on an ancestor, letting consumers drop the prop-drilling. Any tree-shaped surface that uses a CSS-clipped collapse animation has to thread `disabled` through its rows itself until then.

---

## Internal debt

### Rows and storage

<a id="td-rows-not-in-core-data"></a>

**Collection row queries bypass `core-data`.**

**What.** Rows share the static `crtxt_document` post type with pages and collections, but collection views still fetch them through `/cortext/v1/rows`. That endpoint handles field-aware filters, sorting, calculations, relation hydration, and the fallback from paged server queries to bounded client-side queries. As a result, `useCollectionRows` also owns fetch state, race protection, and a manual `refresh()` counter. Mutations save the underlying document with `apiFetch`, then refresh open row queries. Trash and restore use row and document-trash events to refresh collection views and the sidebar. Relation chips add another read path through `useCollectionRowsByIds` so the picker can load selected labels without walking the collection.

**Where.** `src/hooks/useCollectionRows.js`, `src/hooks/useCollectionRowsByIds.js`, `src/hooks/rowInvalidation.js`, `src/hooks/documentTrashInvalidation.js`, and `src/hooks/useTrashedDocuments.js`, with call sites in `src/components/CollectionDataViews.js`, `src/components/RowProperties.js`, `src/components/EditableCell.js`, `src/components/SidebarTrash.js`, `src/router/EntityRoute.js`, `src/documents/actions.js`, and `src/components/relations/RelationEditor.js`.

**Solution.** Keep `/cortext/v1/rows` as the collection-query projection while it provides behavior the standard endpoint cannot express, but use `core-data` as the canonical store for individual `crtxt_document` records and writes. Row query results can prime that store or return document IDs alongside computed field data. `saveEntityRecord` can then update the shared record cache, while the collection-query cache only invalidates projections affected by that record. This would remove several local workarounds:

-   The `refresh()` handles and invalidation events exist only because rows aren't reactive.
-   Half of `RowMutationContext` (also driven by [td-dataviews-inline-editing](#td-dataviews-inline-editing)) exists because cells do not write through the shared `core-data` record.
-   `onCreated` still runs optimistic `lastPage = ceil((totalItems+1)/perPage)` arithmetic for unconstrained views. With reactive pagination Cortext could watch `totalPages` instead of guessing.
-   Relation label lookup can use the shared document records instead of a one-off include query.

The query planner, field calculations, and hydrated relation data can remain behind the row endpoint. Document identity and mutations need one owner; product queries can keep the shape they need.

<a id="td-modified-by-plugin-stored"></a>

**`_modified_by` has no current writer.**

**What.** WordPress stores when a post changed, but not who changed it. `RowsController` reads `_modified_by` when that meta exists and otherwise falls back to `post_author`. Cortext no longer writes `_modified_by` during normal document saves, so "Last edited by" usually shows the creator and can show stale legacy data.

**Where.** The row response and calculation paths in `includes/Rest/RowsController.php`.

**Solution.** If the column must identify the last editor, write `_modified_by` for authenticated `crtxt_document` saves and cover both REST and non-REST writes. Otherwise, label the value as the author instead of implying data Cortext does not have.

<a id="td-field-meta-global-delete"></a>

**Field-meta cleanup uses a global delete.**

**What.** `Field::cleanup_after_delete` calls `delete_post_meta_by_key( "field-<id>" )`, which wipes that key from every post, not just Cortext documents. A collision is unlikely because `<id>` is the globally unique ID of a `crtxt_field`, but the code does not enforce the boundary. A scoped `DELETE` joining `wp_posts` and requiring `p.post_type = 'crtxt_document'` would make that boundary explicit. WorDBless cannot execute the JOIN, so this needs a real database test rather than a mock that only appears to cover it.

**Where.** `Field::cleanup_after_delete` in `includes/PostType/Field.php`.

**Solution.** Stand up an integration environment with a real `wpdb` (`wp-env` + WP_PHPUnit), move the cleanup to a scoped JOIN, and keep WorDBless for the parts that don't need a real database.

### Row query capabilities

<a id="td-row-sort-split"></a>

**Sorting support is split between REST and client mode.**

**What.** Server sort supports scalar collection fields: title, timestamps, text-like fields, number, date/datetime, select, checkbox, email, and URL. With no explicit sort, REST uses oldest-first ordering so new rows land at the bottom of the table.

The debt is the split brain. The client has an allow-list for server-safe sorts, and `FieldTypeRegistry` / `RowsFilterQuery` own the PHP version of the same story (see [td-dataviews-query-capability-contract](#td-dataviews-query-capability-contract)). Unsupported display-value sorts fall back to client mode: fetch all pages, then let DataViews sort locally. That keeps the result honest, but it is not where sorting should live long-term.

The hard cases are still display-value sorts: users, relations, list-style rollups, files, and any field where the value users see is not the value stored in meta. That broader choice is tracked in [td-display-value-sort](#td-display-value-sort).

**Where.** The query planner and sort allow-lists in `src/hooks/useCollectionRows.js`, the `onCreated` no-sort branch in `src/components/CollectionDataViews.js`, `FieldTypeRegistry`, and `RowsFilterQuery::validate_sort()`.

**Solution.** Make REST the source of truth for sortable fields and expose that capability to the client instead of mirroring it by hand. Resolve [td-display-value-sort](#td-display-value-sort) for display-value sorts, then remove the client fallback for sorting except where DataViews really needs a local-only view state.

<a id="td-row-filter-split"></a>

**Filtering support is split between REST and client mode.**

**What.** Server-side filtering supports the documented operator set, title filters, split-term search, and nested `AND` / `OR` groups through `RowsFilterQuery` and `RowsMetaQuery`. When the server cannot handle a filter, the hook falls back to client mode, fetches all pages, applies grouped filters in a small Cortext wrapper, and lets DataViews handle the remaining flat search/sort/pagination work.

The cost is another split support matrix. The client checks field type, operator, grouping, and value shape before choosing server mode. PHP validates the same contract from the collection schema. System fields are still deferred (see [td-system-field-filtering](#td-system-field-filtering)), display-value fields are still client-only, and grouped filters only go server-side when every descendant is supported. The root cause is the missing capability contract tracked in [td-dataviews-query-capability-contract](#td-dataviews-query-capability-contract); this entry covers the internal consolidation work that follows once that lands.

**Where.** `serverFilterNode` / `buildQueryPlan` in `src/hooks/useCollectionRows.js`, `filterSortAndPaginateWithGroups` in `src/components/groupedFilters.js`, `RowsFilterQuery`, `RowsMetaQuery`, and `prefillFromFilters` in `src/components/CollectionDataViews.js`.

**Solution.** Make the server-owned capability map the only local source of truth, then shrink it if DataViews or WordPress grows a first-class query-capability contract for custom fields. System fields need the date/user handling from [td-system-field-filtering](#td-system-field-filtering), and display-value fields need dedicated query semantics instead of pretending stored meta is the UI value.

<a id="td-system-field-filtering"></a>

**System field filtering is deferred.**

**What.** Filters route through `meta_query`, but system fields (`created_at`, `modified_at`, `created_by`, `modified_by`) live on the post table or in user data, not in post meta. The filter validator rejects all four with a clean 400 rather than silently no-op'ing through the meta_query branch. Users can sort by `created_at` and `modified_at` (free WP_Query orderby) but can't filter on any system field today.

**Where.** `validate_filter_fields` and `build_query_args` in `includes/Rest/RowsController.php`.

**Solution.** Add date-range filter operators with native `date_query` for `created_at` / `modified_at`, and JOIN-to-users filtering for `created_by` / `modified_by` (paired with [td-display-value-sort](#td-display-value-sort), since the JOIN cost is shared with display-value sorting).

<a id="td-display-value-sort"></a>

**Sort on display-value properties is an open architectural decision.**

**What.** `created_by`, `modified_by`, Person-style fields, Relations, relation-backed Rollups, and Files all share the same problem: the stored value is an internal handle, while the useful sort is the displayed value. Sorting by user ID, row ID, or attachment ID is not what users mean. Sorting by display name, related-row title, filename, or a computed rollup value needs either JOINs, denormalized display values, or an in-memory pass.

Relations and list-style rollups now keep sorting disabled. Scalar rollups can sort in the client while the table has all rows loaded, but the REST query path still cannot order by computed rollup values because they are not stored as row meta. `build_query_args` falls back to the default date ordering if a rollup sort reaches the server.

**Where.** `validate_sort_field` and `build_query_args` in `includes/Rest/RowsController.php`; `enableSorting: false` for display-value fields in `systemFields` and `mapField` (`src/hooks/fieldMapping.js`).

**Solution.** Pick one model for display-value sorting: JOIN-and-sort in `build_query_args`, denormalize sortable display values into row meta, or keep fetching all rows and sort in memory. The answer should cover system user fields, Relations, Rollups, Person, and Files at the same time.

<a id="td-select-server-sort-stored"></a>

**Select server sort uses stored values, not option order.**

**What.** Server-side row sorting treats select fields as scalar stored values. That keeps `GET /cortext/v1/rows` sortable without joining or decoding option metadata, but it differs from curated option ordering.

**Where.** `RowsFilterQuery::apply_sort_clauses()` in `includes/Rest/RowsFilterQuery.php`.

**Solution.** If users expect select order to follow the field's configured options, compile select sorts into an option-order `CASE` expression generated from the field schema. Until then, document stored-value sorting as the v1 behavior.

### Public document rendering

<a id="td-public-title-double-render"></a>

**Public pages render the title twice.**

**What.** `DocumentIdentity::prepend_header_blocks` slips a locked `core/post-title` block into `post_content` on insert, so the editor canvas can show the title inline as part of the BlockList. The public template still calls `the_title()` immediately before `the_content()`, and `core/post-title` resolves to the same `post_title` again, so every page created after this filter landed renders its title twice publicly. Older pages (no title block in their content) are fine until the editor next persists them.

**Where.** `prepend_header_blocks` in `includes/PostType/DocumentIdentity.php`, paired with `the_title()` in `templates/single-crtxt_document.php`.

**Solution.** Stop baking `core/post-title` into `post_content` and mount the editor's title input as canvas chrome above `BlockCanvas`, the way Gutenberg itself does it. The template keeps `the_title()` as the single source of truth; the editor keeps an inline-editable title; pages already saved with the block get a small migration that strips it.

<a id="td-frontend-cover-icon-styles"></a>

**Frontend stylesheet doesn't carry the cover/icon rules.**

**What.** The PHP `render_callback`s emit `.cortext-document-cover-block`, `.cortext-document-icon-block`, and `.cortext-document-icon` markup on public pages, but their CSS still doesn't load there. Since the shell-style split, the admin/editor rules live in block edit partials and `DocumentIcon.scss`; `src/frontend.scss` still has none. On a public `crtxt_document`, the cover image renders at intrinsic size and the icon block falls back to inline layout.

**Where.** `src/blocks/document-cover/edit.scss`, `src/blocks/document-icon/edit.scss`, and `src/components/DocumentIcon.scss` versus `src/frontend.scss`, plus the PHP render callbacks in `includes/Editor/DocumentCoverBlock.php` and `includes/Editor/DocumentIconBlock.php`.

**Solution.** Extract the persisted cover/icon markup rules into a shared partial that both admin/editor and frontend stylesheets `@use`. Keep editor-only chrome, such as hover replace/remove controls and picker popovers, in the block edit partials.

<a id="td-wp-icon-public-blank"></a>

**WP-icon variant renders blank on the public frontend.**

**What.** `DocumentIconBlock::render` emits a marker span (`<span class="cortext-document-icon--wp" data-icon="…">`) for the `wp` icon variant and relies on a frontend hydration step to fill in the SVG. `frontend.js` is CSS-only, so nothing fills it and the icon disappears on the public page; the saved color is also dropped. Emoji and image variants render server-side and are fine.

**Where.** Case `'wp'` in `includes/Editor/DocumentIconBlock.php`, paired with `src/frontend.js` (no hydration).

**Solution.** Either ship the SVG inline server-side (a small build-time generator that reads `@wordpress/icons` and emits a name-to-markup PHP map, refreshed on install) or hydrate from `data-icon` markers in `frontend.js` (smaller PHP surface, adds a public script). The inline-color is a one-line fix in either path. Until then, surface the limitation in the picker copy or restrict the saved variant to emoji + image for public-rendered pages.

<a id="td-row-properties-public-render"></a>

**Row properties have no public render.**

**What.** Row properties live inside the block-editor iframe, between the title and body. They are a locked `cortext/document-properties` block, and `EnsureHeaderBlocks` keeps that block in place when the row's collection has fields. In the editor, the block renders `<RowProperties>` and reads `fields` from `DocumentPropertiesProvider`. The editor also owns inline layout editing, relation saves, hidden-property ordering, and the collapsed/visible state. On the PHP side the block is registered, but its `render_callback` still returns an empty string. Published rows rendered through `the_content()` therefore show body blocks only, without their schema fields.

The row-detail layout setting means public rendering cannot just print every field in schema order. PHP has to follow the same cleanup as the editor: drop stale entries, append new fields as visible, keep hidden properties hidden, and leave `title` to `core/post-title`.

**Where.** `src/blocks/document-properties/{block.json,edit.js,index.js}` defines the editor block. `includes/Editor/DocumentPropertiesBlock.php` registers it on the server with the placeholder `render_callback`. `src/components/DocumentPropertiesContext.js` passes `fields`, `allFields`, `detailLayoutEntries`, `fallbackRecord`, `rowId`, visibility state, and layout-edit requests from Canvas or RowEditor. `src/components/RowProperties.js` renders the editor-only property surface and relation controls. `src/components/EditorBody.js` (`EnsureHeaderBlocks`) inserts the block after the title when schema exists and removes it when schema disappears. `detail_layout` is registered by `Document::register_collection_meta()` in `includes/PostType/Document.php`; the editor normalizes it in `src/hooks/detailLayout.js` and threads it through `src/hooks/useCollectionFields.js`. The schema accessor is `Cortext\Rest\RowsFilterQuery::field_schema_for( $collection_id )`; field values are formatted by `RowsController::format_typed_value()`.

**Solution.** Fill in `DocumentPropertiesBlock::render()` so `the_content()` emits `<div class="cortext-document-properties">...</div>` with formatted values for rows whose collection has fields. Reuse `RowsController::format_typed_value()`, and add a small PHP normalizer for `detail_layout` so public markup follows the editor's field order and visibility. Share the same SCSS through `src/frontend.scss` so public markup matches the editor.

### Editor and workspace UX

<a id="td-data-view-block-height"></a>

**Embedded data-view block has no width/height controls.**

**What.** The `cortext/data-view` block exposes `align` (default / wide / full) for width but nothing for height. The block sizes to its content: short tables fit their rows, long tables grow with the page, and empty blocks fall back to DataViews' no-results state. That default is easy to understand, but authors still can't say "show 10 rows and scroll the rest." A long table stretches the document.

**Where.** `src/blocks/data-view/block.json` (no `height` attribute today). The block-mode size rule lives in `src/components/CollectionDataViews.scss` next to the `.wp-block-cortext-data-view .cortext-data-view > .dataviews-wrapper` override.

**Solution.** Add a `height` (or "rows visible") attribute to the block with an inspector control, and clamp the shell to that value when set. A density-aware default would help, but the per-block control is the part that matters.

<a id="td-table-calculations-schema"></a>

**Table calculations live on the DataViews view shape.**

**What.** Calculation state stays in Cortext but is attached to the DataViews view object: `view.calculations` rides along on the saved view because embedded data-view blocks already persist that object, and named saved views do not exist yet. `normalizeView` prunes stale calculation entries when fields disappear or their type changes. That keeps the saved shape honest, but it is Cortext state attached to a DataViews object that upstream knows nothing about. The upstream side of the workaround (table footer slot) is tracked in [td-dataviews-layout-slots](#td-dataviews-layout-slots); this entry covers the internal storage concern that exists independently.

**Where.** `src/components/tableCalculations.js`, calculation persistence in `src/components/dataViewColumns.js`, and the view shape declared in `src/blocks/data-view/block.json`.

**Solution.** Saved named views become their own Cortext schema, and `calculations` lives there instead of being smuggled onto `view`. Until then, keep the calculation key in `view` clearly documented as Cortext-owned so DataViews upgrades don't strip it.

<a id="td-row-properties-dnd"></a>

**Row properties editing has its own dnd layer.**

**What.** Row properties edit their layout inline. The UI has drag handles beside labels, a `Hidden properties` divider, an empty drop target for hiding properties, and a drag overlay sized to the row so relation chips wrap the same way while dragging. This cannot reuse the DataViews row reorder adapter ([td-dataviews-row-reorder](#td-dataviews-row-reorder)): it writes `detail_layout`, not table row order.

Keep this local for now, but treat it as custom drag-and-drop code. It measures the dragged row, stops stale dnd-kit state from showing on the source row, blurs the handle after drop, and special-cases the empty hidden section. Before changing row-property spacing, chip wrapping, or dnd-kit overlays, check this path instead of assuming the table behavior applies.

**Where.** `src/components/RowProperties.js` owns the `DndContext`, `DragOverlay`, hidden-property target, and layout reorder callbacks. `src/components/RowDetailView.scss` handles the drag handle, source-row hiding, overlay sizing, and hidden-drop-zone visuals. `src/blocks/document-properties/edit.js` maps the drag events into `detail_layout` saves.

**Solution.** If another surface needs the same visible/hidden property list, extract a small shared primitive. Otherwise keep the code here until Gutenberg or DataViews exposes a field-list reorder primitive with hidden items and drop zones. Then RowProperties can shrink to the `detail_layout` save policy.

<a id="td-favorites-row-shape"></a>

**Favorite rows have their own sidebar-row shape.**

**What.** Favorites look like sidebar rows, but they are not normal page-tree rows. They are shortcuts, they should never show the active selection state, and they are sortable only inside the Favorites section. Sharing the whole row as both a navigation button and a dnd-kit sortable handle made clicks repaint the hover state and feel like a flash. The current row splits those jobs: the icon is the drag handle, the title is a plain navigation button, and the star is the remove action. It works, but Favorites carry a small custom row shape alongside `PageRow` and `CollectionRow`.

**Where.** `src/components/SidebarFavorites.js`, plus the `.cortext-sidebar__favorite-*` rules in `src/components/Sidebar.scss` and `src/styles/global/_shell-root.scss`.

**Solution.** Extract a shared sidebar-row primitive with explicit slots for title navigation, drag handle, menu/actions, selected state, and shortcut-only rows. Then `PageRow`, `CollectionRow`, and `SidebarFavorites` can share the same interaction contract without reusing the wrong DOM shape for Favorites.

<a id="td-recents-call-site-wired"></a>

**Recents tracking is wired at each call site.**

**What.** There is no workspace activity layer. Each surface that counts as a visit or edit calls `touchRecent` itself: route resolution, page autosave, sidebar rename, row field save, row creation, and relation-created rows. That makes the behavior easy to understand, but future write paths can forget to update recents unless the reviewer knows to look for it.

**Where.** `src/router/EntityRoute.js`, `src/hooks/useAutosave.js`, `src/components/Sidebar.js`, `src/components/CollectionDataViews.js`, and `src/components/relations/RelationEditor.js`.

**Solution.** If more activity surfaces appear, move this behind a small workspace activity helper or event. Route visits can stay in the router, but writes should eventually report through the same mutation path instead of each component remembering to call `touchRecent`. If rows move into `core-data` ([td-rows-not-in-core-data](#td-rows-not-in-core-data)), that would be a natural time to centralize row touches too.

<a id="td-document-layer-thin"></a>

**Cortext document layer is still thin.**

**What.** Pages, full-page collections, and rows all opt into `cortext-document`. The shared reader (`Cortext\Documents`, `GET /cortext/v1/documents`, `useDocuments`) now gives trash, document lists, and recents the same shape instead of making each screen rebuild its own version. The layer is still thin: pages use the page tree and `core-data`; full-page collections mount in Canvas, but keep `collection/` URLs and collection-shaped recents; rows still use `useCollectionRows`. Restore/delete still fan out through page-tree refresh, row invalidation, collection context refresh, and Trash refresh. Favorites and recents use the document service for row paths, but routing, URL targets, and activity tracking still ask "page, collection, or row?" where they should only need "document." Relation chips open row documents, but still depend on local row URL helpers (`rowRoute` / `rowHref`) and `slug` in relation responses.

**Where.** `includes/Documents.php`, `includes/PostType/Document.php`, `includes/Rest/DocumentsController.php`, `includes/Rest/RecentsController.php`, relation slug hydration and row `kind` output in `includes/Rest/RowsController.php`, `src/components/Canvas.js`, `src/documents/favorites.js`, `useFavoriteToggle` in `src/documents/hooks.js`, `src/hooks/useDocuments.js`, `src/hooks/useTrashedDocuments.js`, `src/components/SidebarTrash.js`, `src/router/useResolveEntity.js`, `src/router/EntityRoute.js`, `src/router/entityRouteReducer.js`, `rowRoute` / `rowHref` in `src/components/relations/relationUtils.js`, `src/hooks/documentTrashInvalidation.js`, and `src/hooks/rowInvalidation.js`.

**Solution.** Keep `Cortext\Documents` as the cross-type reader, then move shared document behavior behind it one piece at a time: URL targets, invalidation, activity/recents, and trash refresh. Individual records can still use `core-data` or row endpoints where WordPress models them well. Cross-type views can stay under `/cortext/v1/documents`; shared document features should not rebuild the same page/row branching every time.

<a id="td-frontend-bundle-split"></a>

**DataView block shares a frontend bundle with page chrome.**

**What.** The `cortext-frontend` script and style handle serves double duty: it hydrates the DataView block (React, DataViews, field renderers) and provides general page chrome (body font, content column, title styles). Both `Assets.php` and the render callback in `DataView.php` enqueue the same handle, creating a registration race where the first caller's dependency list wins and the second is silently ignored. The DataView block should provision its own script and style (e.g. `cortext-data-view-view`) via `viewScript`/`viewStyle` in `block.json` or its own dedicated handles in the render callback, so its dependencies (`wp-components`, `wp-api-fetch`, etc.) are self-contained. `cortext-frontend`, if it makes sense to exist, should only cover general concerns: page chrome, light/dark mode toggle, etc.

**Where.** `includes/Block/DataView.php` (render callback enqueue), `includes/Frontend/Assets.php` (page-level enqueue), `src/frontend.js` (single entry point for both concerns).

**Solution.** Split `src/frontend.js` into two entry points: one for page chrome (`cortext-frontend`) and one for the DataView block (`cortext-data-view-view`). The block entry handles hydration and declares its own dependencies. The page entry stays minimal. Update `webpack.config.js` with the new entry point, and update `DataView.php` to enqueue the block-specific handle.

<a id="td-bulk-row-trash-fanout"></a>

**Bulk row trash fans out through per-row REST calls.**

**What.** Bulk row trash still calls the same document REST delete endpoint as the single-row action. The client sends one `DELETE /wp/v2/crtxt_documents/<id>` request per selected row, capped at four concurrent requests by `allSettledWithConcurrency`. That cap keeps a large selection from flooding the server, and the `Promise.allSettled`-style result list keeps partial failures easy to handle. It is acceptable for the current DataView scale, but not a real bulk operation: moving 100 rows to Trash still means 100 REST writes, just in a small queue. There is no atomic all-or-nothing behavior, no server-side progress state, and no way to resume if the browser goes away mid-run.

**Where.** `requestDeleteRows` in `src/components/CollectionDataViews.js`, the queue helper in `src/components/allSettledWithConcurrency.js`, and coverage in `tests/js/components/allSettledWithConcurrency.test.js`.

**Solution.** If collections start moving large row sets to Trash, add a collection-row bulk trash endpoint or an async job endpoint with progress polling. That endpoint should own permission checks, trash order, partial-failure reporting, and cleanup. Then the DataView action can send selected IDs once instead of managing a client-side queue.

<a id="td-workspace-tree-no-unified-model"></a>

**Workspace tree has no unified node model.**

**What.** The sidebar builds its workspace tree from two REST lists over the unified `crtxt_document` post type: active pages and full-page collections. The shell joins them client-side by reading `post_parent`. That works for collections under loaded pages, but row-owned collections and collections whose parent page is outside the loaded window fall back to the flat Collections section because there is no parent record to attach to. There is still no "workspace node" shape with `kind`, so every tree consumer has to branch on pages versus collections.

Drag/drop and `menu_order` accounting look at both pages and collections through `treeRecords`, a single `DndContext` now wraps both sections, and the cycle guard walks the merged node graph. The model gap that remains is shape, not wiring: every tree consumer still branches on pages versus collections to derive a `kind`, and the Collections section's contents are a UX choice on top of that. Today it shows only top-level full-page collections (`parent = 0`); nested ones live solely in the Pages tree. The unified model would let this be configurable per workspace: top-level only, all collections grouped, or per-parent sub-headers.

**Where.** `ACTIVE_PAGES_QUERY` in `src/components/page-queries.js`, `FULL_PAGE_COLLECTION_QUERY` in `src/collections.js`, `nestedCollections` / `topLevelCollections`, `treeRecords`, `handleDragOver`, and the shared `DndContext` in `src/components/Sidebar.js`, the `renderCollectionRow` bridge in `src/components/PageRow.js`, `CollectionRow`'s drag/drop zones, `computeDropTarget` in `src/components/document-tree.js`, and the `hierarchical` registration plus `post_parent` handling for `crtxt_document` on the PHP side.

**Solution.** Add a workspace-tree REST endpoint that returns navigable nodes with `kind`, `id`, `parent`, `menu_order`, and visibility in one shape. Row-owned collections could then appear under their row, missing parents would not look top-level by accident, and page/collection branching would move out of every consumer. The Collections section then becomes a view over the same model with the user's chosen filter, instead of a separate flat list.

<a id="td-collection-owner-body-contract"></a>

**Collection canvases use a self-referencing owner block.**

**What.** A full-page collection needs a locked `cortext/data-view` block whose `collectionId` is the collection post's own ID. WordPress and Gutenberg can give a CPT a static template, but not one that fills attributes from the just-created post and then treats that block as the body. Cortext works around that in a few places: PHP seeds the serialized block when a document becomes a collection, the editor adds the block if content is still empty, CSS hides body appenders and owner-block chrome, a SlotFill moves the data-view panels into the Collection tab, and the block hides "Change collection" so the owner cannot point away from itself. See [td-collection-owner-block-template](#td-collection-owner-block-template) for the upstream alternative.

**Where.** `Document::build_data_view_block_markup()` and `Document::seed_data_view_block()` in `includes/PostType/Document.php` (seeded when a document becomes a collection, via `includes/Taxonomy/TraitTaxonomy.php`), `src/components/CanvasOwnerInspector.js`, owner-block handling in `src/components/EditorBody.js`, `src/blocks/data-view/edit.js`, `src/components/PageInspectorSidebar.js`, and the owner rules in `src/styles/global/_shell-root.scss`.

**Solution.** Build a single internal body-owner contract: a Cortext primitive that takes a post and a block name, locks the body to that block, owns inserter/chrome/inspector policy, and keeps public serialization predictable. Then the post-insert seed, backfill, editor fallback, SlotFill routing, and owner CSS shrink or disappear, independently of whether upstream ever lands a dynamic block-template hook.

### Field management UX

<a id="td-field-management-panel"></a>

**Field management still needs a panel outside the table.**

**What.** Field actions live in one shared menu, but there is still no collection-level field manager. Table users get the menu from column headers. Row-detail users get it from clickable property labels. Grid and list users can manage fields only after opening a row; those layouts still have no direct "Manage fields" entry point.

**Where.** `src/components/fields/FieldActionsMenu.js` (shared field actions), `src/components/fields/ColumnHeaderActions.js` (table-header trigger), `src/components/RowProperties.js` and `src/blocks/document-properties/edit.js` (row-property labels and field snapshot context). `ColumnHeaderActions` still mounts only when `view.type === 'table'` (`src/components/CollectionDataViews.js`).

**Solution.** A toolbar "Manage fields" panel listing every custom field with per-row rename / duplicate / delete, available in every layout.

<a id="td-select-no-options-on-create"></a>

**Select / multi-select fields ship with no options.**

**What.** Add field creates the field as soon as you click a type; there is no second step for type-specific setup. For select / multi-select, the column starts with no options. Users can add options from the shared field menu, but the create flow still leaves them with an empty property first.

**Where.** `src/components/fields/AddFieldPopover.js` (no options input), plus the after-creation path in `src/components/fields/FieldActionsMenu.js` and `src/components/fields/EditOptionsPopover.js`. The REST route already accepts an `options` array; the create UI just doesn't expose it.

**Solution.** Add a setup step during field creation, or open the options editor immediately after creating a select / multi-select field. Until then, users fix empty select fields through the shared field menu.

### Schema migrations

<a id="td-collection-duplication-relations"></a>

**Collection duplication cannot clone relation schema.**

**What.** Duplicating a full-page collection creates another `crtxt_document`, gives it its own `crtxt_trait` mirror term, and copies field posts that stand on their own. It skips relations because a relation is really a pair: the forward field plus the reverse field on another collection. A safe copy has to create or update both sides, keep the cardinality, and remap IDs without touching the original relation. Until that exists, the REST response lists skipped fields and the sidebar tells the user the copy is missing columns. Rollups that read through a skipped relation belong in the same bucket; they are not useful until the copied schema has its own relation target.

**Where.** `DocumentDuplicator::duplicate()`, `clone_schema()`, and `remap_rollup_references()` in `includes/Documents/DocumentDuplicator.php`; the notice flows through `src/documents/actions.js` and `src/components/Sidebar.js`. Coverage lives in `tests/php/test-document-duplicator.php` and `tests/php/test-rest-collections.php`.

**Solution.** Add a relation-aware schema copy step. It should clone and remap the forward and reverse fields together, or skip every dependent field, including rollups that point at skipped relations. The duplicate should never carry references back to the source collection's fields. Once that exists, the sidebar notice can name the exact skipped field types instead of treating them all as generic missing columns.

### Testing infrastructure

<a id="td-wordbless-row-coverage"></a>

**WorDBless can't integration-test the rows endpoint.**

**What.** WorDBless uses `Db_Less_Wpdb`, an in-memory store where `wp_insert_post` and `get_post` work via the object cache but `WP_Query` SQL returns zero results. `InMemoryPostsQuery` now covers the simple query shapes used by document listing and page-trash cascade tests: post type, status, parent, `meta_key` / `meta_value`, search, ordering, and pagination. That keeps those tests useful, but it is still an approximation of WordPress queries, not a real database.

The rows endpoint is still the hard case. `RowsController` unit tests cover routing, permissions, validation, query-arg building, `fields[]` projection, and row formatting. Query args, projection, and formatting are checked through reflection because WorDBless cannot insert rows and then prove they come back through a real `GET /cortext/v1/rows` request. `RowsFilterQuery`, `RowsMetaQuery`, and the field-value index read path still build SQL for custom compares, grouped filters, and indexed filter/sort reads. A bad join, `meta_query` compare, title sentinel, index predicate, or projected row response could still pass here.

**Where.** `tests/php/InMemoryPostsQuery.php`, `tests/php/test-documents.php`, `tests/php/test-rest-documents-controller.php`, `tests/php/test-page-trash-cascade.php`, `tests/php/test-rest-document-trash-controller.php`, and `tests/php/test-rest-recents-controller.php`, plus the still-limited row coverage in `tests/php/test-rest-rows-controller.php` and `tests/php/test-field-value-read-query.php`.

**Solution.** Keep the in-memory shim for simple document queries, but test the row endpoint against a real `wpdb` before treating sort/filter/pagination as covered. Either add a `wp-env` + `WP_UnitTestCase` suite for rows, or rely on targeted e2e coverage in `tests/e2e/specs/data-view-block.spec.js` until that suite exists. Once real database coverage exists, the shim should stay limited to tests that only need cheap post lookup behavior.

### Universal document model follow-ups

<a id="td-relation-sidecar-reindex-per-target"></a>

**Sidecar reindex after relation writes is still per-target.**

**What.** `Relations::apply_relation_pointers` now batches the postmeta writes (delta + bulk INSERT/DELETE), and `Document::prepare_meta_updates` skips WP REST's O(N×M) `update_multi_meta_value` diff via `Relations::fast_write_forward_meta`. That brought `relation_many_targets` p95 from ~18s back to ~460ms and `relation_small_delta` from ~18s to ~25ms at 50 collections. The remaining cost in `many_targets` is `reindex_targets` calling `FieldValueIndex::index_row_field` once per touched reverse row (500 calls × 1 SELECT meta + 1 DELETE sidecar + N INSERTs sidecar). It is within budget but is the largest term left in the write path.

**Where.** `Relations::apply_relation_pointers` and `Relations::reindex_targets` in `includes/Relations.php`; `FieldValueIndex::index_row_field` and `write_index_rows` in `includes/FieldValues/FieldValueIndex.php`. Scenarios `relation_many_targets` and `relation_small_delta` in `includes/CLI/PerfBench.php`.

**Solution.** Compute the sidecar delta directly from the postmeta delta we already have (added / removed reverse pointers), then write it with two batched statements: one `DELETE FROM <sidecar> WHERE (row_id, field_id, value_text) IN (...)` for removals, one multi-row `INSERT` for additions (using the next `value_seq` per target, which can be read in one warmup query). The forward field's sidecar can stay on `index_row_field` since it is a single row.

<a id="td-option-migration-per-row"></a>

**Option migrations rewrite postmeta one row at a time.**

**What.** `FieldsController::migrate_rows` loops over every row whose select / multiselect value matches the source token and calls `delete_post_meta` + `add_post_meta` (or `update_post_meta`) per row. That is ~2 SQL statements per row plus hooks. `migrate_many_rows` p95 ≈ 1s at 50 collections with ~5000 SQL queries for what is conceptually a single update on a meta_key + meta_value pair.

**Where.** `FieldsController::migrate_rows` in `includes/Rest/FieldsController.php`; `migrate_1000_rows` and `migrate_many_rows` scenarios in `includes/CLI/PerfBench.php`.

**Solution.** Replace the loop with a single statement per branch: `UPDATE wp_postmeta SET meta_value = %s WHERE meta_key = %s AND meta_value = %s` for `action = 'replace'` on single-value fields, `DELETE FROM wp_postmeta WHERE ...` for `action = 'clear'`. Pre-fetch the affected row ids so the meta cache and sidecar reindex can be invalidated in batch afterwards. Multiselect `replace` is harder because of the "already has target" case; query the conflict set first, then run two statements (a `DELETE` for the duplicates, an `UPDATE` for the rest).

<a id="td-register-field-meta-cache-warmup"></a>

**`register_field_meta` warms postmeta one field at a time.**

**What.** `Document::register_field_meta` runs on every `init` and iterates every `crtxt_field` post calling `get_post_meta($field_id, 'type', true)`. Each call triggers a single-post meta cache load, which is one extra SELECT per field. On the bench dataset (~540 fields) that is ~540 unnecessary SELECTs on every REST request before any handler runs.

**Where.** `Document::register_field_meta` in `includes/PostType/Document.php`.

**Solution.** Call `update_meta_cache( 'post', $field_ids )` once before the foreach so the subsequent `get_post_meta` calls are cache hits. The field-id list is already in memory from the preceding `get_posts`, so the warmup is a one-liner.
<a id="td-formula-materialized-values"></a>

**Formula values materialize synchronously.**

**What.** Formula output is stored in the same `field-<id>` row meta as normal fields. That keeps rows, exports, filters, sorts, and the field-value index reading one canonical value, but it means Cortext has to keep that stored value fresh. In v0, it does that synchronously: all formulas on a row after row writes, visible rows after list reads, and every row in the collection after a formula is created or edited. Volatile formulas such as `now()` get one extra refresh only when a request sorts or filters by that volatile formula, because SQL and the sidecar index read the materialized meta.

This is fine while collections are small and formulas are few. It becomes the wrong shape for large tables with several dependent formulas, or for sorting thousands of rows by something like `dateBetween(now(), field("Created"), "days")`. The code stores dependency ids already, but it does not yet use them as a dirty graph or background job plan.

**Where.** `includes/Formula/Materializer.php`, formula refresh calls in `includes/PostType/Document.php`, `includes/Rest/RowsController.php`, and `includes/Rest/FieldsController.php`, plus formula indexing in `includes/FieldValues/FieldValueIndex.php`.

**Solution.** For non-volatile formulas, keep materialized row meta as the source of truth and make refresh narrower. Row writes should recompute only formulas that depend on the changed field, in dependency order. Formula create/update can mark affected rows dirty and process them in batches instead of blocking the request on the whole collection.

For volatile formulas, treat materialized meta as a cache rather than the source of truth. Define explicit refresh points, with view load as the obvious baseline, and document the staleness contract. Once that exists, collection-wide recompute calls can shrink to those refresh points plus repair tools and migrations.
