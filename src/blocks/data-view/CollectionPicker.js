import { __ } from '@wordpress/i18n';
import { Button, SearchControl, Spinner } from '@wordpress/components';
import { useState } from '@wordpress/element';

import useCollectionSearch from '../../hooks/useCollectionSearch';

export default function CollectionPicker( { selectedId = '', onSelect } ) {
	// Every document that defines a schema, searched on the server so
	// collections past the first page stay reachable.
	const [ query, setQuery ] = useState( '' );
	const {
		records: matches,
		isResolving,
		hasResolved,
	} = useCollectionSearch( query );

	const collectionTitle = ( collection ) =>
		collection.title?.rendered ||
		collection.title?.raw ||
		`#${ collection.id }`;

	if ( ! query && hasResolved && ! matches?.length ) {
		return (
			<p className="cortext-data-view-picker__empty">
				{ __( 'No collections yet.', 'cortext' ) }
			</p>
		);
	}

	let results;
	if ( ! matches?.length ) {
		results = isResolving ? (
			<Spinner />
		) : (
			<p className="cortext-data-view-picker__empty">
				{ __( 'No collections match your search.', 'cortext' ) }
			</p>
		);
	} else {
		results = matches.map( ( collection ) => {
			const isSelected =
				selectedId && Number( selectedId ) === collection.id;

			return (
				<Button
					key={ collection.id }
					className="cortext-collection-chooser__item"
					variant={ isSelected ? 'secondary' : 'tertiary' }
					isPressed={ isSelected }
					onClick={ () => onSelect( collection.id ) }
				>
					{ collectionTitle( collection ) }
				</Button>
			);
		} );
	}

	return (
		<div className="cortext-collection-chooser">
			<SearchControl
				__nextHasNoMarginBottom
				className="cortext-collection-chooser__search"
				value={ query }
				onChange={ setQuery }
				placeholder={ __( 'Search collections', 'cortext' ) }
			/>
			{ results }
		</div>
	);
}
