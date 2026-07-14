import {
	Button,
	CheckboxControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews/wp';
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { closeSmall, trash } from '@wordpress/icons';

const GRID_VIEW_OPTIONS_BODY_CLASS = 'cortext-grid-view-options-open';

function DataViewsViewConfig( { view } ) {
	const wrapperRef = useRef( null );
	const isGridView = view?.type === 'grid';

	const getOwnerDocuments = useCallback( () => {
		const ownerDocument =
			wrapperRef.current?.ownerDocument ?? globalThis.document;
		const ownerDocuments = [ ownerDocument ].filter( Boolean );
		try {
			const parentDocument = ownerDocument?.defaultView?.parent?.document;
			if ( parentDocument && parentDocument !== ownerDocument ) {
				ownerDocuments.push( parentDocument );
			}
		} catch {
			// Ignore cross-origin parent frames.
		}
		return ownerDocuments;
	}, [] );
	const syncBodyClass = useCallback(
		( isOpen ) => {
			for ( const ownerDocument of getOwnerDocuments() ) {
				ownerDocument?.body?.classList.toggle(
					GRID_VIEW_OPTIONS_BODY_CLASS,
					isGridView && isOpen
				);
			}
		},
		[ getOwnerDocuments, isGridView ]
	);
	const clearBodyClass = useCallback( () => {
		for ( const ownerDocument of getOwnerDocuments() ) {
			ownerDocument?.body?.classList.remove(
				GRID_VIEW_OPTIONS_BODY_CLASS
			);
		}
	}, [ getOwnerDocuments ] );

	useLayoutEffect( () => {
		const toggle = wrapperRef.current?.querySelector(
			'button[aria-expanded]'
		);
		if ( ! toggle ) {
			clearBodyClass();
			return clearBodyClass;
		}

		const syncFromToggle = () => {
			syncBodyClass( toggle.getAttribute( 'aria-expanded' ) === 'true' );
		};
		syncFromToggle();

		const ownerWindow = toggle.ownerDocument?.defaultView;
		const Observer = ownerWindow?.MutationObserver;
		if ( ! Observer ) {
			return clearBodyClass;
		}
		const observer = new Observer( syncFromToggle );
		observer.observe( toggle, {
			attributes: true,
			attributeFilter: [ 'aria-expanded' ],
		} );

		return () => {
			observer.disconnect();
			clearBodyClass();
		};
	}, [ clearBodyClass, syncBodyClass ] );

	return (
		<span ref={ wrapperRef }>
			<DataViews.ViewConfig />
		</span>
	);
}

export function DataViewsChrome( { footer, view } ) {
	return (
		<>
			<HStack
				alignment="top"
				justify="space-between"
				className="dataviews__view-actions"
				spacing={ 1 }
			>
				<HStack
					justify="start"
					expanded={ false }
					className="dataviews__search"
				>
					<DataViews.Search />
					<DataViews.FiltersToggle />
				</HStack>
				<HStack
					spacing={ 1 }
					expanded={ false }
					style={ { flexShrink: 0 } }
				>
					<DataViews.LayoutSwitcher />
					<DataViewsViewConfig view={ view } />
				</HStack>
			</HStack>
			<DataViews.Filters className="dataviews-filters__container" />
			<DataViews.Layout />
			{ footer }
		</>
	);
}

export function DataViewsBulkSelectionControls( {
	className = 'dataviews-bulk-actions-footer__container',
	selectedIds,
	visibleIds,
	onClearSelection,
	onDeleteSelected,
	onToggleVisibleSelection,
} ) {
	const selectedSet = useMemo(
		() => new Set( selectedIds ),
		[ selectedIds ]
	);
	const selectedCount = selectedIds.length;
	const visibleCount = visibleIds.length;
	const selectedVisibleCount = visibleIds.filter( ( id ) =>
		selectedSet.has( id )
	).length;
	const allVisibleSelected =
		visibleCount > 0 && selectedVisibleCount === visibleCount;
	const hasVisibleSelection = selectedVisibleCount > 0;

	const countLabel =
		selectedCount > 0
			? sprintf(
					/* translators: %d: number of selected documents. */
					_n(
						'%d document selected',
						'%d documents selected',
						selectedCount,
						'cortext'
					),
					selectedCount
			  )
			: sprintf(
					/* translators: %d: number of visible documents. */
					_n(
						'%d document',
						'%d documents',
						visibleCount,
						'cortext'
					),
					visibleCount
			  );

	return (
		<HStack expanded={ false } className={ className } spacing={ 3 }>
			<CheckboxControl
				className="dataviews-view-table-selection-checkbox"
				__nextHasNoMarginBottom
				checked={ allVisibleSelected }
				indeterminate={ ! allVisibleSelected && hasVisibleSelection }
				onChange={ onToggleVisibleSelection }
				aria-label={
					allVisibleSelected
						? __( 'Deselect visible', 'cortext' )
						: __( 'Select visible', 'cortext' )
				}
			/>
			<span className="dataviews-bulk-actions-footer__item-count">
				{ countLabel }
			</span>
			<HStack
				className="dataviews-bulk-actions-footer__action-buttons"
				expanded={ false }
				spacing={ 1 }
			>
				{ selectedCount > 0 && (
					<Button
						icon={ trash }
						isDestructive
						label={ __( 'Move selected to Trash', 'cortext' ) }
						onClick={ onDeleteSelected }
						size="compact"
						showTooltip
						tooltipPosition="top"
					/>
				) }
				{ selectedCount > 0 && (
					<Button
						icon={ closeSmall }
						label={ __( 'Clear selection', 'cortext' ) }
						onClick={ onClearSelection }
						size="compact"
						showTooltip
						tooltipPosition="top"
					/>
				) }
			</HStack>
		</HStack>
	);
}

export function DataViewsSelectionFooter( {
	enabled,
	selectedIds,
	visibleIds,
	totalItems,
	totalPages,
	onClearSelection,
	onDeleteSelected,
	onToggleVisibleSelection,
} ) {
	const showBulkControls = enabled && totalItems > 0;
	const showPagination = totalItems > 0 && totalPages > 1;

	if ( ! showBulkControls && ! showPagination ) {
		return null;
	}

	return (
		<HStack expanded={ false } justify="end" className="dataviews-footer">
			{ showBulkControls ? (
				<DataViewsBulkSelectionControls
					selectedIds={ selectedIds }
					visibleIds={ visibleIds }
					onClearSelection={ onClearSelection }
					onDeleteSelected={ onDeleteSelected }
					onToggleVisibleSelection={ onToggleVisibleSelection }
				/>
			) : null }
			<DataViews.Pagination />
		</HStack>
	);
}

export function DataViewStateShell( { children, status } ) {
	return (
		<div className="cortext-data-view-shell">
			<div
				className={ `cortext-data-view cortext-data-view--${ status }` }
			>
				<div className="cortext-data-view__state">{ children }</div>
			</div>
		</div>
	);
}
