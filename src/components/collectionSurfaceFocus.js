const ENABLED_BUTTON_SELECTOR =
	'button:not(:disabled):not([aria-disabled="true"])';
const SEARCH_SELECTOR =
	'[data-cortext-focus-region="search"] input[type="search"]:not(:disabled):not([aria-disabled="true"])';
const NEW_ROW_SELECTOR =
	'.cortext-data-view__new-row:not(:disabled):not([aria-disabled="true"])';
const VIEW_CONTROL_SELECTOR = `[data-cortext-focus-region="view-controls"] ${ ENABLED_BUTTON_SELECTOR }`;

function getTableRowTarget( root ) {
	const row = root.querySelector( 'tbody tr.dataviews-view-table__row' );
	if ( ! row ) {
		return null;
	}

	return row.querySelector(
		[
			'.cortext-title-cell .cortext-editable-cell__shell:not([tabindex="-1"]):not([aria-disabled="true"])',
			`.cortext-title-cell ${ ENABLED_BUTTON_SELECTOR }`,
			'.cortext-title-cell a[href]',
			'.cortext-title-cell [tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])',
		].join( ', ' )
	);
}

function getGridRowTarget( root ) {
	return root.querySelector(
		[
			'.dataviews-view-grid [role="gridcell"].dataviews-view-grid__card:not(.cortext-data-view__new-row-gridcell):not(.dataviews-view-grid__placeholder)',
			'.dataviews-view-grid-infinite-scroll [role="article"].dataviews-view-grid__card:not(.cortext-data-view__new-row-gridcell):not(.dataviews-view-grid__placeholder)',
		].join( ', ' )
	);
}

function getListRowTarget( root ) {
	return root.querySelector(
		'.dataviews-view-list__item:not([aria-disabled="true"])'
	);
}

/**
 * Find the preferred focus target in a rendered collection.
 *
 * Cortext data attributes mark stable toolbar regions. Row selectors follow
 * the DataViews 18 markup until it exposes a public focus API.
 *
 * @param {Element} root                 Collection wrapper.
 * @param {Object}  options              Target selection options.
 * @param {boolean} options.isTrulyEmpty Whether the unfiltered collection is empty.
 * @param {string}  options.layoutType   Active DataViews layout.
 * @return {HTMLElement|null} Focusable collection control or row.
 */
export function getCollectionSurfaceFocusTarget(
	root,
	{ isTrulyEmpty, layoutType }
) {
	if ( ! root ) {
		return null;
	}

	if ( isTrulyEmpty ) {
		const newRowButton = root.querySelector( NEW_ROW_SELECTOR );
		if ( newRowButton ) {
			return newRowButton;
		}
	}

	const search = root.querySelector( SEARCH_SELECTOR );
	if ( search ) {
		return search;
	}

	const viewControl = root.querySelector( VIEW_CONTROL_SELECTOR );
	if ( viewControl ) {
		return viewControl;
	}

	if ( layoutType === 'table' ) {
		return getTableRowTarget( root );
	}
	if ( layoutType === 'grid' ) {
		return getGridRowTarget( root );
	}
	if ( layoutType === 'list' ) {
		return getListRowTarget( root );
	}

	return null;
}

/**
 * A search or filter with no matches does not make the collection empty.
 * Keep Search as the focus target so users can clear the constraint.
 *
 * @param {Object}           options              Collection state.
 * @param {boolean}          options.rowsResolved Whether the first row query resolved.
 * @param {number|undefined} options.totalItems   Total unfiltered/filtered rows from the active query.
 * @param {Object|undefined} options.view         Saved collection view.
 * @return {boolean} Whether the collection itself is empty.
 */
export function isCollectionTrulyEmpty( { rowsResolved, totalItems, view } ) {
	return (
		rowsResolved &&
		totalItems === 0 &&
		! String( view?.search ?? '' ).trim() &&
		! ( view?.filters?.length ?? 0 )
	);
}

/**
 * Loading may finish after the user moves on. Move focus only while the
 * original control is still mounted and focused.
 *
 * @param {HTMLElement|null|undefined} originElement Activation control.
 * @return {boolean} Whether destination focus may still be applied.
 */
export function isSurfaceFocusOriginCurrent( originElement ) {
	return Boolean(
		originElement?.isConnected &&
			originElement.ownerDocument?.activeElement === originElement
	);
}
