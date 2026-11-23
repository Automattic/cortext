import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useState } from '@wordpress/element';

import { visibleTraits } from '../documents/traits';
import { notifyDocumentLocatorChanged } from './documentLocatorInvalidation';
import { notifyCollectionRowsChanged } from './rowInvalidation';

// Adds and removes a row's traits (one per collection it belongs to). Every
// change writes the full set through `PUT /cortext/v1/documents/<id>/traits`,
// hidden traits included, and the last live visible trait cannot be removed,
// so a row always belongs to at least one collection.
export default function useTraitMemberships( {
	documentId,
	collections,
	beforeRemoveCollection,
	isReadOnly = false,
	onChange,
} ) {
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const { invalidateResolution } = useDispatch( coreStore );

	const writeMemberships = async ( nextIds, beforeWrite = null ) => {
		setIsSaving( true );
		setError( null );
		let releaseWriteLock = null;
		try {
			const release = await beforeWrite?.();
			if ( typeof release === 'function' ) {
				releaseWriteLock = release;
			}
			const response = await apiFetch( {
				path: `/cortext/v1/documents/${ documentId }/traits`,
				method: 'PUT',
				data: { collection_ids: nextIds },
			} );
			const activeIds = Array.isArray( response?.collections )
				? response.collections
						.filter(
							( collection ) => collection?.active !== false
						)
						.map( ( collection ) => collection?.id )
				: null;
			notifyDocumentLocatorChanged( documentId, activeIds );
			// Membership changes can update reverse relations and rollups in
			// collections beyond the one directly added or removed.
			notifyCollectionRowsChanged();
			// The breadcrumb chips read `crtxt_trait` off the core-data document
			// record, which this custom-endpoint write does not touch. Invalidate
			// it so the membership change shows there too, not just in the local
			// traits hook the caller refreshes via onChange.
			invalidateResolution( 'getEntityRecord', [
				'postType',
				'crtxt_document',
				documentId,
			] );
			onChange?.();
		} catch ( saveError ) {
			setError(
				saveError?.message ?? __( "Couldn't update traits.", 'cortext' )
			);
		} finally {
			releaseWriteLock?.();
			setIsSaving( false );
		}
	};

	const canAdd = ! isReadOnly && collections.length > 0;

	const addCollection = ( record ) => {
		// Guard against writing before the current memberships are known: an
		// empty `collections` would replace the whole set with just this id.
		if ( ! canAdd ) {
			return;
		}
		writeMemberships( [
			...collections.map( ( collection ) => collection.id ),
			record.id,
		] );
	};

	const canRemove =
		! isReadOnly &&
		visibleTraits( collections ).filter(
			( collection ) => collection.active !== false
		).length > 1;

	const removeCollection = ( collection ) => {
		if ( ! canRemove ) {
			return;
		}
		writeMemberships(
			collections
				.filter( ( current ) => current.id !== collection.id )
				.map( ( current ) => current.id ),
			() => beforeRemoveCollection?.( collection.id )
		);
	};

	return {
		addCollection,
		removeCollection,
		canAdd,
		canRemove,
		isSaving,
		error,
	};
}
