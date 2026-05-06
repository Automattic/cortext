import apiFetch from '@wordpress/api-fetch';
import { Button, Notice } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { useNavigate, useSearch } from '@wordpress/route';

import DataViewColumnInteractions from './DataViewColumnInteractions';
import EditableCell, { RowMutationContext } from './EditableCell';
import TableCalculationsFooter from './TableCalculationsFooter';
import ColumnHeaderActions from './fields/ColumnHeaderActions';
import RowDetailView, { ROW_DETAIL_MODE_ICONS } from './RowDetailView';
import { RowFullEditorContext } from './RowFullEditorContext';
import { RowDetailSidebar } from './RowDetailSidebarSlot';
import {
	GHOST_FIELD_ID,
	TITLE_FIELD_ID,
	normalizeView,
} from './dataViewColumns';
import {
	adjacentRowId,
	getRowDetailMode,
	withRowDetailMode,
} from './rowDetailUtils';
import useCollectionFields from '../hooks/useCollectionFields';
import useCollectionRows from '../hooks/useCollectionRows';
import { elementsFromOptions } from '../hooks/optionElements';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };
const TITLE_LABEL = __( 'Title', 'cortext' );
const ROW_SEARCH_KEY = 'row';
const ROW_COLLECTION_SEARCH_KEY = 'rowCollection';
const ROW_DETAIL_SIDE_SURFACE_EXIT_MS = 300;
const ROW_DETAIL_MODAL_ENTER_MS = 200;
const ROW_DETAIL_SIDE_TO_MODAL_HANDOFF_MS =
	ROW_DETAIL_SIDE_SURFACE_EXIT_MS - ROW_DETAIL_MODAL_ENTER_MS;

function parseSearchId( value ) {
	if ( Array.isArray( value ) ) {
		return parseSearchId( value[ 0 ] );
	}
	const id = Number.parseInt( String( value ).replaceAll( '"', '' ), 10 );
	return Number.isFinite( id ) && id > 0 ? id : null;
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
	label: TITLE_LABEL,
	header: (
		<span className="cortext-column-header-label">{ TITLE_LABEL }</span>
	),
	// Prefer `title.raw` over `title.rendered` so sort comparisons use
	// the unfiltered string (the_title encodes `&` as `&#038;`, which
	// would otherwise sort under that literal entity). Same reason as
	// `mapField`'s label fallback in `src/hooks/fieldMapping.js`.
	getValue: ( { item } ) => item?.title?.raw ?? item?.title?.rendered ?? '',
	render: ( { item } ) => <TitleCell item={ item } />,
	editable: true,
	cortextType: 'title',
	enableGlobalSearch: true,
	// The title column can't be hidden (it's the row identity), but it
	// reorders and resizes like any other column. `normalizeView` re-adds
	// the id to `view.fields` if something corrupts the saved state.
	enableHiding: false,
};

// Synthetic "ghost column" rendered at the right edge of the table layout.
// Its `header` carries an aria-hidden marker that `ColumnHeaderActions`
// portals a `+` button into; the row cells render `null`, leaving an
// empty column that visually echoes Notion's "add column" affordance.
// Pinned visible (and last) by the view-sync effect when
// `view.type === 'table'`, dropped from `view.fields` for grid/list.
const GHOST_FIELD = {
	id: GHOST_FIELD_ID,
	type: 'text',
	cortextType: 'ghost',
	label: '',
	enableSorting: false,
	enableHiding: false,
	editable: false,
	getValue: () => '',
	render: () => (
		<span className="cortext-data-view__ghost-cell" aria-hidden="true" />
	),
	header: (
		<span
			className="cortext-column-header-marker cortext-column-header-marker--add"
			data-cortext-add-field-marker="true"
			aria-hidden="true"
		/>
	),
};

// Pulls a "single equality" prefill out of the active filters: only filters
// whose operator is `is` (or its alias `equals`) and whose value is a single
// scalar contribute. Multi-value operators (`isAny`, `isNone`, …) are skipped
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
		if ( op !== 'is' && op !== 'equals' ) {
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

	const fieldIds = useMemo(
		() => new Set( fields.map( ( f ) => f.id ) ),
		[ fields ]
	);

	const onClick = useCallback( async () => {
		setIsCreating( true );
		setError( null );
		const meta = prefillFromFilters( view?.filters, fieldIds );
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
	}, [ slug, view, fieldIds, onCreated ] );

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
	const routeSearch = useSearch( { strict: false } );
	const { fields, collection, slug, isResolving, fieldsResolved } =
		useCollectionFields( collectionId );
	const routeRowId = parseSearchId( routeSearch?.[ ROW_SEARCH_KEY ] );
	const routeRowCollectionId = parseSearchId(
		routeSearch?.[ ROW_COLLECTION_SEARCH_KEY ]
	);

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
		const nextFilters = currentFilters.filter( ( filter ) =>
			validIds.has( filter.field )
		);
		if ( nextFilters.length !== currentFilters.length ) {
			return { ...view, filters: nextFilters };
		}
		return view;
	}, [ view, availableFields, isResolving ] );

	const {
		data,
		paginationInfo,
		isLoading,
		hasResolved: rowsResolved,
		error: rowError,
		refresh,
	} = useCollectionRows( isResolving ? null : collectionId, reconciledView );

	const isTableLayout = view?.type === 'table';
	const dataViewFields = useMemo(
		() =>
			isTableLayout
				? [ ...availableFields, GHOST_FIELD ]
				: availableFields,
		[ availableFields, isTableLayout ]
	);

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
			return filterSortAndPaginate( data, view, availableFields );
		}, [ data, view, availableFields ] );
	const { data: dataFilteredForCalculations } = useMemo( () => {
		const calculationView = { ...( view ?? {} ) };
		// tech-debt.md#36: summaries need the filtered row set before
		// pagination, which DataViews does not expose as a separate result.
		delete calculationView.page;
		delete calculationView.perPage;
		return filterSortAndPaginate( data, calculationView, availableFields );
	}, [ data, view, availableFields ] );

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
			refresh();
			return updated;
		},
		[ collectionId, refresh ]
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
				const expectedTotal = ( paginationInfo?.totalItems ?? 0 ) + 1;
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
				setEditRequest( { rowId: created.id, fieldId: 'title' } );
			}
		},
		[ refresh, view, paginationInfo, onChangeView ]
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
	const { clearSuppressedRouteRow, openRowFull, suppressedRouteRow } =
		useContext( RowFullEditorContext );
	const detailApiRef = useRef( null );
	const [ openRowId, setOpenRowId ] = useState( null );
	const openRowIdRef = useRef( openRowId );
	openRowIdRef.current = openRowId;
	const [ fullRowId, setFullRowId ] = useState( null );
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
	const updateRouteRow = useCallback(
		( rowId, options = {} ) => {
			if ( ! collectionId || ! rowId ) {
				return;
			}
			navigate( {
				search: ( current ) => ( {
					...( current ?? {} ),
					[ ROW_COLLECTION_SEARCH_KEY ]: collectionId,
					[ ROW_SEARCH_KEY ]: rowId,
				} ),
				replace: options.replace ?? false,
			} );
		},
		[ collectionId, navigate ]
	);
	const clearRouteRow = useCallback(
		( options = {} ) => {
			navigate( {
				search: ( current ) => {
					const next = { ...( current ?? {} ) };
					delete next[ ROW_COLLECTION_SEARCH_KEY ];
					delete next[ ROW_SEARCH_KEY ];
					return next;
				},
				replace: options.replace ?? true,
			} );
		},
		[ navigate ]
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
			if ( ! openRowFull || ! postType || ! rowId ) {
				return false;
			}
			setOpenRowId( rowId );
			setFullRowId( rowId );
			openRowFull( {
				collectionId,
				postType,
				rowId,
				onClose: () => {
					setOpenRowId( null );
					setFullRowId( null );
					setDetailSaveError( null );
					setPendingDetailTransition( null );
					clearRouteRow( { replace: true } );
					refresh();
				},
				onModeChange: ( mode, nextRowId ) => {
					setOpenRowId( nextRowId );
					setFullRowId( null );
					setDetailSaveError( null );
					setPendingDetailTransition( null );
					onChangeViewRef.current(
						withRowDetailMode( viewRef.current, mode )
					);
					refresh();
				},
				onSaved: refresh,
			} );
			return true;
		},
		[ clearRouteRow, collectionId, openRowFull, postType, refresh ]
	);

	const applyDetailTransition = useCallback(
		( transition, options = {} ) => {
			setDetailSaveError( null );
			setPendingDetailTransition( null );

			if ( transition.type === 'close' ) {
				clearModeSurfaceTransition();
				setOpenRowId( null );
				setFullRowId( null );
				if ( transition.syncUrl !== false ) {
					clearRouteRow( { replace: true } );
				}
			} else if ( transition.type === 'row' ) {
				clearModeSurfaceTransition();
				setOpenRowId( transition.rowId );
				setFullRowId( null );
				if ( transition.syncUrl !== false ) {
					updateRouteRow( transition.rowId, {
						replace: ! transition.pushUrl,
					} );
				}
			} else if ( transition.type === 'mode' ) {
				setFullRowId( null );
				onChangeViewRef.current(
					withRowDetailMode( viewRef.current, transition.mode )
				);
			} else if ( transition.type === 'full' ) {
				clearModeSurfaceTransition();
				if ( transition.syncUrl !== false ) {
					updateRouteRow( transition.rowId, {
						replace: ! transition.pushUrl,
					} );
				}
				openFullRow( transition.rowId );
			}
			if ( options.refreshRows ) {
				refresh();
			}
		},
		[
			clearModeSurfaceTransition,
			clearRouteRow,
			openFullRow,
			refresh,
			updateRouteRow,
		]
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
			runDetailTransition( {
				type: rowDetailMode === 'full' ? 'full' : 'row',
				rowId: row.id,
				pushUrl: ! openRowId,
			} );
		},
		[ openRowId, rowDetailMode, runDetailTransition ]
	);

	const openRowActionContext = useMemo(
		() => ( {
			enabled: isTableLayout,
			icon: ROW_DETAIL_MODE_ICONS[ rowDetailMode ],
			openRowId,
			requestOpenRow,
		} ),
		[ isTableLayout, openRowId, requestOpenRow, rowDetailMode ]
	);

	const rowActions = useMemo(
		() => [
			{
				id: 'open-row',
				label: __( 'Open row', 'cortext' ),
				icon: ROW_DETAIL_MODE_ICONS[ rowDetailMode ],
				isPrimary: true,
				context: 'single',
				callback: ( items ) => requestOpenRow( items?.[ 0 ] ),
			},
		],
		[ requestOpenRow, rowDetailMode ]
	);

	const dataViewActions = useMemo(
		() => ( isTableLayout ? undefined : rowActions ),
		[ isTableLayout, rowActions ]
	);

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
		setFullRowId( null );
		setDetailSaveError( null );
		setPendingDetailTransition( null );
		detailApiRef.current = null;
	}, [ clearModeSurfaceTransition, collectionId ] );

	useEffect( () => {
		const routeTargetsThisCollection =
			routeRowId &&
			routeRowCollectionId &&
			String( routeRowCollectionId ) === String( collectionId );

		if ( ! routeTargetsThisCollection ) {
			clearSuppressedRouteRow?.();
			if ( openRowIdRef.current ) {
				runDetailTransition( { type: 'close', syncUrl: false } );
			}
			return;
		}

		if (
			String( suppressedRouteRow?.collectionId ) ===
				String( collectionId ) &&
			String( suppressedRouteRow?.rowId ) === String( routeRowId )
		) {
			return;
		}

		if ( String( openRowIdRef.current ) === String( routeRowId ) ) {
			return;
		}

		runDetailTransition( {
			type: rowDetailMode === 'full' ? 'full' : 'row',
			rowId: routeRowId,
			syncUrl: false,
		} );
	}, [
		collectionId,
		clearSuppressedRouteRow,
		routeRowCollectionId,
		routeRowId,
		rowDetailMode,
		runDetailTransition,
		suppressedRouteRow,
	] );

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
			// Default to editable columns only: read-only types like formula
			// do not accept inline saves and can be enabled via the View config.
			seededView = {
				...currentView,
				fields: availableFields
					.filter( ( f ) => f.editable )
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
					! f.editable ||
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

		// Pin the ghost "+ add field" column last whenever the table
		// layout is active. In grid/list layouts the synthetic field
		// isn't part of `availableFields`, so `normalizeView` already
		// dropped any stale reference.
		if ( isTableLayout ) {
			const stripped = ( normalized.fields ?? [] ).filter(
				( id ) => id !== GHOST_FIELD_ID
			);
			const nextFields = [ ...stripped, GHOST_FIELD_ID ];
			const fieldsChanged =
				nextFields.length !== ( normalized.fields ?? [] ).length ||
				nextFields.some(
					( id, i ) => id !== ( normalized.fields ?? [] )[ i ]
				);
			if ( fieldsChanged ) {
				normalized = { ...normalized, fields: nextFields };
			}
		}

		knownFieldIdsRef.current = validIds;

		const currentSort = normalized.sort ?? null;
		const nextSort =
			currentSort && validIds.has( currentSort.field )
				? currentSort
				: null;

		const currentFilters = normalized.filters ?? [];
		const nextFilters = currentFilters.filter( ( filter ) =>
			validIds.has( filter.field )
		);

		const sortChanged = currentSort !== nextSort;
		const filtersChanged = currentFilters.length !== nextFilters.length;
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

	const isFullDetail = Boolean( fullRowId );
	const previousRowId = adjacentRowId( dataFiltered, openRowId, -1 );
	const nextRowId = adjacentRowId( dataFiltered, openRowId, 1 );
	let detailSurface = null;

	if ( openRowId && postType && ! isFullDetail && renderedRowDetailMode ) {
		const detailView = (
			<RowDetailView
				canGoNext={ Boolean( nextRowId ) }
				canGoPrevious={ Boolean( previousRowId ) }
				fields={ availableFields }
				mode={ renderedRowDetailMode }
				onApi={ setDetailApi }
				onClose={ requestCloseDetail }
				onDiscardPending={ discardPendingDetailTransition }
				onModeChange={ requestDetailMode }
				onNext={ () => requestAdjacentRow( 1 ) }
				onPrevious={ () => requestAdjacentRow( -1 ) }
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
					{ ! isFullDetail && (
						<div
							className="cortext-data-view"
							ref={ tableWrapperRef }
						>
							<DataViews
								data={ dataFiltered }
								fields={ dataViewFields }
								view={ view }
								onChangeView={ onChangeView }
								paginationInfo={ clientPaginationInfo }
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
					) }
					{ detailSurface }
				</div>
			</OpenRowActionContext.Provider>
		</RowMutationContext.Provider>
	);
}
