import { useState, useMemo, useCallback } from '@wordpress/element';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';

import usePublicRows from '../hooks/usePublicRows';
import { buildPublicFields } from '../hooks/publicFieldMapping';
import { normalizeView } from './dataViewColumns';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };

export default function PublicDataView( { collectionId, view: initialView } ) {
	const [ view, setView ] = useState( () => ( {
		type: 'table',
		perPage: 25,
		page: 1,
		search: '',
		fields: [],
		sort: {},
		filters: [],
		layout: {},
		...initialView,
	} ) );

	const {
		data,
		fields: fieldDefs,
		isLoading,
	} = usePublicRows( collectionId, view );

	const fields = useMemo(
		() => buildPublicFields( fieldDefs ),
		[ fieldDefs ]
	);

	// Reconcile view.fields against the live field set: drop stale IDs
	// and pin title first. When view.fields is empty (no saved field
	// order), seed it with every available field so DataViews' reorder
	// and hide/show controls have a complete list to work from. Skip
	// reconciliation while the REST response is in flight — the field
	// list is incomplete then and seeding against it would lock out
	// fields that arrive later.
	const reconciledView = useMemo( () => {
		if ( isLoading || fieldDefs.length === 0 ) {
			return view;
		}
		const validIds = new Set( fields.map( ( f ) => f.id ) );
		const seeded =
			view.fields.length === 0
				? { ...view, fields: fields.map( ( f ) => f.id ) }
				: view;
		return normalizeView( seeded, validIds );
	}, [ view, fields, isLoading, fieldDefs.length ] );

	const onChangeView = useCallback( ( next ) => {
		// Persist the raw view from DataViews so hide/show and
		// reorder updates land in state exactly as DataViews
		// produced them. The reconciledView memo above handles
		// cleanup on the next render.
		setView( next );
	}, [] );

	const { data: dataFiltered, paginationInfo } = useMemo(
		() => filterSortAndPaginate( data, reconciledView, fields ),
		[ data, reconciledView, fields ]
	);

	return (
		<DataViews
			data={ dataFiltered }
			fields={ fields }
			view={ reconciledView }
			onChangeView={ onChangeView }
			paginationInfo={ paginationInfo }
			defaultLayouts={ DEFAULT_LAYOUTS }
			getItemId={ ( item ) => String( item.id ) }
			isLoading={ isLoading }
		/>
	);
}
