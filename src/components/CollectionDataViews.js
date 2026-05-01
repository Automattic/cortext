import apiFetch from '@wordpress/api-fetch';
import { Button, Notice } from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';

import DataViewColumnInteractions from './DataViewColumnInteractions';
import EditableCell, { RowMutationContext } from './EditableCell';
import ColumnHeaderActions from './fields/ColumnHeaderActions';
import { TITLE_FIELD_ID, normalizeView } from './dataViewColumns';
import useCollectionFields from '../hooks/useCollectionFields';
import useCollectionRows from '../hooks/useCollectionRows';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };
const TITLE_LABEL = __( 'Title', 'cortext' );

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
	render: ( { item } ) => (
		<EditableCell
			item={ item }
			fieldId="title"
			fieldType="title"
			label={ TITLE_LABEL }
			getValue={ ( ctx ) =>
				ctx.item?.title?.raw ?? ctx.item?.title?.rendered ?? ''
			}
		/>
	),
	editable: true,
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
export const GHOST_FIELD_ID = '__add_field';
const GHOST_FIELD = {
	id: GHOST_FIELD_ID,
	type: 'text',
	label: '',
	enableSorting: false,
	enableHiding: false,
	editable: false,
	getValue: () => '',
	render: () => null,
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
} ) {
	const { fields, collection, slug, isResolving, fieldsResolved } =
		useCollectionFields( collectionId );
	const {
		data,
		paginationInfo,
		isLoading,
		error: rowError,
		refresh,
	} = useCollectionRows( collectionId, view );
	const isTableLayout = view?.type === 'table';
	const dataViewFields = useMemo( () => {
		const base = [ TITLE_FIELD, ...fields ];
		return isTableLayout ? [ ...base, GHOST_FIELD ] : base;
	}, [ fields, isTableLayout ] );
	const tableWrapperRef = useRef( null );
	// editRequest is the "open this cell for editing" channel: cells that
	// match its `{ rowId, fieldId }` flip to edit mode and clear it. Used
	// for both the title-cell auto-open on a fresh row and Tab-driven
	// navigation between cells.
	const [ editRequest, setEditRequest ] = useState( null );
	const clearEditRequest = useCallback( () => setEditRequest( null ), [] );

	// Editable, currently-visible columns in the order DataViews renders
	// them. Drives Tab/Shift+Tab cell-to-cell navigation. See
	// tech-debt.md#1: DataViews would own this if inline editing were
	// upstream, and this walker would go away.
	const editableVisibleFields = useMemo( () => {
		const order = view?.fields ?? [];
		const byId = new Map( dataViewFields.map( ( f ) => [ f.id, f ] ) );
		return order
			.map( ( id ) => byId.get( id ) )
			.filter( ( f ) => f && f.editable );
	}, [ dataViewFields, view?.fields ] );

	// Search is already handled server-side, so strip it from the view
	// before passing to filterSortAndPaginate. Without this, the client
	// re-filters against enableGlobalSearch (which no fields set), dropping
	// every row.
	const { data: dataFiltered, paginationInfo: clientPaginationInfo } =
		useMemo( () => {
			const { search, ...viewWithoutSearch } = view;
			return filterSortAndPaginate(
				data,
				viewWithoutSearch,
				dataViewFields
			);
		}, [ data, view, dataViewFields ] );

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
			if ( ! slug || ! rowId ) {
				return null;
			}
			const payload =
				fieldId === 'title'
					? { title: value ?? '' }
					: { meta: { [ fieldId ]: value } };
			// FIXME: Consider supporting row mutation via /cortext/v1/rows.
			const updated = await apiFetch( {
				path: `/wp/v2/crtxt_${ slug }/${ rowId }`,
				method: 'POST',
				data: payload,
			} );
			refresh();
			return updated;
		},
		[ slug, refresh ]
	);

	const mutationContext = useMemo(
		() => ( {
			saveRowField,
			editRequest,
			clearEditRequest,
			requestNext,
		} ),
		[ saveRowField, editRequest, clearEditRequest, requestNext ]
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
		const validIds = new Set( dataViewFields.map( ( f ) => f.id ) );
		const currentView = viewRef.current;
		const currentFields = currentView?.fields ?? [];
		const previouslyKnown = knownFieldIdsRef.current;

		let seededView = currentView;
		if ( currentFields.length === 0 ) {
			// Default to editable columns only: read-only types like
			// formula and rollup don't compute values yet, so showing
			// them out of the box is just noise. Users can re-enable
			// them via the View config.
			seededView = {
				...currentView,
				fields: dataViewFields
					.filter( ( f ) => f.editable )
					.map( ( f ) => f.id ),
			};
		}

		let normalized = normalizeView( seededView, validIds );

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
				schemaIdx < dataViewFields.length;
				schemaIdx++
			) {
				const f = dataViewFields[ schemaIdx ];
				if (
					! f.editable ||
					previouslyKnown.has( f.id ) ||
					next.includes( f.id )
				) {
					continue;
				}
				let insertAt = next.length;
				for ( let i = schemaIdx - 1; i >= 0; i-- ) {
					const idx = next.indexOf( dataViewFields[ i ].id );
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
		// is absent from `dataViewFields`, so `normalizeView` dropped
		// any stale reference already.
		if ( validIds.has( GHOST_FIELD_ID ) ) {
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
	}, [ dataViewFields, isResolving, fieldsResolved ] );

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

	return (
		<RowMutationContext.Provider value={ mutationContext }>
			<div className="cortext-data-view" ref={ tableWrapperRef }>
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
				/>
				{ isTableLayout && (
					<DataViewColumnInteractions
						wrapperRef={ tableWrapperRef }
						view={ view }
						fields={ dataViewFields }
						onChangeView={ onChangeView }
					/>
				) }
				{ isTableLayout && (
					<ColumnHeaderActions collectionId={ collectionId } />
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
		</RowMutationContext.Provider>
	);
}
