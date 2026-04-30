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

import EditableCell, { RowMutationContext } from './EditableCell';
import useCollectionFields from '../hooks/useCollectionFields';
import useCollectionRows from '../hooks/useCollectionRows';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };

const TITLE_FIELD = {
	id: 'title',
	label: __( 'Title', 'cortext' ),
	getValue: ( { item } ) => item?.title?.rendered ?? item?.title?.raw ?? '',
	render: ( { item } ) => (
		<EditableCell
			item={ item }
			fieldId="title"
			fieldType="title"
			label={ __( 'Title', 'cortext' ) }
			getValue={ ( ctx ) =>
				ctx.item?.title?.raw ?? ctx.item?.title?.rendered ?? ''
			}
		/>
	),
	editable: true,
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
	const { fields, collection, slug, isResolving } =
		useCollectionFields( collectionId );
	const {
		data,
		paginationInfo,
		isLoading,
		error: rowError,
		refresh,
	} = useCollectionRows( collectionId, view );
	const dataViewFields = useMemo(
		() => [ TITLE_FIELD, ...fields ],
		[ fields ]
	);
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

	const { data: dataFiltered, paginationInfo: clientPaginationInfo } =
		useMemo( () => {
			return filterSortAndPaginate( data, view, dataViewFields );
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

	// Reconcile saved view state with the live schema whenever the field
	// set changes: drop visible columns, sort, and filters that reference
	// fields that no longer exist (so a deleted field doesn't ghost in the
	// saved attribute), pin Title visible, and seed defaults on first
	// render. Other view settings (perPage, search, layout) are left alone.
	useEffect( () => {
		if ( isResolving ) {
			return;
		}
		const validIds = new Set( dataViewFields.map( ( f ) => f.id ) );
		const currentView = viewRef.current;
		const currentFields = currentView?.fields ?? [];

		let nextFields;
		if ( currentFields.length === 0 ) {
			// Default to editable columns only: read-only types like
			// formula and rollup don't compute values yet, so showing
			// them out of the box is just noise. Users can re-enable
			// them via the View config.
			nextFields = dataViewFields
				.filter( ( f ) => f.editable )
				.map( ( f ) => f.id );
		} else {
			nextFields = currentFields.filter( ( id ) => validIds.has( id ) );
			if ( ! nextFields.includes( TITLE_FIELD.id ) ) {
				nextFields = [ TITLE_FIELD.id, ...nextFields ];
			}
		}

		const currentSort = currentView?.sort ?? null;
		const nextSort =
			currentSort && validIds.has( currentSort.field )
				? currentSort
				: null;

		const currentFilters = currentView?.filters ?? [];
		const nextFilters = currentFilters.filter( ( filter ) =>
			validIds.has( filter.field )
		);

		const fieldsChanged =
			currentFields.length !== nextFields.length ||
			currentFields.some( ( id, i ) => id !== nextFields[ i ] );
		const sortChanged = currentSort !== nextSort;
		const filtersChanged = currentFilters.length !== nextFilters.length;

		if ( fieldsChanged || sortChanged || filtersChanged ) {
			onChangeViewRef.current( {
				...currentView,
				fields: nextFields,
				sort: nextSort,
				filters: nextFilters,
			} );
		}
	}, [ dataViewFields, isResolving ] );

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
			<div className="cortext-data-view">
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
