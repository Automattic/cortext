import { DataViews } from '@wordpress/dataviews';
import { useEffect, useMemo } from '@wordpress/element';
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
	const { fields, collection, isResolving } =
		useCollectionFields( collectionId );
	const {
		data,
		paginationInfo,
		isLoading,
		error: rowError,
	} = useCollectionRows( collectionId, view );
	const dataViewFields = useMemo(
		() => [ TITLE_FIELD, ...fields ],
		[ fields ]
	);

	// Seed visible columns once the collection's fields resolve. Without
	// this, an empty `view.fields` makes DataViews render zero columns.
	// DataViews core prevents hiding every column, so the "empty === just
	// inserted" heuristic won't fight later edits.
	useEffect( () => {
		if ( isResolving ) {
			return;
		}

		const visibleFields = view?.fields ?? [];
		const defaultFields = dataViewFields.map( ( f ) => f.id );
		let nextFields = null;

		if ( ! visibleFields.length ) {
			nextFields = defaultFields;
		} else if ( ! visibleFields.includes( TITLE_FIELD.id ) ) {
			nextFields = [ TITLE_FIELD.id, ...visibleFields ];
		}

		if ( nextFields ) {
			onChangeView( {
				...view,
				fields: nextFields,
			} );
		}
	}, [ dataViewFields, isResolving, view, onChangeView ] );

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
