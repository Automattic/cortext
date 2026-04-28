import { DataViews } from '@wordpress/dataviews';
import { useEffect, useMemo, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import useCollectionFields from '../hooks/useCollectionFields';
import useCollectionRows from '../hooks/useCollectionRows';

const DEFAULT_LAYOUTS = { table: {}, grid: {}, list: {} };
const TITLE_FIELD = {
	id: 'title',
	label: __( 'Title', 'cortext' ),
	getValue: ( { item } ) => item?.title?.rendered ?? item?.title?.raw ?? '',
};

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
	} = useCollectionRows( slug, view );
	const dataViewFields = useMemo(
		() => [ TITLE_FIELD, ...fields ],
		[ fields ]
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
			nextFields = dataViewFields.map( ( f ) => f.id );
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
		<DataViews
			data={ data }
			fields={ dataViewFields }
			view={ view }
			onChangeView={ onChangeView }
			paginationInfo={ paginationInfo }
			defaultLayouts={ DEFAULT_LAYOUTS }
			getItemId={ ( item ) => String( item.id ) }
			isLoading={ isLoading }
			empty={ empty }
		/>
	);
}
