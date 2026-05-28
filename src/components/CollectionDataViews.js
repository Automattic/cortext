import apiFetch from '@wordpress/api-fetch';
import { Notice } from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { copy, starEmpty, starFilled, trash } from '@wordpress/icons';

import './CollectionDataViews.scss';
import './CollectionDataViews.grid.scss';
import './CollectionDataViews.list.scss';

import DataViewColumnInteractions from './DataViewColumnInteractions';
import {
	DataViewStateShell,
	DataViewsBulkSelectionControls,
	DataViewsChrome,
	DataViewsSelectionFooter,
} from './CollectionDataViewChrome';
import DataViewNewRowButton from './DataViewNewRowButton';
import DataViewRowReorder from './DataViewRowReorder';
import {
	useDocumentPeekActions,
	useDocumentPeekState,
} from './DocumentPeekProvider';
import { CurrentViewModeProvider } from './CurrentViewModeContext';
import { RowMutationContext } from './EditableCell';
import {
	COVER_FIELD,
	OpenRowActionContext,
	TITLE_FIELD,
} from './CollectionDataViewFields';
import GridNewRowPortal from './GridNewRowPortal';
import { CollectionRowsSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import afterNextPaint from '../hooks/afterNextPaint';
import allSettledWithConcurrency from './allSettledWithConcurrency';
import {
	DEFAULT_LAYOUTS,
	adaptViewForDataViews,
	mergeDataViewsChange,
} from './dataViewAdapter';
import { nextViewAfterRowCreated } from './dataViewCreation';
import { filterSortAndPaginateWithGroups } from './groupedFilters';
import TableCalculationsFooter from './TableCalculationsFooter';
import ColumnHeaderActions from './fields/ColumnHeaderActions';
import { ROW_DETAIL_MODE_ICONS, ROW_DETAIL_MODE_LABELS } from './RowDetailView';
import {
	GHOST_FIELD_ID,
	MANUAL_SORT_ID,
	isDefaultVisibleField,
	normalizeView,
	pruneFiltersForFields,
	withNewlyVisibleFields,
} from './dataViewColumns';
import {
	INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR,
	findDataViewItemFromEvent,
} from './dataViewItemLookup';
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
import { toDataViewId, toRecordId } from '../hooks/fieldIds';
import useCollectionRows from '../hooks/useCollectionRows';
import { useRecents } from '../hooks/useRecents';
import { filterFavoritesByDeletedIds, useFavoriteToggle } from '../documents';
import { useFavorites } from '../hooks/useFavorites';
import { elementsFromOptions } from '../hooks/optionElements';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';

function hasActiveCalculations( view ) {
	return Object.values( view?.calculations ?? {} ).some( Boolean );
}

const BULK_DELETE_CONCURRENCY = 4;
// tech-debt.md#61: DataViews ties list focus to its own selection. Cortext
// uses blank-row clicks and keyboard activation to open the row instead.
const EMPTY_DATA_VIEW_SELECTION = [];
const LIST_ROW_EMPTY_CLICK_TARGET_SELECTOR = '.dataviews-view-list__item';
const LIST_ROW_SELECTOR = '.dataviews-view-list > [role="row"]';
const ignoreDataViewsSelectionChange = () => {};

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
	const { fields, collection, isResolving, fieldsResolved } =
		useCollectionFieldsContext();
	const { touchRecent } = useRecents();
	// Field IDs from the last schema sync. We use this to auto-show fields
	// the user just created. `null` on first run means the saved view should
	// stay untouched.
	const knownFieldIdsRef = useRef( null );

	const availableFields = useMemo(
		() => [ TITLE_FIELD, COVER_FIELD, ...fields ],
		[ fields ]
	);
	const dataViewsView = useMemo(
		() => adaptViewForDataViews( view ),
		[ view ]
	);
	const viewRef = useRef( view );
	viewRef.current = view;
	const onChangeViewRef = useRef( onChangeView );
	onChangeViewRef.current = onChangeView;
	const onDataViewsChange = useCallback( ( nextView ) => {
		onChangeViewRef.current(
			mergeDataViewsChange( viewRef.current, nextView )
		);
	}, [] );

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
		const currentFields = Array.isArray( view?.fields ) ? view.fields : [];
		const previouslyKnown = knownFieldIdsRef.current;
		const newlyVisibleFields =
			previouslyKnown && currentFields.length > 0
				? availableFields
						.filter(
							( field ) =>
								isDefaultVisibleField( field ) &&
								! previouslyKnown.has( field.id ) &&
								! currentFields.includes( field.id )
						)
						.map( ( field ) => field.id )
				: [];
		if ( nextFilters !== currentFilters || newlyVisibleFields.length > 0 ) {
			return {
				...view,
				filters: nextFilters,
				...( newlyVisibleFields.length > 0
					? { fields: [ ...currentFields, ...newlyVisibleFields ] }
					: {} ),
			};
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
	const isListLayout = view?.type === 'list';
	let skeletonLayout = 'table';
	if ( isGridLayout ) {
		skeletonLayout = 'grid';
	} else if ( isListLayout ) {
		skeletonLayout = 'list';
	}
	const supportsRowSelection = isTableLayout || isGridLayout;
	const isServerPaginated = queryMode === 'server';
	const dataViewFields = availableFields;
	const isRowsLoadingShell = ! rowsResolved && data.length === 0;
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
	const [ formatOverrides, setFormatOverrides ] = useState( {} );
	const updateFieldFormat = useCallback( ( recordId, nextFormat ) => {
		const fieldId = `field-${ recordId }`;
		setFormatOverrides( ( current ) => ( {
			...current,
			[ fieldId ]: nextFormat ?? null,
		} ) );
	}, [] );

	// Editable, currently-visible columns in the order DataViews renders
	// them. Drives Tab/Shift+Tab cell-to-cell navigation. See
	// tech-debt.md#1: DataViews would own this if inline editing were
	// upstream, and this walker would go away.
	const editableVisibleFields = useMemo( () => {
		const order = dataViewsView?.fields ?? [];
		const byId = new Map( availableFields.map( ( f ) => [ f.id, f ] ) );
		return order
			.map( ( id ) => byId.get( id ) )
			.filter( ( f ) => f && f.editable );
	}, [ availableFields, dataViewsView?.fields ] );

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
		() =>
			rowsInDataViewRenderOrder(
				dataFiltered,
				dataViewsView,
				dataViewFields
			),
		[ dataFiltered, dataViewsView, dataViewFields ]
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
	const dataViewsSelectionProps = useMemo( () => {
		if ( supportsRowSelection ) {
			return {
				selection: selectedRowIds,
				onChangeSelection,
			};
		}

		// DataViews list keeps an internal selected row when uncontrolled.
		// Cortext uses list clicks for row open / cell edit, so keep selection
		// controlled and empty in this layout.
		if ( isListLayout ) {
			return {
				selection: EMPTY_DATA_VIEW_SELECTION,
				onChangeSelection: ignoreDataViewsSelectionChange,
			};
		}

		return {};
	}, [
		isListLayout,
		onChangeSelection,
		selectedRowIds,
		supportsRowSelection,
	] );

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

			if (
				target.closest( INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR )
			) {
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

	let dataViewLayoutType = 'table';
	if ( isGridLayout ) {
		dataViewLayoutType = 'grid';
	}
	if ( isListLayout ) {
		dataViewLayoutType = 'list';
	}
	const mutationContext = useMemo(
		() => ( {
			saveRowField,
			canEditCells: isTableLayout || isGridLayout || isListLayout,
			layoutType: dataViewLayoutType,
			editRequest,
			clearEditRequest,
			requestNext,
			optionOverrides,
			updateFieldOptions,
			formatOverrides,
			updateFieldFormat,
			refreshRows: refresh,
		} ),
		[
			saveRowField,
			dataViewLayoutType,
			isGridLayout,
			isListLayout,
			isTableLayout,
			editRequest,
			clearEditRequest,
			requestNext,
			optionOverrides,
			updateFieldOptions,
			formatOverrides,
			updateFieldFormat,
			refresh,
		]
	);

	const onCreated = useCallback(
		( created ) => {
			// In an unconstrained view, rows append to the stored order, so the
			// new row belongs on the last page. Search, filters, and explicit
			// sorts make that guess unsafe; refresh in place instead.
			//
			// tech-debt.md#2: lastPage arithmetic is optimistic against
			// possibly stale paginationInfo. With rows in core-data this
			// becomes a useEffect on totalPages.
			const nextView = nextViewAfterRowCreated(
				view,
				activePaginationInfo
			);
			if ( nextView !== view ) {
				onChangeView( nextView );
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

	const previousVisibleFieldsRef = useRef( null );
	const savedRowDetailMode = getRowDetailMode( view );
	const postType = collectionId ? 'crtxt_document' : null;
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
			updateFieldOptions,
			updateFieldFormat,
			onModeChange: ( mode ) => {
				onChangeViewRef.current(
					withRowDetailMode( viewRef.current, mode )
				);
			},
		} ),
		[ collectionId, refresh, updateFieldFormat, updateFieldOptions ]
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
			enabled: isTableLayout || isGridLayout || isListLayout,
			icon: ROW_DETAIL_MODE_ICONS[ savedRowDetailMode ],
			openRowId,
			requestOpenRow,
			showInlineOpen: isTableLayout,
		} ),
		[
			isGridLayout,
			isListLayout,
			isTableLayout,
			openRowId,
			requestOpenRow,
			savedRowDetailMode,
		]
	);
	const handleDataViewClick = useCallback(
		( event ) => {
			let clickLayout = null;
			if ( isGridLayout ) {
				clickLayout = 'grid';
			} else if ( isListLayout ) {
				clickLayout = 'list';
			}
			if ( ! clickLayout || event.defaultPrevented ) {
				return;
			}
			if (
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			const target = event.target;
			if ( ! target?.closest ) {
				return;
			}
			if (
				target.closest( INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR )
			) {
				return;
			}
			const rowInfo = findDataViewItemFromEvent(
				event,
				tableWrapperRef.current,
				clickLayout,
				dataFilteredInRenderOrder
			);
			if ( ! rowInfo?.row ) {
				return;
			}
			requestOpenRow( rowInfo.row );
		},
		[
			dataFilteredInRenderOrder,
			isGridLayout,
			isListLayout,
			requestOpenRow,
		]
	);
	const handleDataViewPointerDownCapture = useCallback(
		( event ) => {
			if ( ! isListLayout || event.defaultPrevented ) {
				return;
			}
			if ( event.button !== undefined && event.button !== 0 ) {
				return;
			}
			if (
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			const target = event.target;
			if ( ! target?.closest ) {
				return;
			}
			if (
				target.closest( INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR )
			) {
				return;
			}
			if ( ! target.closest( LIST_ROW_EMPTY_CLICK_TARGET_SELECTOR ) ) {
				return;
			}
			const rowInfo = findDataViewItemFromEvent(
				event,
				tableWrapperRef.current,
				'list',
				dataFilteredInRenderOrder
			);
			if ( ! rowInfo?.row ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			requestOpenRow( rowInfo.row );
		},
		[ dataFilteredInRenderOrder, isListLayout, requestOpenRow ]
	);
	const handleDataViewKeyDownCapture = useCallback(
		( event ) => {
			if ( ! isListLayout || event.defaultPrevented ) {
				return;
			}
			const target = event.target;
			if (
				! target?.closest ||
				! target.matches?.( LIST_ROW_EMPTY_CLICK_TARGET_SELECTOR )
			) {
				return;
			}

			const wrapper = tableWrapperRef.current;
			const rowElement = target.closest( LIST_ROW_SELECTOR );
			if (
				! wrapper ||
				! rowElement ||
				! wrapper.contains( rowElement )
			) {
				return;
			}

			if ( event.key === 'Enter' || event.key === ' ' ) {
				const rowInfo = findDataViewItemFromEvent(
					event,
					wrapper,
					'list',
					dataFilteredInRenderOrder
				);
				if ( ! rowInfo?.row ) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				requestOpenRow( rowInfo.row );
				return;
			}

			const renderedRows = Array.from(
				wrapper.querySelectorAll( LIST_ROW_SELECTOR )
			);
			const currentIndex = renderedRows.indexOf( rowElement );
			if ( currentIndex < 0 ) {
				return;
			}

			let nextIndex = null;
			if ( event.key === 'ArrowDown' ) {
				nextIndex = Math.min(
					currentIndex + 1,
					renderedRows.length - 1
				);
			} else if ( event.key === 'ArrowUp' ) {
				nextIndex = Math.max( currentIndex - 1, 0 );
			} else if ( event.key === 'Home' ) {
				nextIndex = 0;
			} else if ( event.key === 'End' ) {
				nextIndex = renderedRows.length - 1;
			}

			if ( nextIndex === null || nextIndex === currentIndex ) {
				return;
			}
			const nextTarget = renderedRows[ nextIndex ]?.querySelector(
				LIST_ROW_EMPTY_CLICK_TARGET_SELECTOR
			);
			if ( ! nextTarget ) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			nextTarget.focus();
		},
		[ dataFilteredInRenderOrder, isListLayout, requestOpenRow ]
	);
	const handleDataViewClickCapture = useCallback(
		( event ) => {
			captureSelectionIntent( event );
			handleDataViewClick( event );
		},
		[ captureSelectionIntent, handleDataViewClick ]
	);

	const [ rowActionError, setRowActionError ] = useState( null );

	const {
		isFavorite: isRowFavorite,
		toggle: toggleRowFavorite,
		disabled: areFavoriteActionsDisabled,
	} = useFavoriteToggle( { onError: setRowActionError } );
	const { setFavorites } = useFavorites();

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
						path: `/wp/v2/crtxt_documents/${ row.id }`,
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
				// Prune favorites for the rows we just trashed. The server cleans
				// stale entries on the next read, but doing it here keeps the next
				// favorites PUT from sending these row ids back.
				setFavorites( ( current ) =>
					filterFavoritesByDeletedIds( current, { row: deleted } )
				).catch( () => {
					// Keep this quiet. The next favorites read asks the server to
					// prune stale rows anyway.
				} );
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
		[
			closeDocument,
			forgetDeletedRows,
			openRowId,
			postType,
			refresh,
			setFavorites,
		]
	);

	const requestDeleteSelectedRows = useCallback( () => {
		requestDeleteRows( selectedRows, { clearSelectionOnSuccess: true } );
	}, [ requestDeleteRows, selectedRows ] );

	const rowActions = useMemo( () => {
		const actions = [];
		// The row itself opens in grid/list, and table has the inline Open
		// button in the title cell. Keep the mode choices in the row menu.
		for ( const mode of [ 'side', 'modal', 'full' ] ) {
			actions.push( {
				id: `open-in-${ mode }`,
				label: sprintf(
					/* translators: %s: row detail mode (Side peek, Center modal, Full page). */
					__( 'Open in %s', 'cortext' ),
					ROW_DETAIL_MODE_LABELS[ mode ]
				),
				icon: ROW_DETAIL_MODE_ICONS[ mode ],
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
			id: 'add-row-to-favorites',
			label: __( 'Add to favorites', 'cortext' ),
			icon: starEmpty,
			context: 'single',
			disabled: areFavoriteActionsDisabled,
			isEligible: ( item ) => ! isRowFavorite( item ),
			callback: ( items ) => toggleRowFavorite( items?.[ 0 ] ),
		} );
		actions.push( {
			id: 'remove-row-from-favorites',
			label: __( 'Remove from favorites', 'cortext' ),
			icon: starFilled,
			context: 'single',
			disabled: areFavoriteActionsDisabled,
			isEligible: ( item ) => isRowFavorite( item ),
			callback: ( items ) => toggleRowFavorite( items?.[ 0 ] ),
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
		areFavoriteActionsDisabled,
		duplicateRow,
		isRowFavorite,
		openRowInMode,
		requestDeleteRows,
		toggleRowFavorite,
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
		// Skip while we have no data, or while field records are refetching.
		// `fieldRecords` can briefly be empty for a new include query; pruning
		// against that temporary state would wipe the saved `view.fields`
		// until the refetch completes.
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
			! fieldsResolved ||
			showLoadingShell
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
		showLoadingShell,
		view?.fields,
	] );

	useLayoutEffect( () => {
		const currentFields = [ ...( view?.fields ?? [] ) ];
		const previousFields = previousVisibleFieldsRef.current;
		if ( ! previousFields ) {
			if ( fieldsResolved && ! isResolving && ! showLoadingShell ) {
				previousVisibleFieldsRef.current = currentFields;
			}
			return;
		}
		if (
			! isTableLayout ||
			isResolving ||
			! fieldsResolved ||
			showLoadingShell
		) {
			return;
		}

		const lastFieldId = currentFields[ currentFields.length - 1 ];
		const addedAtEnd =
			currentFields.length > previousFields.length &&
			lastFieldId &&
			! previousFields.includes( lastFieldId );
		if ( addedAtEnd ) {
			setLocalRevealFieldId( lastFieldId );
			const wrapper =
				tableWrapperRef.current?.querySelector( '.dataviews-wrapper' );
			if ( wrapper ) {
				scrollToEndQuickly( wrapper, { trackEnd: true } );
			}
		}
		previousVisibleFieldsRef.current = currentFields;
	}, [
		fieldsResolved,
		isResolving,
		isTableLayout,
		showLoadingShell,
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
			<DataViewStateShell status="invalid">
				{ invalid ?? (
					<p>
						{ __(
							'This collection is no longer available.',
							'cortext'
						) }
					</p>
				) }
			</DataViewStateShell>
		);
	}

	if ( ! isResolving && rowError ) {
		return (
			<DataViewStateShell status="error">
				{ error ?? (
					<p>
						{ __(
							'Collection rows could not be loaded.',
							'cortext'
						) }
					</p>
				) }
			</DataViewStateShell>
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
							onPointerDownCapture={
								handleDataViewPointerDownCapture
							}
							onKeyDownCapture={ handleDataViewKeyDownCapture }
							onClickCapture={ handleDataViewClickCapture }
							data-grid-card-clickable={
								isGridLayout ? 'true' : undefined
							}
							data-list-row-clickable={
								isListLayout ? 'true' : undefined
							}
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
										layout={ skeletonLayout }
									/>
								</div>
							) }
							{ ! isResolving && (
								<>
									<DataViews
										data={ dataFiltered }
										fields={ dataViewFields }
										view={ dataViewsView }
										onChangeView={ onDataViewsChange }
										paginationInfo={ activePaginationInfo }
										defaultLayouts={ DEFAULT_LAYOUTS }
										getItemId={ ( item ) =>
											String( item.id )
										}
										isLoading={ isLoading }
										empty={ empty }
										actions={ dataViewActions }
										{ ...dataViewsSelectionProps }
									>
										<DataViewsChrome
											footer={ dataViewsFooter }
										/>
									</DataViews>
									{ isGridLayout && (
										<GridNewRowPortal
											wrapperRef={ tableWrapperRef }
											collectionId={ collectionId }
											view={ dataViewsView }
											fields={ fields }
											onCreated={ onCreated }
											hasRows={ dataFiltered.length > 0 }
										/>
									) }
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
											onFieldFormatSaved={
												updateFieldFormat
											}
											onFieldCreated={
												requestRevealCreatedField
											}
											onRowsChanged={ refresh }
										/>
									) }
									{ /* tech-debt.md#7: table/list render New just
									   outside DataViews because there is no append
									   slot in the layout chrome. */ }
									{ ! isGridLayout && (
										<div
											className={
												'cortext-data-view__footer' +
												( isListLayout
													? ' cortext-data-view__footer--list'
													: '' )
											}
										>
											<DataViewNewRowButton
												collectionId={ collectionId }
												view={ view }
												fields={ fields }
												onCreated={ onCreated }
												presentation={
													isListLayout
														? 'list-row'
														: 'footer'
												}
											/>
										</div>
									) }
								</>
							) }
						</div>
					</div>
				</OpenRowActionContext.Provider>
			</RowMutationContext.Provider>
		</CurrentViewModeProvider>
	);
}
