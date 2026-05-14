import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Notice,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { copy, plus, trash } from '@wordpress/icons';
import { useNavigate } from '@wordpress/route';
import { addQueryArgs } from '@wordpress/url';

import DataViewColumnInteractions from './DataViewColumnInteractions';
import EditableCell, { RowMutationContext } from './EditableCell';
import PageIcon from './PageIcon';
import { filterSortAndPaginateWithGroups } from './groupedFilters';
import TableCalculationsFooter from './TableCalculationsFooter';
import ColumnHeaderActions from './fields/ColumnHeaderActions';
import RowDetailView, {
	ROW_DETAIL_MODE_ICONS,
	ROW_DETAIL_MODE_LABELS,
} from './RowDetailView';
import { RowDetailSidebar } from './RowDetailSidebarSlot';
import {
	GHOST_FIELD_ID,
	TITLE_FIELD_ID,
	isDefaultVisibleField,
	normalizeView,
	pruneFiltersForFields,
} from './dataViewColumns';
import {
	adjacentRowId,
	getRowDetailMode,
	withRowDetailMode,
} from './rowDetailUtils';
import { useCollectionFieldsContext } from './CollectionFieldsContext';
import { dataViewsFilterByForType } from '../hooks/fieldMapping';
import useCollectionRows from '../hooks/useCollectionRows';
import { useRecents } from '../hooks/useRecents';
import { elementsFromOptions } from '../hooks/optionElements';
import { computeDocumentUri } from '../router/useResolveEntity';

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
const ROW_DETAIL_SIDE_SURFACE_EXIT_MS = 300;
const ROW_DETAIL_MODAL_ENTER_MS = 200;
const ROW_DETAIL_SIDE_TO_MODAL_HANDOFF_MS =
	ROW_DETAIL_SIDE_SURFACE_EXIT_MS - ROW_DETAIL_MODAL_ENTER_MS;

function hasActiveCalculations( view ) {
	return Object.values( view?.calculations ?? {} ).some( Boolean );
}

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

const OpenRowActionContext = createContext( {
	enabled: false,
	icon: ROW_DETAIL_MODE_ICONS.side,
	openRowId: null,
	requestOpenRow: null,
} );

function TitleCell( { item } ) {
	const { enabled, icon, openRowId, requestOpenRow } =
		useContext( OpenRowActionContext );
	const canOpenRow = Boolean( enabled && requestOpenRow );
	const isOpenRow = canOpenRow && String( item?.id ) === String( openRowId );
	const documentIcon = item?.meta?.cortext_document_icon ?? '';
	const openRow = useCallback(
		( event ) => {
			event.preventDefault();
			event.stopPropagation();
			requestOpenRow?.( item );
		},
		[ item, requestOpenRow ]
	);
	const stopPropagation = useCallback( ( event ) => {
		event.stopPropagation();
	}, [] );

	return (
		<div
			className={
				'cortext-title-cell' +
				( canOpenRow ? ' cortext-title-cell--with-open-action' : '' ) +
				( isOpenRow ? ' cortext-title-cell--is-open' : '' )
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

export default function CollectionDataViews( {
	collectionId,
	view,
	onChangeView,
	loading = null,
	empty,
	invalid,
	error,
	onReady,
} ) {
	const navigate = useNavigate();
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
		queryMode,
	} = useCollectionRows(
		isResolving ? null : collectionId,
		reconciledView,
		availableFields,
		{ forceClient: hasActiveCalculations( reconciledView ) }
	);

	const isTableLayout = view?.type === 'table';
	const isServerPaginated = queryMode === 'server';
	const dataViewFields = availableFields;

	const tableWrapperRef = useRef( null );
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
			// Without an explicit sort, the row list comes back oldest-first
			// (see useCollectionRows), so the new row lives on the last page.
			// Hop there before refreshing so the user lands on their row
			// instead of page 1. Under a user-chosen sort the new row could
			// be anywhere; refresh in place and let them find it.
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
	const rowDetailMode =
		savedRowDetailMode === 'full' ? 'side' : savedRowDetailMode;
	const postType = slug ? `crtxt_${ slug }` : null;
	const detailApiRef = useRef( null );
	const [ openRowId, setOpenRowId ] = useState( null );
	const [ detailSaveError, setDetailSaveError ] = useState( null );
	const [ pendingDetailTransition, setPendingDetailTransition ] =
		useState( null );
	const [ modeSurfaceTransition, setModeSurfaceTransition ] =
		useState( null );
	const modeSurfaceTransitionTimeoutRef = useRef( null );
	const renderedRowDetailMode =
		modeSurfaceTransition !== null
			? modeSurfaceTransition.surfaceMode
			: rowDetailMode;
	const setDetailApi = useCallback( ( api ) => {
		detailApiRef.current = api;
	}, [] );
	const clearModeSurfaceTransition = useCallback( () => {
		if ( modeSurfaceTransitionTimeoutRef.current ) {
			clearTimeout( modeSurfaceTransitionTimeoutRef.current );
			modeSurfaceTransitionTimeoutRef.current = null;
		}
		setModeSurfaceTransition( null );
	}, [] );
	useEffect(
		() => () => {
			if ( modeSurfaceTransitionTimeoutRef.current ) {
				clearTimeout( modeSurfaceTransitionTimeoutRef.current );
			}
		},
		[]
	);
	const navigateToFullRow = useCallback(
		( rowId ) => {
			if ( ! rowId ) {
				return;
			}
			// Full mode is the only row state that lives in the URL. Side
			// and modal panes are local React state. `computeDocumentUri`
			// gives pages and rows the same URL shape; the post type is
			// resolved via the document locator on the way in.
			const targetRow =
				dataFiltered.find(
					( candidate ) => String( candidate.id ) === String( rowId )
				) ??
				data.find(
					( candidate ) => String( candidate.id ) === String( rowId )
				) ??
				null;
			const splatPath = computeDocumentUri(
				targetRow ?? { id: rowId, slug: '' }
			);
			navigate( {
				to: '/$',
				params: { _splat: splatPath },
			} );
		},
		[ data, dataFiltered, navigate ]
	);

	const openRow = useMemo( () => {
		if ( ! openRowId ) {
			return null;
		}
		const id = String( openRowId );
		return (
			dataFiltered.find( ( row ) => String( row.id ) === id ) ??
			data.find( ( row ) => String( row.id ) === id ) ??
			null
		);
	}, [ data, dataFiltered, openRowId ] );

	const openFullRow = useCallback(
		( rowId ) => {
			if ( ! rowId ) {
				return false;
			}
			navigateToFullRow( rowId );
			return true;
		},
		[ navigateToFullRow ]
	);

	const applyDetailTransition = useCallback(
		( transition, options = {} ) => {
			setDetailSaveError( null );
			setPendingDetailTransition( null );

			if ( transition.type === 'close' ) {
				clearModeSurfaceTransition();
				setOpenRowId( null );
			} else if ( transition.type === 'row' ) {
				clearModeSurfaceTransition();
				setOpenRowId( transition.rowId );
			} else if ( transition.type === 'mode' ) {
				onChangeViewRef.current(
					withRowDetailMode( viewRef.current, transition.mode )
				);
			} else if ( transition.type === 'full' ) {
				// Route change to a document URL; clear the local pane
				// state so it doesn't flash on the way out.
				clearModeSurfaceTransition();
				setOpenRowId( null );
				openFullRow( transition.rowId );
			}
			if ( options.refreshRows ) {
				refresh();
			}
		},
		[ clearModeSurfaceTransition, openFullRow, refresh ]
	);

	const runDetailTransition = useCallback(
		async ( transition, options = {} ) => {
			const api = detailApiRef.current;
			setDetailSaveError( null );

			if ( options.discard ) {
				api?.discard?.();
				applyDetailTransition( transition, { refreshRows: true } );
				return true;
			}

			let shouldRefreshRows = false;
			if ( api?.flushNow ) {
				shouldRefreshRows = api.hasPendingEdits?.() ?? true;
				const didSave = await api.flushNow();
				if ( ! didSave ) {
					setPendingDetailTransition( transition );
					setDetailSaveError(
						__(
							'Row changes could not be saved. Retry or discard the pending edits to continue.',
							'cortext'
						)
					);
					return false;
				}
			}

			applyDetailTransition( transition, {
				refreshRows: shouldRefreshRows,
			} );
			return true;
		},
		[ applyDetailTransition ]
	);

	const requestOpenRow = useCallback(
		( row ) => {
			if ( ! row?.id ) {
				return;
			}
			if ( String( row.id ) === String( openRowId ) ) {
				return;
			}
			runDetailTransition( {
				type: savedRowDetailMode === 'full' ? 'full' : 'row',
				rowId: row.id,
			} );
		},
		[ openRowId, runDetailTransition, savedRowDetailMode ]
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

	const [ pendingDeleteRow, setPendingDeleteRow ] = useState( null );
	const [ rowActionError, setRowActionError ] = useState( null );

	const openRowInMode = useCallback(
		( row, mode ) => {
			if ( ! row?.id ) {
				return;
			}
			if ( mode === 'full' ) {
				runDetailTransition( { type: 'full', rowId: row.id } );
				return;
			}
			// Store the chosen side/modal mode before opening. This matches
			// the in-detail mode toggle: an explicit choice updates the
			// user's preference.
			if ( savedRowDetailMode !== mode ) {
				onChangeView( withRowDetailMode( view, mode ) );
			}
			runDetailTransition( { type: 'row', rowId: row.id } );
		},
		[ onChangeView, runDetailTransition, savedRowDetailMode, view ]
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

	const requestDeleteRow = useCallback( ( row ) => {
		if ( ! row?.id ) {
			return;
		}
		setRowActionError( null );
		setPendingDeleteRow( row );
	}, [] );

	const cancelDeleteRow = useCallback( () => {
		setPendingDeleteRow( null );
	}, [] );

	const confirmDeleteRow = useCallback( async () => {
		const row = pendingDeleteRow;
		setPendingDeleteRow( null );
		if ( ! row?.id || ! postType ) {
			return;
		}
		try {
			await apiFetch( {
				path: addQueryArgs( `/wp/v2/${ postType }/${ row.id }`, {
					force: true,
				} ),
				method: 'DELETE',
			} );
			if ( String( row.id ) === String( openRowId ) ) {
				runDetailTransition( { type: 'close' } );
			}
			refresh();
		} catch ( apiError ) {
			setRowActionError(
				apiError?.message ?? __( 'Could not delete row.', 'cortext' )
			);
		}
	}, [
		openRowId,
		pendingDeleteRow,
		postType,
		refresh,
		runDetailTransition,
	] );

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
			label: __( 'Delete', 'cortext' ),
			icon: trash,
			isDestructive: true,
			context: 'single',
			callback: ( items ) => requestDeleteRow( items?.[ 0 ] ),
		} );
		return actions;
	}, [
		duplicateRow,
		isTableLayout,
		openRowInMode,
		requestDeleteRow,
		savedRowDetailMode,
	] );

	const dataViewActions = rowActions;

	const requestCloseDetail = useCallback(
		() => runDetailTransition( { type: 'close' } ),
		[ runDetailTransition ]
	);

	const requestAdjacentRow = useCallback(
		( direction ) => {
			const rowId = adjacentRowId( dataFiltered, openRowId, direction );
			if ( rowId ) {
				runDetailTransition( { type: 'row', rowId } );
			}
		},
		[ dataFiltered, openRowId, runDetailTransition ]
	);

	const requestDetailMode = useCallback(
		async ( mode ) => {
			if ( mode === 'full' && openRowId ) {
				clearModeSurfaceTransition();
				runDetailTransition( { type: 'full', rowId: openRowId } );
			} else if ( mode !== rowDetailMode ) {
				if (
					rowDetailMode === 'side' &&
					mode === 'modal' &&
					openRowId &&
					! prefersReducedMotion()
				) {
					setModeSurfaceTransition( {
						surfaceMode: 'side',
					} );
					const didSwitch = await runDetailTransition( {
						type: 'mode',
						mode,
					} );
					if ( ! didSwitch ) {
						clearModeSurfaceTransition();
						return;
					}
					setModeSurfaceTransition( {
						surfaceMode: null,
					} );
					modeSurfaceTransitionTimeoutRef.current = setTimeout(
						() => {
							modeSurfaceTransitionTimeoutRef.current = null;
							setModeSurfaceTransition( null );
						},
						ROW_DETAIL_SIDE_TO_MODAL_HANDOFF_MS
					);
					return;
				}

				clearModeSurfaceTransition();
				runDetailTransition( { type: 'mode', mode } );
			}
		},
		[
			clearModeSurfaceTransition,
			openRowId,
			rowDetailMode,
			runDetailTransition,
		]
	);

	const retryPendingDetailTransition = useCallback( () => {
		if ( pendingDetailTransition ) {
			runDetailTransition( pendingDetailTransition );
		}
	}, [ pendingDetailTransition, runDetailTransition ] );

	const discardPendingDetailTransition = useCallback( () => {
		if ( pendingDetailTransition ) {
			runDetailTransition( pendingDetailTransition, { discard: true } );
		}
	}, [ pendingDetailTransition, runDetailTransition ] );

	useEffect( () => {
		clearModeSurfaceTransition();
		setOpenRowId( null );
		setDetailSaveError( null );
		setPendingDetailTransition( null );
		detailApiRef.current = null;
	}, [ clearModeSurfaceTransition, collectionId ] );

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

		// Splice any editable field that just appeared in the schema
		// (wasn't present on the previous sync) into its schema position
		// in `view.fields`. The first render — `previouslyKnown` is
		// `null` — leaves saved views alone; from then on, the diff
		// detects fields the user just created via toolbar Add field
		// or duplicate. Honors user-driven hides because the toggled-off
		// field IS in `previouslyKnown` and gets skipped here. Inserting
		// at the schema position (rather than appending) keeps a
		// duplicated field next to its source instead of jumping to the
		// end of the visible columns.
		if ( previouslyKnown && currentFields.length > 0 ) {
			const next = [ ...( normalized.fields ?? [] ) ];
			let inserted = false;
			for (
				let schemaIdx = 0;
				schemaIdx < availableFields.length;
				schemaIdx++
			) {
				const f = availableFields[ schemaIdx ];
				if (
					! isDefaultVisibleField( f ) ||
					previouslyKnown.has( f.id ) ||
					next.includes( f.id )
				) {
					continue;
				}
				let insertAt = next.length;
				for ( let i = schemaIdx - 1; i >= 0; i-- ) {
					const idx = next.indexOf( availableFields[ i ].id );
					if ( idx >= 0 ) {
						insertAt = idx + 1;
						break;
					}
				}
				next.splice( insertAt, 0, f.id );
				inserted = true;
			}
			if ( inserted ) {
				normalized = { ...normalized, fields: next };
			}
		}

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
			currentSort && validIds.has( currentSort.field )
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
	}, [ availableFields, isTableLayout, isResolving, fieldsResolved ] );

	useEffect( () => {
		if ( ! isResolving && rowsResolved ) {
			onReady?.( collectionId );
		}
	}, [ collectionId, isResolving, rowsResolved, onReady ] );

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

	if ( isResolving ) {
		return loading;
	}

	if ( collectionId && ! collection ) {
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

	if ( rowError ) {
		return (
			error ?? (
				<p>
					{ __( 'Collection rows could not be loaded.', 'cortext' ) }
				</p>
			)
		);
	}

	const previousRowId = adjacentRowId( dataFiltered, openRowId, -1 );
	const nextRowId = adjacentRowId( dataFiltered, openRowId, 1 );
	let detailSurface = null;

	if ( openRowId && postType && renderedRowDetailMode ) {
		const detailView = (
			<RowDetailView
				canGoNext={ Boolean( nextRowId ) }
				canGoPrevious={ Boolean( previousRowId ) }
				collectionId={ collectionId }
				fields={ availableFields }
				mode={ renderedRowDetailMode }
				onApi={ setDetailApi }
				onClose={ requestCloseDetail }
				onDiscardPending={ discardPendingDetailTransition }
				onModeChange={ requestDetailMode }
				onNext={ () => requestAdjacentRow( 1 ) }
				onPrevious={ () => requestAdjacentRow( -1 ) }
				onRestored={ refresh }
				onRetryPending={ retryPendingDetailTransition }
				onSaved={ refresh }
				postType={ postType }
				row={ openRow }
				rowId={ openRowId }
				saveError={ detailSaveError }
			/>
		);
		detailSurface =
			renderedRowDetailMode === 'side' ? (
				<RowDetailSidebar.Fill>{ detailView }</RowDetailSidebar.Fill>
			) : (
				detailView
			);
	}

	return (
		<RowMutationContext.Provider value={ mutationContext }>
			<OpenRowActionContext.Provider value={ openRowActionContext }>
				<div
					className="cortext-data-view-shell"
					data-row-detail-mode={ rowDetailMode }
					data-row-detail-open={ openRowId ? 'true' : 'false' }
				>
					<div className="cortext-data-view" ref={ tableWrapperRef }>
						{ rowActionError && (
							<Notice
								status="error"
								isDismissible
								onRemove={ () => setRowActionError( null ) }
							>
								{ rowActionError }
							</Notice>
						) }
						<DataViews
							data={ dataFiltered }
							fields={ dataViewFields }
							view={ view }
							onChangeView={ onChangeView }
							paginationInfo={ activePaginationInfo }
							defaultLayouts={ DEFAULT_LAYOUTS }
							getItemId={ ( item ) => String( item.id ) }
							isLoading={ isLoading }
							empty={ empty }
							actions={ dataViewActions }
						/>
						{ isTableLayout && (
							<TableCalculationsFooter
								wrapperRef={ tableWrapperRef }
								view={ view }
								fields={ availableFields }
								data={ dataFilteredForCalculations }
								onChangeView={ onChangeView }
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
								onFieldOptionsSaved={ updateFieldOptions }
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
					</div>
					{ detailSurface }
				</div>
				{ pendingDeleteRow && (
					<ConfirmDialog
						onConfirm={ confirmDeleteRow }
						onCancel={ cancelDeleteRow }
						confirmButtonText={ __( 'Delete', 'cortext' ) }
					>
						{ sprintf(
							/* translators: %s: row title. */
							__(
								'Delete "%s"? This cannot be undone.',
								'cortext'
							),
							pendingDeleteRow?.title?.rendered ||
								pendingDeleteRow?.title?.raw ||
								__( '(untitled)', 'cortext' )
						) }
					</ConfirmDialog>
				) }
			</OpenRowActionContext.Provider>
		</RowMutationContext.Provider>
	);
}
