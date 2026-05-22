import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	CheckboxControl,
	Notice,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { closeSmall, copy, plus, trash } from '@wordpress/icons';

import DataViewColumnInteractions from './DataViewColumnInteractions';
import DataViewRowReorder from './DataViewRowReorder';
import {
	useDocumentPeekActions,
	useDocumentPeekState,
} from './DocumentPeekProvider';
import { CurrentViewModeProvider } from './CurrentViewModeContext';
import EditableCell, { RowMutationContext } from './EditableCell';
import PageIcon from './PageIcon';
import { CollectionRowsSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import afterNextPaint from '../hooks/afterNextPaint';
import allSettledWithConcurrency from './allSettledWithConcurrency';
import { filterSortAndPaginateWithGroups } from './groupedFilters';
import TableCalculationsFooter from './TableCalculationsFooter';
import ColumnHeaderActions from './fields/ColumnHeaderActions';
import { ROW_DETAIL_MODE_ICONS, ROW_DETAIL_MODE_LABELS } from './RowDetailView';
import {
	GHOST_FIELD_ID,
	MANUAL_SORT_ID,
	TITLE_FIELD_ID,
	isDefaultVisibleField,
	normalizeView,
	pruneFiltersForFields,
	withNewlyVisibleFields,
} from './dataViewColumns';
import { scrollToEndQuickly } from './dataViewScroll';
import { getRowDetailMode, withRowDetailMode } from './rowDetailUtils';
import {
	applyVisibleSelectionChange,
	mergeVisibleSelection,
	normalizeRowId,
	rangeSelection,
	removeDeletedSelection,
	rowIds,
	rowsInDataViewRenderOrder,
	toggleVisibleSelection,
} from './dataViewSelection';
import { useCollectionFieldsContext } from './CollectionFieldsContext';
import { dataViewsFilterByForType } from '../hooks/fieldMapping';
import { toDataViewId, toRecordId } from '../hooks/fieldIds';
import useCollectionRows from '../hooks/useCollectionRows';
import { useRecents } from '../hooks/useRecents';
import { elementsFromOptions } from '../hooks/optionElements';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };
const TITLE_LABEL = __( 'Title', 'cortext' );
const TITLE_FILTER_OPERATORS = [
	'is',
	'isNot',
	'contains',
	'notContains',
	'startsWith',
	'endsWith',
	'isEmpty',
	'isNotEmpty',
];
function hasActiveCalculations( view ) {
	return Object.values( view?.calculations ?? {} ).some( Boolean );
}

const OpenRowActionContext = createContext( {
	enabled: false,
	icon: ROW_DETAIL_MODE_ICONS.side,
	openRowId: null,
	requestOpenRow: null,
} );

// The peek panel cannot render until the editor is ready. On slower loads a
// row click can feel like nothing happened, so pointerdown applies a short
// "opening" state immediately.
const OPENING_FEEDBACK_TIMEOUT_MS = 600;

function TitleCell( { item } ) {
	const { enabled, icon, openRowId, requestOpenRow } =
		useContext( OpenRowActionContext );
	const canOpenRow = Boolean( enabled && requestOpenRow );
	const isOpenRow = canOpenRow && String( item?.id ) === String( openRowId );
	const documentIcon = item?.meta?.cortext_document_icon ?? '';
	const [ isOpening, setIsOpening ] = useState( false );
	const openingTimeoutRef = useRef( null );

	const clearOpeningTimeout = useCallback( () => {
		if ( openingTimeoutRef.current ) {
			clearTimeout( openingTimeoutRef.current );
			openingTimeoutRef.current = null;
		}
	}, [] );

	useEffect( () => clearOpeningTimeout, [ clearOpeningTimeout ] );

	// Once this row owns the open peek, --is-open handles the visual state.
	// Drop the short-lived opening state so it cannot linger after a quick close.
	useEffect( () => {
		if ( isOpenRow && isOpening ) {
			clearOpeningTimeout();
			setIsOpening( false );
		}
	}, [ clearOpeningTimeout, isOpening, isOpenRow ] );

	const openRow = useCallback(
		( event ) => {
			event.preventDefault();
			event.stopPropagation();
			requestOpenRow?.( item );
		},
		[ item, requestOpenRow ]
	);
	const handleOpenPointerDown = useCallback(
		( event ) => {
			event.stopPropagation();
			if ( ! canOpenRow || isOpenRow ) {
				return;
			}
			setIsOpening( true );
			clearOpeningTimeout();
			openingTimeoutRef.current = setTimeout( () => {
				openingTimeoutRef.current = null;
				setIsOpening( false );
			}, OPENING_FEEDBACK_TIMEOUT_MS );
		},
		[ canOpenRow, clearOpeningTimeout, isOpenRow ]
	);
	const stopPropagation = useCallback( ( event ) => {
		event.stopPropagation();
	}, [] );

	return (
		<div
			className={
				'cortext-title-cell' +
				( canOpenRow ? ' cortext-title-cell--with-open-action' : '' ) +
				( isOpenRow ? ' cortext-title-cell--is-open' : '' ) +
				( isOpening && ! isOpenRow
					? ' cortext-title-cell--is-opening'
					: '' )
			}
		>
			{ documentIcon ? (
				<span className="cortext-title-cell__icon" aria-hidden="true">
					<PageIcon icon={ documentIcon } size={ 16 } />
				</span>
			) : null }
			<EditableCell
				item={ item }
				fieldId="title"
				fieldType="title"
				label={ TITLE_LABEL }
				getValue={ ( ctx ) =>
					ctx.item?.title?.raw ?? ctx.item?.title?.rendered ?? ''
				}
			/>
			{ canOpenRow ? (
				<Button
					className="cortext-title-cell__open"
					icon={ icon }
					label={ __( 'Open row', 'cortext' ) }
					size="small"
					variant="tertiary"
					onClick={ openRow }
					onMouseDown={ stopPropagation }
					onPointerDown={ handleOpenPointerDown }
				>
					{ __( 'Open', 'cortext' ) }
				</Button>
			) : null }
		</div>
	);
}

const TITLE_FIELD = {
	id: TITLE_FIELD_ID,
	type: 'text',
	label: TITLE_LABEL,
	header: (
		<span className="cortext-column-header-label">{ TITLE_LABEL }</span>
	),
	// Prefer `title.raw` over `title.rendered` so sort comparisons use
	// the unfiltered string (the_title encodes `&` as `&#038;`, which
	// would otherwise sort under that literal entity). Same reason as
	// `mapField`'s label fallback in `src/hooks/fieldMapping.js`.
	getValue: ( { item } ) => {
		const title = item?.title;
		return typeof title === 'string'
			? title
			: title?.raw ?? title?.rendered ?? '';
	},
	render: ( { item } ) => <TitleCell item={ item } />,
	editable: true,
	cortextType: 'title',
	sortable: true,
	filterable: true,
	operators: TITLE_FILTER_OPERATORS,
	filterBy: dataViewsFilterByForType( 'text', TITLE_FILTER_OPERATORS ),
	enableGlobalSearch: true,
	// The title column can't be hidden (it's the row identity), but it
	// reorders and resizes like any other column. `normalizeView` re-adds
	// the id to `view.fields` if something corrupts the saved state.
	enableHiding: false,
};

// Pulls a "single equality" prefill out of the active filters: only filters
// whose operator is `is` and whose value is a single scalar contribute.
// Multi-value operators (`isAny`, `isNone`, …) are skipped
// because the issue scopes prefill to single equality clauses only.
//
// The server now applies filters via GET /cortext/v1/rows, so prefill
// is a side effect of real filtering rather than its only consumer.
function prefillFromFilters( filters, fieldIds ) {
	const prefill = {};
	if ( ! Array.isArray( filters ) ) {
		return prefill;
	}
	for ( const filter of filters ) {
		if ( ! filter || typeof filter !== 'object' ) {
			continue;
		}
		const op = filter.operator;
		if ( op !== 'is' ) {
			continue;
		}
		const { field, value } = filter;
		if ( ! field || field === 'title' ) {
			continue;
		}
		if ( Array.isArray( value ) || value === null || value === undefined ) {
			continue;
		}
		if ( ! fieldIds.has( field ) ) {
			continue;
		}
		prefill[ field ] = value;
	}
	return prefill;
}

function NewRowButton( { slug, view, fields, onCreated, disabled } ) {
	const [ isCreating, setIsCreating ] = useState( false );
	const [ error, setError ] = useState( null );

	const prefillableFieldIds = useMemo(
		() =>
			new Set(
				fields
					.filter(
						( f ) =>
							f.editable !== false && f.cortextType !== 'rollup'
					)
					.map( ( f ) => f.id )
			),
		[ fields ]
	);

	const onClick = useCallback( async () => {
		setIsCreating( true );
		setError( null );
		const meta = prefillFromFilters( view?.filters, prefillableFieldIds );
		try {
			// FIXME: Consider supporting row creation via /cortext/v1/rows.
			const created = await apiFetch( {
				path: `/wp/v2/crtxt_${ slug }`,
				method: 'POST',
				data: {
					status: 'private',
					title: '',
					...( Object.keys( meta ).length ? { meta } : {} ),
				},
			} );
			onCreated( created );
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not create row.', 'cortext' )
			);
		} finally {
			setIsCreating( false );
		}
	}, [ slug, view, prefillableFieldIds, onCreated ] );

	return (
		<>
			<Button
				className="cortext-data-view__new-row"
				variant="tertiary"
				icon={ plus }
				onClick={ onClick }
				isBusy={ isCreating }
				disabled={ disabled || isCreating || ! slug }
			>
				{ __( 'New', 'cortext' ) }
			</Button>
			{ error ? (
				<Notice
					status="error"
					isDismissible
					onRemove={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) : null }
		</>
	);
}

const TABLE_ROW_SELECTOR =
	'.dataviews-view-table tbody > tr:not(.dataviews-view-table__group-header-row)';
const GRID_CARD_SELECTOR = '.dataviews-view-grid__card';
const INTERACTIVE_SELECTION_IGNORE_SELECTOR =
	'button, a, input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .components-button';
const BULK_DELETE_CONCURRENCY = 4;

function findDataViewItemFromEvent( event, wrapper, layout, rows ) {
	const target = event.target;
	if ( ! target || ! wrapper ) {
		return null;
	}

	const selector =
		layout === 'grid' ? GRID_CARD_SELECTOR : TABLE_ROW_SELECTOR;
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

function DataViewsChrome( { footer } ) {
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
					<DataViews.ViewConfig />
				</HStack>
			</HStack>
			<DataViews.Filters className="dataviews-filters__container" />
			<DataViews.Layout />
			{ footer }
		</>
	);
}

function DataViewsBulkSelectionControls( {
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
					/* translators: %d: number of selected rows. */
					_n(
						'%d row selected',
						'%d rows selected',
						selectedCount,
						'cortext'
					),
					selectedCount
			  )
			: sprintf(
					/* translators: %d: number of visible rows. */
					_n( '%d row', '%d rows', visibleCount, 'cortext' ),
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
						? __( 'Deselect visible rows', 'cortext' )
						: __( 'Select visible rows', 'cortext' )
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
						label={ __( 'Trash selected rows', 'cortext' ) }
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

function DataViewsSelectionFooter( {
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

export default function CollectionDataViews( {
	collectionId,
	view,
	onChangeView,
	empty,
	invalid,
	error,
	onReady,
	revealFieldId = null,
	onFieldRevealed,
} ) {
	const { fields, collection, slug, isResolving, fieldsResolved } =
		useCollectionFieldsContext();
	const { touchRecent } = useRecents();

	const availableFields = useMemo(
		() => [ TITLE_FIELD, ...fields ],
		[ fields ]
	);

	// Compute a reconciled view synchronously so that useCollectionRows
	// never fetches with stale/deleted field references. While fields are
	// still resolving we don't know which IDs are valid, so defer the fetch.
	const reconciledView = useMemo( () => {
		if ( isResolving ) {
			return view;
		}
		const validIds = new Set( availableFields.map( ( f ) => f.id ) );
		const currentFilters = view?.filters ?? [];
		const nextFilters = pruneFiltersForFields( currentFilters, validIds );
		if ( nextFilters !== currentFilters ) {
			return { ...view, filters: nextFilters };
		}
		return view;
	}, [ view, availableFields, isResolving ] );

	const {
		data,
		paginationInfo: serverPaginationInfo,
		isLoading,
		hasResolved: rowsResolved,
		error: rowError,
		refresh,
		mutateRows,
		queryMode,
	} = useCollectionRows(
		isResolving ? null : collectionId,
		reconciledView,
		availableFields,
		{ forceClient: hasActiveCalculations( reconciledView ) }
	);

	const isTableLayout = view?.type === 'table';
	const isGridLayout = view?.type === 'grid';
	const supportsRowSelection = isTableLayout || isGridLayout;
	const isServerPaginated = queryMode === 'server';
	const dataViewFields = availableFields;
	const isRowsLoadingShell =
		! rowsResolved && data.length === 0 && isTableLayout;
	// Treat field loading and first-page row loading as one shell state. While
	// either is still running, hide DataViews chrome and show the rows skeleton
	// so the user does not see three quick states: generic placeholder, empty
	// DataViews chrome, then real rows.
	const isShellLoading = isResolving || isRowsLoadingShell;
	const holdLoadingShell = useDelayedFlag(
		isShellLoading,
		0,
		SKELETON_MIN_VISIBLE_MS
	);
	const showLoadingShell = isShellLoading || holdLoadingShell;

	const tableWrapperRef = useRef( null );
	const [ localRevealFieldId, setLocalRevealFieldId ] = useState( null );
	const pendingRevealFieldId = revealFieldId ?? localRevealFieldId;
	const requestRevealCreatedField = useCallback( ( created ) => {
		const fieldId = toDataViewId( created?.id );
		if ( fieldId ) {
			const wrapper =
				tableWrapperRef.current?.querySelector( '.dataviews-wrapper' );
			if ( wrapper ) {
				scrollToEndQuickly( wrapper, { snapIfAtEnd: true } );
			}
			setLocalRevealFieldId( fieldId );
		}
	}, [] );
	// editRequest is the "open this cell for editing" channel: cells that
	// match its `{ rowId, fieldId }` flip to edit mode and clear it. Used
	// for both the title-cell auto-open on a fresh row and Tab-driven
	// navigation between cells.
	const [ editRequest, setEditRequest ] = useState( null );
	const clearEditRequest = useCallback( () => setEditRequest( null ), [] );
	const [ optionOverrides, setOptionOverrides ] = useState( {} );
	const updateFieldOptions = useCallback( ( recordId, nextOptions ) => {
		const fieldId = `field-${ recordId }`;
		const elements = elementsFromOptions( nextOptions ) || [];
		setOptionOverrides( ( current ) => ( {
			...current,
			[ fieldId ]: elements,
		} ) );
	}, [] );

	// Editable, currently-visible columns in the order DataViews renders
	// them. Drives Tab/Shift+Tab cell-to-cell navigation. See
	// tech-debt.md#1: DataViews would own this if inline editing were
	// upstream, and this walker would go away.
	const editableVisibleFields = useMemo( () => {
		const order = view?.fields ?? [];
		const byId = new Map( availableFields.map( ( f ) => [ f.id, f ] ) );
		return order
			.map( ( id ) => byId.get( id ) )
			.filter( ( f ) => f && f.editable );
	}, [ availableFields, view?.fields ] );

	const { data: dataFiltered, paginationInfo: clientPaginationInfo } =
		useMemo( () => {
			if ( isServerPaginated ) {
				return {
					data,
					paginationInfo: serverPaginationInfo,
				};
			}
			return filterSortAndPaginateWithGroups(
				data,
				view,
				availableFields
			);
		}, [
			data,
			view,
			availableFields,
			isServerPaginated,
			serverPaginationInfo,
		] );
	const { data: dataFilteredForCalculations } = useMemo( () => {
		if ( isServerPaginated ) {
			return { data };
		}
		const calculationView = { ...( view ?? {} ) };
		// tech-debt.md#36: summaries need the filtered row set before
		// pagination, which DataViews does not expose as a separate result.
		delete calculationView.page;
		delete calculationView.perPage;
		return filterSortAndPaginateWithGroups(
			data,
			calculationView,
			availableFields
		);
	}, [ data, view, availableFields, isServerPaginated ] );
	const activePaginationInfo = isServerPaginated
		? serverPaginationInfo
		: clientPaginationInfo;

	const dataFilteredInRenderOrder = useMemo(
		() => rowsInDataViewRenderOrder( dataFiltered, view, dataViewFields ),
		[ dataFiltered, view, dataViewFields ]
	);
	const visibleRowIds = useMemo(
		() => rowIds( dataFilteredInRenderOrder ),
		[ dataFilteredInRenderOrder ]
	);
	const visibleRowsById = useMemo(
		() =>
			new Map(
				dataFiltered.map( ( row ) => [ normalizeRowId( row.id ), row ] )
			),
		[ dataFiltered ]
	);
	const [ selectedRowIds, setSelectedRowIds ] = useState( [] );
	const [ selectedRowsById, setSelectedRowsById ] = useState( {} );
	const [ selectionAnchorId, setSelectionAnchorId ] = useState( null );
	// tech-debt.md#48: DataViews only gives layouts the current-page
	// selection, so Cortext owns off-page ids and click-intent merging.
	const selectionInteractionRef = useRef( null );

	const cacheSelectedRows = useCallback(
		( ids ) => {
			setSelectedRowsById( ( current ) => {
				let next = current;
				ids.forEach( ( id ) => {
					const row = visibleRowsById.get( normalizeRowId( id ) );
					if ( ! row ) {
						return;
					}
					if ( next === current ) {
						next = { ...current };
					}
					next[ normalizeRowId( id ) ] = row;
				} );
				return next;
			} );
		},
		[ visibleRowsById ]
	);

	const selectedRows = useMemo(
		() =>
			selectedRowIds
				.map(
					( id ) =>
						selectedRowsById[ id ] ?? visibleRowsById.get( id )
				)
				.filter( Boolean ),
		[ selectedRowIds, selectedRowsById, visibleRowsById ]
	);

	const updateSelectedRowIds = useCallback(
		( updater ) => {
			setSelectedRowIds( ( current ) => {
				const next =
					typeof updater === 'function'
						? updater( current )
						: updater;
				cacheSelectedRows( next );
				return next;
			} );
		},
		[ cacheSelectedRows ]
	);

	const onChangeSelection = useCallback(
		( nextVisibleSelection ) => {
			if ( ! supportsRowSelection ) {
				return;
			}
			const interaction = selectionInteractionRef.current ?? {};
			selectionInteractionRef.current = null;
			if ( ! interaction.type ) {
				return;
			}
			updateSelectedRowIds( ( current ) =>
				applyVisibleSelectionChange(
					current,
					nextVisibleSelection,
					visibleRowIds,
					interaction
				)
			);
			if ( interaction.targetId ) {
				setSelectionAnchorId( interaction.targetId );
			}
		},
		[ supportsRowSelection, updateSelectedRowIds, visibleRowIds ]
	);

	const clearSelection = useCallback( () => {
		setSelectedRowIds( [] );
		setSelectedRowsById( {} );
		setSelectionAnchorId( null );
	}, [] );

	const toggleVisibleRows = useCallback( () => {
		updateSelectedRowIds( ( current ) =>
			toggleVisibleSelection( current, visibleRowIds )
		);
	}, [ updateSelectedRowIds, visibleRowIds ] );

	const captureSelectionIntent = useCallback(
		( event ) => {
			if ( ! supportsRowSelection ) {
				return;
			}
			selectionInteractionRef.current = null;
			const target = event.target;
			if ( ! target?.closest ) {
				return;
			}
			if ( target.closest( '.dataviews-footer' ) ) {
				return;
			}

			if (
				target.closest( '.dataviews-view-table-selection-checkbox' )
			) {
				selectionInteractionRef.current = { type: 'merge' };
				return;
			}

			const rowInfo = findDataViewItemFromEvent(
				event,
				tableWrapperRef.current,
				isGridLayout ? 'grid' : 'table',
				dataFilteredInRenderOrder
			);

			if ( target.closest( '.dataviews-selection-checkbox' ) ) {
				selectionInteractionRef.current = {
					type: 'merge',
					source: 'checkbox',
					targetId: rowInfo?.id,
				};
				return;
			}

			if ( target.closest( INTERACTIVE_SELECTION_IGNORE_SELECTOR ) ) {
				return;
			}

			if ( ! rowInfo ) {
				return;
			}

			if ( event.shiftKey ) {
				event.preventDefault();
				event.stopPropagation();
				const nextVisibleSelection = rangeSelection(
					visibleRowIds,
					selectionAnchorId,
					rowInfo.id
				);
				updateSelectedRowIds( ( current ) =>
					mergeVisibleSelection(
						current,
						nextVisibleSelection,
						visibleRowIds
					)
				);
				setSelectionAnchorId( rowInfo.id );
				return;
			}

			if ( event.metaKey || event.ctrlKey ) {
				selectionInteractionRef.current = {
					type: 'merge',
					targetId: rowInfo.id,
				};
				return;
			}

			setSelectionAnchorId( rowInfo.id );
		},
		[
			dataFilteredInRenderOrder,
			isGridLayout,
			selectionAnchorId,
			supportsRowSelection,
			updateSelectedRowIds,
			visibleRowIds,
		]
	);

	const requestNext = useCallback(
		( rowId, fieldId, direction ) => {
			if ( ! dataFiltered.length || ! editableVisibleFields.length ) {
				return;
			}
			const fieldIdx = editableVisibleFields.findIndex(
				( f ) => f.id === fieldId
			);
			const rowIdx = dataFiltered.findIndex( ( r ) => r.id === rowId );
			if ( fieldIdx < 0 || rowIdx < 0 ) {
				return;
			}

			let nextField = fieldIdx + direction;
			let nextRow = rowIdx;
			if ( nextField >= editableVisibleFields.length ) {
				nextField = 0;
				nextRow += 1;
			} else if ( nextField < 0 ) {
				nextField = editableVisibleFields.length - 1;
				nextRow -= 1;
			}
			if ( nextRow < 0 || nextRow >= dataFiltered.length ) {
				// Off the table edge; stop. Pagination crossings are out of
				// scope for v1.
				return;
			}

			setEditRequest( {
				rowId: dataFiltered[ nextRow ].id,
				fieldId: editableVisibleFields[ nextField ].id,
			} );
		},
		[ dataFiltered, editableVisibleFields ]
	);

	const saveRowField = useCallback(
		async ( rowId, fieldId, value ) => {
			if ( ! collectionId || ! rowId ) {
				return null;
			}
			const updated = await apiFetch( {
				path: `/cortext/v1/collections/${ collectionId }/rows/${ rowId }`,
				method: 'POST',
				data: {
					field: fieldId,
					value,
				},
			} );
			touchRecent( {
				kind: 'row',
				id: updated?.id ?? rowId,
				collectionId,
			} );
			refresh();
			return updated;
		},
		[ collectionId, refresh, touchRecent ]
	);

	const mutationContext = useMemo(
		() => ( {
			saveRowField,
			editRequest,
			clearEditRequest,
			requestNext,
			optionOverrides,
			updateFieldOptions,
			refreshRows: refresh,
		} ),
		[
			saveRowField,
			editRequest,
			clearEditRequest,
			requestNext,
			optionOverrides,
			updateFieldOptions,
			refresh,
		]
	);

	const onCreated = useCallback(
		( created ) => {
			// Without an explicit sort, rows use their stored order and new
			// rows append to the end. Move to the last page before refreshing
			// so the new row is visible instead of sending the user back to
			// page 1. With a user-chosen sort, the new row could land anywhere;
			// refresh in place and leave the view alone.
			//
			// tech-debt.md#2: lastPage arithmetic is optimistic against
			// possibly stale paginationInfo. With rows in core-data this
			// becomes a useEffect on totalPages.
			const hasExplicitSort = Boolean( view?.sort?.field );
			if ( ! hasExplicitSort ) {
				const perPage = view?.perPage ?? 25;
				const expectedTotal =
					( activePaginationInfo?.totalItems ?? 0 ) + 1;
				const lastPage = Math.max(
					1,
					Math.ceil( expectedTotal / perPage )
				);
				if ( ( view?.page ?? 1 ) !== lastPage ) {
					onChangeView( { ...view, page: lastPage } );
				} else {
					refresh();
				}
			} else {
				refresh();
			}
			if ( created?.id ) {
				touchRecent( {
					kind: 'row',
					id: created.id,
					collectionId,
				} );
				setEditRequest( { rowId: created.id, fieldId: 'title' } );
			}
		},
		[
			refresh,
			view,
			activePaginationInfo,
			onChangeView,
			touchRecent,
			collectionId,
		]
	);

	const viewRef = useRef( view );
	viewRef.current = view;
	const onChangeViewRef = useRef( onChangeView );
	onChangeViewRef.current = onChangeView;
	// Field IDs known on the previous sync. Drives the auto-show path
	// for fields the user just created. `null` on first run signals
	// "saved view, leave it alone."
	const knownFieldIdsRef = useRef( null );
	const savedRowDetailMode = getRowDetailMode( view );
	const postType = slug ? `crtxt_${ slug }` : null;
	const { openDocument, closeDocument } = useDocumentPeekActions();
	const { peek } = useDocumentPeekState();
	const openRowId = peek?.docId ?? null;

	// Keep the table's row context with the peek. The host uses it for
	// next/previous, refresh, and writing mode changes back to this view. Refs
	// keep row order current without replacing the source object each render.
	const rowsRef = useRef( null );
	rowsRef.current = dataFiltered;
	const source = useMemo(
		() => ( {
			kind: 'collection',
			collectionId,
			getRowList: () => rowsRef.current ?? [],
			refresh,
			onModeChange: ( mode ) => {
				onChangeViewRef.current(
					withRowDetailMode( viewRef.current, mode )
				);
			},
		} ),
		[ collectionId, refresh ]
	);

	const requestOpenRow = useCallback(
		( row ) => {
			if ( ! row?.id ) {
				return;
			}
			if ( String( row.id ) === String( openRowId ) ) {
				return;
			}
			openDocument( {
				id: row.id,
				slug: row.slug ?? '',
				postType,
				collectionId,
				preferredMode: savedRowDetailMode,
				source,
			} );
		},
		[
			collectionId,
			openDocument,
			openRowId,
			postType,
			savedRowDetailMode,
			source,
		]
	);

	const openRowActionContext = useMemo(
		() => ( {
			enabled: isTableLayout,
			icon: ROW_DETAIL_MODE_ICONS[ savedRowDetailMode ],
			openRowId,
			requestOpenRow,
		} ),
		[ isTableLayout, openRowId, requestOpenRow, savedRowDetailMode ]
	);

	const [ rowActionError, setRowActionError ] = useState( null );

	const openRowInMode = useCallback(
		( row, mode ) => {
			if ( ! row?.id ) {
				return;
			}
			// Save an explicit side/modal choice before opening. Full is a URL
			// jump, not a saved "open rows like this" preference.
			if ( mode !== 'full' && savedRowDetailMode !== mode ) {
				onChangeView( withRowDetailMode( view, mode ) );
			}
			openDocument( {
				id: row.id,
				slug: row.slug ?? '',
				postType,
				collectionId,
				preferredMode: mode,
				source,
			} );
		},
		[
			collectionId,
			onChangeView,
			openDocument,
			postType,
			savedRowDetailMode,
			source,
			view,
		]
	);

	const duplicateRow = useCallback(
		async ( row ) => {
			if ( ! collectionId || ! row?.id ) {
				return;
			}
			setRowActionError( null );
			try {
				const created = await apiFetch( {
					path: `/cortext/v1/collections/${ collectionId }/rows/${ row.id }/duplicate`,
					method: 'POST',
				} );
				if ( created?.id ) {
					touchRecent( {
						kind: 'row',
						id: created.id,
						collectionId,
					} );
				}
				refresh();
			} catch ( apiError ) {
				setRowActionError(
					apiError?.message ??
						__( 'Could not duplicate row.', 'cortext' )
				);
			}
		},
		[ collectionId, refresh, touchRecent ]
	);

	const forgetDeletedRows = useCallback(
		( deletedIds, options = {} ) => {
			if ( options.clearSelection ) {
				clearSelection();
				return;
			}
			setSelectedRowIds( ( current ) =>
				removeDeletedSelection( current, deletedIds )
			);
			setSelectedRowsById( ( current ) => {
				const deleted = new Set( deletedIds.map( normalizeRowId ) );
				let next = current;
				deleted.forEach( ( id ) => {
					if ( Object.prototype.hasOwnProperty.call( next, id ) ) {
						if ( next === current ) {
							next = { ...current };
						}
						delete next[ id ];
					}
				} );
				return next;
			} );
		},
		[ clearSelection ]
	);

	const requestDeleteRows = useCallback(
		async ( rows, options = {} ) => {
			const nextRows = ( rows ?? [] ).filter( ( row ) => row?.id );
			if ( nextRows.length === 0 || ! postType ) {
				return;
			}

			setRowActionError( null );
			const results = await allSettledWithConcurrency(
				nextRows,
				BULK_DELETE_CONCURRENCY,
				( row ) =>
					apiFetch( {
						path: `/wp/v2/${ postType }/${ row.id }`,
						method: 'DELETE',
					} )
			);

			const deletedIds = [];
			const failedRows = [];
			results.forEach( ( result, index ) => {
				const row = nextRows[ index ];
				if ( result.status === 'fulfilled' ) {
					deletedIds.push( normalizeRowId( row.id ) );
				} else {
					failedRows.push( row );
				}
			} );

			if ( deletedIds.length > 0 ) {
				const deleted = new Set( deletedIds );
				if ( openRowId && deleted.has( normalizeRowId( openRowId ) ) ) {
					closeDocument();
				}
				forgetDeletedRows( deletedIds, {
					clearSelection:
						failedRows.length === 0 &&
						( options.clearSelectionOnSuccess ??
							nextRows.length > 1 ),
				} );
				refresh();
				notifyDocumentTrashChanged();
				notifyCollectionRowsChanged();
			}

			if ( failedRows.length > 0 ) {
				let deleteErrorMessage;
				if ( nextRows.length === 1 ) {
					deleteErrorMessage = __(
						'Could not move row to Trash.',
						'cortext'
					);
				} else if ( failedRows.length === nextRows.length ) {
					deleteErrorMessage = __(
						'Could not move selected rows to Trash.',
						'cortext'
					);
				} else {
					deleteErrorMessage = sprintf(
						/* translators: %d: number of rows that failed to move to Trash. */
						_n(
							'%d row could not be moved to Trash.',
							'%d rows could not be moved to Trash.',
							failedRows.length,
							'cortext'
						),
						failedRows.length
					);
				}
				setRowActionError( deleteErrorMessage );
			}
		},
		[ closeDocument, forgetDeletedRows, openRowId, postType, refresh ]
	);

	const requestDeleteSelectedRows = useCallback( () => {
		requestDeleteRows( selectedRows, { clearSelectionOnSuccess: true } );
	}, [ requestDeleteRows, selectedRows ] );

	const rowActions = useMemo( () => {
		const actions = [];
		// List and grid get one primary Open action, matching the saved
		// detail mode. Table already has the inline Open button in the title
		// cell, so these actions stay inside the menu there.
		for ( const mode of [ 'side', 'modal', 'full' ] ) {
			actions.push( {
				id: `open-in-${ mode }`,
				label: sprintf(
					/* translators: %s: row detail mode (Side peek, Center modal, Full page). */
					__( 'Open in %s', 'cortext' ),
					ROW_DETAIL_MODE_LABELS[ mode ]
				),
				icon: ROW_DETAIL_MODE_ICONS[ mode ],
				isPrimary: ! isTableLayout && mode === savedRowDetailMode,
				context: 'single',
				callback: ( items ) => openRowInMode( items?.[ 0 ], mode ),
			} );
		}
		actions.push( {
			id: 'duplicate-row',
			label: __( 'Duplicate', 'cortext' ),
			icon: copy,
			context: 'single',
			callback: ( items ) => duplicateRow( items?.[ 0 ] ),
		} );
		actions.push( {
			id: 'delete-row',
			label: __( 'Trash', 'cortext' ),
			icon: trash,
			isDestructive: true,
			supportsBulk: true,
			context: 'single',
			callback: ( items ) =>
				requestDeleteRows( items, {
					clearSelectionOnSuccess: ( items?.length ?? 0 ) > 1,
				} ),
		} );
		return actions;
	}, [
		duplicateRow,
		isTableLayout,
		openRowInMode,
		requestDeleteRows,
		savedRowDetailMode,
	] );

	const dataViewActions = rowActions;

	useEffect( () => {
		selectionInteractionRef.current = null;
		clearSelection();
	}, [ clearSelection, collectionId ] );

	// Reconcile saved view state with the live schema whenever the field
	// set changes: seed defaults on first render, then hand off to
	// `normalizeView` for fields/styles cleanup (drop entries for fields
	// that no longer exist, clamp persisted widths, pin title in fields).
	// Sort and filters keep their own per-key reconciliation here because
	// they sit outside `normalizeView`'s scope. Other view settings
	// (perPage, search, layout.density) are left alone.
	useEffect( () => {
		// Don't run while we have no data at all *or* while the field
		// records are mid-refetch — during a refetch `fieldRecords` is
		// briefly empty for a new include query, and stripping orphan
		// IDs against that transient state would wipe the user's
		// `view.fields` (and their persisted view) until the refetch
		// completes.
		if ( isResolving || ! fieldsResolved ) {
			return;
		}
		const validIds = new Set( availableFields.map( ( f ) => f.id ) );
		const currentView = viewRef.current;
		const currentFields = currentView?.fields ?? [];
		const previouslyKnown = knownFieldIdsRef.current;

		let seededView = currentView;
		if ( currentFields.length === 0 ) {
			// Default to user-created collection fields. System fields stay
			// hidden until enabled from the View config.
			seededView = {
				...currentView,
				fields: availableFields
					.filter( isDefaultVisibleField )
					.map( ( f ) => f.id ),
			};
		}

		let normalized = normalizeView( seededView, validIds, {
			fields: availableFields,
		} );

		// Add fields that just appeared in the schema to `view.fields`.
		// The first run leaves saved views alone. Fields created through
		// Add field go at the end; duplicates and outside schema changes
		// keep the old placement rule.
		normalized = withNewlyVisibleFields(
			normalized,
			availableFields,
			previouslyKnown,
			pendingRevealFieldId
		);

		// Drop `__add_field` from older saved views. The add-field button now
		// uses the DataViews actions header instead of a synthetic column.
		if ( ( normalized.fields ?? [] ).includes( GHOST_FIELD_ID ) ) {
			normalized = {
				...normalized,
				fields: ( normalized.fields ?? [] ).filter(
					( id ) => id !== GHOST_FIELD_ID
				),
			};
		}

		knownFieldIdsRef.current = validIds;

		const currentSort = normalized.sort ?? null;
		const nextSort =
			currentSort &&
			( currentSort.field === MANUAL_SORT_ID ||
				validIds.has( currentSort.field ) )
				? currentSort
				: null;

		const currentFilters = normalized.filters ?? [];
		const nextFilters = pruneFiltersForFields( currentFilters, validIds );

		const sortChanged = currentSort !== nextSort;
		const filtersChanged = currentFilters !== nextFilters;
		const normalizedChanged = normalized !== currentView;

		if ( normalizedChanged || sortChanged || filtersChanged ) {
			onChangeViewRef.current( {
				...normalized,
				sort: nextSort,
				filters: nextFilters,
			} );
		}
	}, [
		availableFields,
		isTableLayout,
		isResolving,
		fieldsResolved,
		pendingRevealFieldId,
	] );

	useLayoutEffect( () => {
		if (
			! isTableLayout ||
			! pendingRevealFieldId ||
			isResolving ||
			! fieldsResolved
		) {
			return undefined;
		}
		if ( ! ( view?.fields ?? [] ).includes( pendingRevealFieldId ) ) {
			return undefined;
		}

		const recordId = toRecordId( pendingRevealFieldId );
		const reveal = () => {
			const wrapper =
				tableWrapperRef.current?.querySelector( '.dataviews-wrapper' );
			if ( ! wrapper ) {
				return false;
			}
			if ( recordId ) {
				const marker = tableWrapperRef.current?.querySelector(
					`[data-cortext-field-marker="${ recordId }"]`
				);
				if ( ! marker ) {
					return false;
				}
			}
			scrollToEndQuickly( wrapper, { trackEnd: true } );
			if ( localRevealFieldId === pendingRevealFieldId ) {
				setLocalRevealFieldId( null );
			}
			onFieldRevealed?.( pendingRevealFieldId );
			return true;
		};

		if ( reveal() ) {
			return undefined;
		}

		let frame = 0;
		let attempts = 0;
		const retryReveal = () => {
			if ( reveal() || attempts >= 30 ) {
				return;
			}
			attempts += 1;
			frame = window.requestAnimationFrame( retryReveal );
		};
		frame = window.requestAnimationFrame( retryReveal );

		return () => {
			if ( frame ) {
				window.cancelAnimationFrame( frame );
			}
		};
	}, [
		fieldsResolved,
		isResolving,
		isTableLayout,
		localRevealFieldId,
		onFieldRevealed,
		pendingRevealFieldId,
		view?.fields,
	] );

	useEffect( () => {
		// If this collection is mounting behind an already-painted pane, keep the
		// old pane active until the first row request finishes. Otherwise the route
		// can reveal an empty DataViews shell. Row errors count as ready so the
		// error can render.
		if ( isResolving || ( ! rowsResolved && ! rowError ) ) {
			return undefined;
		}

		let cancelled = false;
		async function signalReady() {
			await afterNextPaint();
			if ( ! cancelled ) {
				onReady?.( collectionId );
			}
		}
		signalReady();
		return () => {
			cancelled = true;
		};
	}, [ collectionId, isResolving, onReady, rowError, rowsResolved ] );

	// tech-debt.md#22: Gutenberg selects on any mousedown that bubbles up.
	// Dragging the dataviews scrollbar lands in the gutter (offset past the
	// scrollable element's clientWidth/Height); stop propagation there so
	// the scroll drag doesn't also pull a bounding box around the block.
	// Cell/row/header clicks still bubble. Capture phase so we beat any
	// descendant handler.
	useEffect( () => {
		const node = tableWrapperRef.current;
		if ( ! node ) {
			return;
		}
		const onMouseDown = ( event ) => {
			const target = event.target;
			if (
				! target ||
				typeof target.clientWidth !== 'number' ||
				typeof target.scrollWidth !== 'number'
			) {
				return;
			}
			// Only intercept on elements that actually scroll. Reading
			// `overflow*` and the `scrollWidth/Height > clientWidth/Height`
			// pair filters out clicks on non-scrolling elements (where
			// `offsetX > clientWidth` would otherwise misfire on padding /
			// border space).
			const styles = window.getComputedStyle( target );
			const canScrollY =
				( styles.overflowY === 'auto' ||
					styles.overflowY === 'scroll' ) &&
				target.scrollHeight > target.clientHeight;
			const canScrollX =
				( styles.overflowX === 'auto' ||
					styles.overflowX === 'scroll' ) &&
				target.scrollWidth > target.clientWidth;
			const onVerticalScrollbar =
				canScrollY && event.offsetX > target.clientWidth;
			const onHorizontalScrollbar =
				canScrollX && event.offsetY > target.clientHeight;
			if ( onVerticalScrollbar || onHorizontalScrollbar ) {
				event.stopPropagation();
			}
		};
		node.addEventListener( 'mousedown', onMouseDown, true );
		return () => node.removeEventListener( 'mousedown', onMouseDown, true );
	}, [ isResolving, rowsResolved, rowError ] );

	if ( ! isResolving && collectionId && ! collection ) {
		return (
			invalid ?? (
				<p>
					{ __(
						'This collection is no longer available.',
						'cortext'
					) }
				</p>
			)
		);
	}

	if ( ! isResolving && rowError ) {
		return (
			error ?? (
				<p>
					{ __( 'Collection rows could not be loaded.', 'cortext' ) }
				</p>
			)
		);
	}

	const hasSelectionColumn = isTableLayout && dataFiltered.length > 0;
	const hasVisibleRows = visibleRowIds.length > 0;
	// tech-debt.md#36: DataViews has no table footer slot, so table bulk
	// controls share the same portaled footer row as calculations.
	const tableBulkActions =
		isTableLayout && hasVisibleRows && selectedRowIds.length > 0 ? (
			<DataViewsBulkSelectionControls
				className="dataviews-bulk-actions-footer__container cortext-table-calculations__bulk-actions"
				selectedIds={ selectedRowIds }
				visibleIds={ visibleRowIds }
				onClearSelection={ clearSelection }
				onDeleteSelected={ requestDeleteSelectedRows }
				onToggleVisibleSelection={ toggleVisibleRows }
			/>
		) : null;
	const dataViewsFooter = (
		<DataViewsSelectionFooter
			enabled={ supportsRowSelection && ! isTableLayout }
			selectedIds={ selectedRowIds }
			visibleIds={ visibleRowIds }
			totalItems={ activePaginationInfo?.totalItems ?? 0 }
			totalPages={ activePaginationInfo?.totalPages ?? 0 }
			onClearSelection={ clearSelection }
			onDeleteSelected={ requestDeleteSelectedRows }
			onToggleVisibleSelection={ toggleVisibleRows }
		/>
	);

	return (
		<CurrentViewModeProvider value={ savedRowDetailMode }>
			<RowMutationContext.Provider value={ mutationContext }>
				<OpenRowActionContext.Provider value={ openRowActionContext }>
					<div
						className="cortext-data-view-shell"
						data-row-detail-mode={ savedRowDetailMode }
						data-row-detail-open={ openRowId ? 'true' : 'false' }
					>
						<div
							className="cortext-data-view"
							ref={ tableWrapperRef }
							onClickCapture={ captureSelectionIntent }
							data-loading-shell={
								showLoadingShell ? 'true' : undefined
							}
							style={
								showLoadingShell
									? {
											// Hold the wrapper at skeleton
											// height so content below does not
											// jump when chrome and rows appear.
											// Cap matches the skeleton row cap.
											// Use the saved density too, so
											// balanced and comfortable tables
											// reserve enough room and do not
											// clip the skeleton.
											'--cortext-data-view-loading-rows':
												Math.max(
													1,
													Math.min(
														view?.perPage ?? 8,
														15
													)
												),
											'--cortext-data-view-loading-row-height': `var(--cortext-data-view-row-height-${
												view?.layout?.density ??
												'compact'
											})`,
									  }
									: undefined
							}
						>
							{ rowActionError && (
								<Notice
									status="error"
									isDismissible
									onRemove={ () => setRowActionError( null ) }
								>
									{ rowActionError }
								</Notice>
							) }
							{ showLoadingShell && (
								<div className="cortext-data-view__rows-skeleton">
									<CollectionRowsSkeleton
										rowCount={ view?.perPage ?? 8 }
										columnCount={
											( view?.fields?.length ?? 0 ) + 1
										}
										density={
											view?.layout?.density ?? 'compact'
										}
									/>
								</div>
							) }
							{ ! isResolving && (
								<>
									<DataViews
										data={ dataFiltered }
										fields={ dataViewFields }
										view={ view }
										onChangeView={ onChangeView }
										paginationInfo={ activePaginationInfo }
										defaultLayouts={ DEFAULT_LAYOUTS }
										getItemId={ ( item ) =>
											String( item.id )
										}
										isLoading={ isLoading }
										empty={ empty }
										actions={ dataViewActions }
										{ ...( supportsRowSelection
											? {
													selection: selectedRowIds,
													onChangeSelection,
											  }
											: {} ) }
									>
										<DataViewsChrome
											footer={ dataViewsFooter }
										/>
									</DataViews>
									<DataViewRowReorder
										wrapperRef={ tableWrapperRef }
										view={ view }
										onChangeView={ onChangeView }
										collectionId={ collectionId }
										rows={ dataFiltered }
										data={ data }
										mutateRows={ mutateRows }
										onReordered={ refresh }
									/>
									{ isTableLayout && (
										<TableCalculationsFooter
											wrapperRef={ tableWrapperRef }
											view={ view }
											fields={ availableFields }
											data={ dataFilteredForCalculations }
											onChangeView={ onChangeView }
											hasSelectionColumn={
												hasSelectionColumn
											}
											bulkActions={ tableBulkActions }
										/>
									) }
									{ isTableLayout && (
										<DataViewColumnInteractions
											wrapperRef={ tableWrapperRef }
											view={ view }
											fields={ availableFields }
											onChangeView={ onChangeView }
										/>
									) }
									{ isTableLayout && (
										<ColumnHeaderActions
											collectionId={ collectionId }
											view={ view }
											onChangeView={ onChangeView }
											onFieldOptionsSaved={
												updateFieldOptions
											}
											onFieldCreated={
												requestRevealCreatedField
											}
											onRowsChanged={ refresh }
										/>
									) }
									{ /* tech-debt.md#7: DataViews has no footer slot, so the
									   New-row affordance and its CSS layout sit outside the
									   component instead of inside its layout chrome. */ }
									<div className="cortext-data-view__footer">
										<NewRowButton
											slug={ slug }
											view={ view }
											fields={ fields }
											onCreated={ onCreated }
										/>
									</div>
								</>
							) }
						</div>
					</div>
				</OpenRowActionContext.Provider>
			</RowMutationContext.Provider>
		</CurrentViewModeProvider>
	);
}
