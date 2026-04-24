/**
 * Throwaway component: renders a collection as a table.
 *
 * Fetches collection → fields → entries via core-data and displays
 * entries as rows with field values as columns.
 */

import { useEntityRecords } from '@wordpress/core-data';
import { Spinner } from '@wordpress/components';

const CPT_PREFIX = 'crtxt_';

export default function CollectionTable( { slug = 'books' } ) {
	// 1. Find the collection by slug.
	const { records: collections, isResolving: loadingCollection } =
		useEntityRecords( 'postType', 'cortext_collection', {
			slug,
			per_page: 1,
		} );

	const collection = collections?.[ 0 ];
	const fieldIds = collection?.meta?.fields?.map( Number ) ?? [];
	const entryCpt = collection ? CPT_PREFIX + slug : null;

	// 2. Fetch field definitions.
	const { records: fields, isResolving: loadingFields } = useEntityRecords(
		'postType',
		'cortext_field',
		fieldIds.length
			? { include: fieldIds, per_page: 100, orderby: 'include' }
			: undefined
	);

	// 3. Fetch entries.
	const { records: entries, isResolving: loadingEntries } = useEntityRecords(
		'postType',
		entryCpt,
		entryCpt ? { per_page: 100 } : undefined
	);

	if ( loadingCollection || loadingFields || loadingEntries ) {
		return <Spinner />;
	}

	if ( ! collection ) {
		return <p>No collection found for slug "{ slug }".</p>;
	}

	if ( ! fields?.length ) {
		return <p>No fields found for collection "{ collection.title.rendered }".</p>;
	}

	return (
		<table
			style={ {
				borderCollapse: 'collapse',
				width: '100%',
				fontFamily: 'inherit',
			} }
		>
			<thead>
				<tr>
					<th style={ cellStyle }>Title</th>
					{ fields.map( ( field ) => (
						<th key={ field.id } style={ cellStyle }>
							{ field.title.rendered }
						</th>
					) ) }
				</tr>
			</thead>
			<tbody>
				{ entries?.map( ( entry ) => (
					<tr key={ entry.id }>
						<td style={ cellStyle }>{ entry.title.rendered }</td>
						{ fields.map( ( field ) => (
							<td key={ field.id } style={ cellStyle }>
								{ formatValue(
									entry.meta?.[ `field-${ field.id }` ],
									field.meta?.type
								) }
							</td>
						) ) }
					</tr>
				) ) }
			</tbody>
		</table>
	);
}

const cellStyle = {
	border: '1px solid #ddd',
	padding: '8px 12px',
	textAlign: 'left',
};

function formatValue( value, type ) {
	if ( value === undefined || value === null || value === '' ) {
		return '\u2014';
	}
	if ( Array.isArray( value ) ) {
		return value.join( ', ' );
	}
	if ( type === 'checkbox' ) {
		return value ? 'Yes' : 'No';
	}
	return String( value );
}
