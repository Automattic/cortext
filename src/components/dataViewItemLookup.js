import { normalizeRowId } from './dataViewSelection';

const TABLE_ROW_SELECTOR =
	'.dataviews-view-table tbody > tr:not(.dataviews-view-table__group-header-row)';
const GRID_CARD_SELECTOR = '.dataviews-view-grid__card';
const LIST_ROW_SELECTOR = '.dataviews-view-list > [role="row"]';

export const INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR =
	'button, a, input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .components-button, .cortext-editable-cell, .cortext-row-drag-handle';

export function findDataViewItemFromEvent( event, wrapper, layout, rows ) {
	const target = event.target;
	if ( ! target || ! wrapper ) {
		return null;
	}

	let selector = TABLE_ROW_SELECTOR;
	if ( layout === 'grid' ) {
		selector = GRID_CARD_SELECTOR;
	} else if ( layout === 'list' ) {
		selector = LIST_ROW_SELECTOR;
	}
	const itemElement = target.closest?.( selector );
	if ( ! itemElement || ! wrapper.contains( itemElement ) ) {
		return null;
	}

	const renderedItems = Array.from( wrapper.querySelectorAll( selector ) );
	const index = renderedItems.indexOf( itemElement );
	if ( index < 0 || ! rows[ index ]?.id ) {
		return null;
	}

	return {
		id: normalizeRowId( rows[ index ].id ),
		row: rows[ index ],
	};
}
