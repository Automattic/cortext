import { useCallback, useState } from '@wordpress/element';

export const COLLAPSED_TRAIT_GROUPS_KEY = 'cortext.collapsedTraitGroups';

function readStoredIds() {
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem( COLLAPSED_TRAIT_GROUPS_KEY )
		);
		return new Set(
			Array.isArray( parsed )
				? parsed.map( Number ).filter( ( id ) => id > 0 )
				: []
		);
	} catch {
		return new Set();
	}
}

function persistIds( ids ) {
	try {
		window.localStorage.setItem(
			COLLAPSED_TRAIT_GROUPS_KEY,
			JSON.stringify( Array.from( ids ) )
		);
	} catch {
		// Storage can be denied; keep the in-memory choice for this session.
	}
}

// Which trait groups the user folded in the properties block, by collection.
// The choice is per browser and applies to every row of that collection.
export default function useCollapsedTraitGroups() {
	const [ collapsedIds, setCollapsedIds ] = useState( readStoredIds );

	const isCollapsed = useCallback(
		( collectionId ) => collapsedIds.has( Number( collectionId ) ),
		[ collapsedIds ]
	);

	const toggleCollapsed = useCallback( ( collectionId ) => {
		const id = Number( collectionId );
		setCollapsedIds( ( current ) => {
			const next = new Set( current );
			if ( next.has( id ) ) {
				next.delete( id );
			} else {
				next.add( id );
			}
			persistIds( next );
			return next;
		} );
	}, [] );

	return { isCollapsed, toggleCollapsed };
}
