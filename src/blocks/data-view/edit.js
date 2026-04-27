import { __ } from '@wordpress/i18n';
import { useBlockProps } from '@wordpress/block-editor';
import { Placeholder, SelectControl, Spinner } from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { useCallback } from '@wordpress/element';

import CollectionDataViews from '../../components/CollectionDataViews';

function CollectionPicker( { onSelect } ) {
	const { records, isResolving } = useEntityRecords(
		'postType',
		'cortext_collection',
		{
			per_page: 100,
			context: 'edit',
			status: [ 'draft', 'private', 'publish' ],
		}
	);

	const options = [
		{ value: '', label: __( 'Select a collection…', 'cortext' ) },
		...( records ?? [] ).map( ( c ) => ( {
			value: String( c.id ),
			label: c.title?.rendered || c.title?.raw || `#${ c.id }`,
		} ) ),
	];

	return (
		<SelectControl
			label={ __( 'Collection', 'cortext' ) }
			value=""
			options={ options }
			onChange={ ( value ) => {
				const id = parseInt( value, 10 );
				if ( id ) {
					onSelect( id );
				}
			} }
			disabled={ isResolving }
			__next40pxDefaultSize
			__nextHasNoMarginBottom
		/>
	);
}

export default function Edit( { attributes, setAttributes } ) {
	const { collectionId, view } = attributes;
	const blockProps = useBlockProps();

	const setView = useCallback(
		( next ) => setAttributes( { view: next } ),
		[ setAttributes ]
	);

	if ( ! collectionId ) {
		return (
			<div { ...blockProps }>
				<Placeholder
					label={ __( 'Collection view', 'cortext' ) }
					instructions={ __(
						'Pick a collection to display.',
						'cortext'
					) }
				>
					<CollectionPicker
						onSelect={ ( id ) =>
							setAttributes( { collectionId: id } )
						}
					/>
				</Placeholder>
			</div>
		);
	}

	return (
		<div { ...blockProps }>
			<CollectionDataViews
				collectionId={ collectionId }
				view={ view }
				onChangeView={ setView }
				loading={ <Spinner /> }
			/>
		</div>
	);
}
