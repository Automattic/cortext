import { reducer, init } from '../../src/router/entityRouteReducer';

const emptyTarget = { kind: 'empty', tail: '' };
const pageTarget = ( id ) => ( { kind: 'page', id, tail: `${ id }` } );
const collectionTarget = ( id ) => ( {
	kind: 'collection',
	id,
	tail: `${ id }`,
} );

function activate( state, target ) {
	let next = reducer( state, { type: 'TARGET_CHANGED', target } );
	if ( target.kind === 'page' && target.id !== null ) {
		next = reducer( next, { type: 'PAGE_RESOLVED', id: target.id } );
		next = reducer( next, { type: 'PAGE_DISPLAYED', id: target.id } );
	} else if ( target.kind === 'collection' && target.id !== null ) {
		next = reducer( next, { type: 'COLLECTION_RESOLVED', id: target.id } );
		next = reducer( next, { type: 'COLLECTION_READY', id: target.id } );
	}
	return next;
}

describe( 'EntityRoute reducer', () => {
	describe( 'init', () => {
		it( 'starts an empty target on the empty pane', () => {
			expect( init( emptyTarget ).active ).toEqual( { kind: 'empty' } );
		} );

		it( 'starts a page target as loading', () => {
			expect( init( pageTarget( 1 ) ).active ).toEqual( {
				kind: 'loading',
			} );
		} );

		it( 'starts a malformed page target as page-not-found', () => {
			const target = { kind: 'page', id: null, tail: 'foo' };
			expect( init( target ).active ).toEqual( {
				kind: 'page-not-found',
			} );
		} );

		it( 'starts a malformed collection target as collection-not-found', () => {
			const target = { kind: 'collection', id: null, tail: 'foo' };
			expect( init( target ).active ).toEqual( {
				kind: 'collection-not-found',
			} );
		} );

		it( 'has empty mount state', () => {
			const state = init( pageTarget( 1 ) );
			expect( state.mountedPageId ).toBeNull();
			expect( state.displayedPageId ).toBeNull();
			expect( state.mountedCollectionIds ).toEqual( [] );
			expect( state.readyCollectionIds.size ).toBe( 0 );
		} );
	} );

	describe( 'TARGET_CHANGED', () => {
		it( 'preserves paint when navigating to a not-yet-mounted page', () => {
			const state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 2 ),
			} );
			expect( next.target ).toEqual( pageTarget( 2 ) );
			expect( next.active ).toEqual( { kind: 'page' } ); // still showing 1
		} );

		it( 'reactivates a page that is already mounted and displayed', () => {
			let state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			state = activate( state, collectionTarget( 5 ) );
			expect( state.active ).toEqual( { kind: 'collection', id: 5 } );

			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 1 ),
			} );
			expect( state.active ).toEqual( { kind: 'page' } );
		} );

		it( 'reactivates a collection that is already mounted and ready', () => {
			let state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			state = activate( state, pageTarget( 1 ) );
			// The previous collection is pruned once the page activates.
			expect( state.mountedCollectionIds ).toEqual( [] );
		} );

		it( 'switches to empty immediately', () => {
			const state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: emptyTarget,
			} );
			expect( next.active ).toEqual( { kind: 'empty' } );
		} );

		it( 'switches to page-not-found for a malformed page url', () => {
			const state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: { kind: 'page', id: null, tail: 'foo' },
			} );
			expect( next.active ).toEqual( { kind: 'page-not-found' } );
		} );
	} );

	describe( 'PAGE_RESOLVED', () => {
		it( 'mounts the page and activates when displayed matches', () => {
			let state = init( pageTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 1 ),
			} );
			state = reducer( state, { type: 'PAGE_DISPLAYED', id: 1 } );
			state = reducer( state, { type: 'PAGE_RESOLVED', id: 1 } );
			expect( state.mountedPageId ).toBe( 1 );
			expect( state.active ).toEqual( { kind: 'page' } );
		} );

		it( 'mounts but does not activate before the page paints', () => {
			let state = init( pageTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 1 ),
			} );
			state = reducer( state, { type: 'PAGE_RESOLVED', id: 1 } );
			expect( state.mountedPageId ).toBe( 1 );
			expect( state.active ).toEqual( { kind: 'loading' } );
		} );

		it( 'ignores a resolution for a different target', () => {
			const state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			const next = reducer( state, { type: 'PAGE_RESOLVED', id: 99 } );
			expect( next ).toBe( state );
		} );

		it( 'ignores a resolution when the target is no longer a page', () => {
			let state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			const next = reducer( state, { type: 'PAGE_RESOLVED', id: 1 } );
			expect( next ).toBe( state );
		} );
	} );

	describe( 'PAGE_NOT_FOUND', () => {
		it( 'activates page-not-found on a page target', () => {
			let state = init( pageTarget( 99 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 99 ),
			} );
			state = reducer( state, { type: 'PAGE_NOT_FOUND' } );
			expect( state.active ).toEqual( { kind: 'page-not-found' } );
		} );

		it( 'is ignored when the target is no longer a page', () => {
			let state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			const next = reducer( state, { type: 'PAGE_NOT_FOUND' } );
			expect( next ).toBe( state );
		} );
	} );

	describe( 'PAGE_DISPLAYED', () => {
		it( 'activates page when paint catches up to mount + target', () => {
			let state = init( pageTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 1 ),
			} );
			state = reducer( state, { type: 'PAGE_RESOLVED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'PAGE_DISPLAYED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'page' } );
			expect( state.displayedPageId ).toBe( 1 );
		} );

		it( 'records displayedPageId even when it does not match the target', () => {
			let state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 2 ),
			} );
			state = reducer( state, { type: 'PAGE_DISPLAYED', id: 1 } );
			expect( state.displayedPageId ).toBe( 1 );
			expect( state.active ).toEqual( { kind: 'page' } ); // preserved paint
		} );
	} );

	describe( 'COLLECTION_RESOLVED', () => {
		it( 'adds to mountedCollectionIds without activating before ready', () => {
			let state = init( collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 5 } );
			expect( state.mountedCollectionIds ).toEqual( [ 5 ] );
			expect( state.active ).toEqual( { kind: 'loading' } );
		} );

		it( 'activates when the collection was already ready', () => {
			let state = init( collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			state = reducer( state, { type: 'COLLECTION_READY', id: 5 } );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 5 } );
			expect( state.active ).toEqual( { kind: 'collection', id: 5 } );
		} );

		it( 'ignores a resolution for a different target', () => {
			const state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			const next = reducer( state, {
				type: 'COLLECTION_RESOLVED',
				id: 99,
			} );
			expect( next ).toBe( state );
		} );
	} );

	describe( 'COLLECTION_READY', () => {
		it( 'tracks readiness and activates the matching target', () => {
			let state = init( collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 5 } );
			state = reducer( state, { type: 'COLLECTION_READY', id: 5 } );
			expect( state.active ).toEqual( { kind: 'collection', id: 5 } );
			expect( state.readyCollectionIds.has( 5 ) ).toBe( true );
		} );

		it( 'tracks readiness but does not activate until the pane is mounted', () => {
			let state = init( collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			state = reducer( state, { type: 'COLLECTION_READY', id: 5 } );
			expect( state.readyCollectionIds.has( 5 ) ).toBe( true );
			expect( state.active ).toEqual( { kind: 'loading' } );
		} );
	} );

	describe( 'pruning', () => {
		it( 'keeps the active and target collections, drops the rest', () => {
			let state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 7 ),
			} );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 7 } );
			expect( state.mountedCollectionIds.sort() ).toEqual( [ 5, 7 ] );
			state = reducer( state, { type: 'COLLECTION_READY', id: 7 } );
			expect( state.mountedCollectionIds ).toEqual( [ 7 ] );
		} );

		it( 'drops mounted collections when leaving for a page', () => {
			let state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			state = activate( state, pageTarget( 1 ) );
			expect( state.mountedCollectionIds ).toEqual( [] );
			expect( state.readyCollectionIds.size ).toBe( 0 );
		} );
	} );

	describe( 'navigation flows', () => {
		it( 'cold-loads /page/A through loading → page', () => {
			let state = init( pageTarget( 1 ) );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'PAGE_RESOLVED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'PAGE_DISPLAYED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'page' } );
		} );

		it( 'page → collection → page reuses the page mount', () => {
			let state = activate( init( pageTarget( 1 ) ), pageTarget( 1 ) );
			const mountedPageId = state.mountedPageId;
			state = activate( state, collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: pageTarget( 1 ),
			} );
			expect( state.mountedPageId ).toBe( mountedPageId );
			expect( state.active ).toEqual( { kind: 'page' } );
		} );
	} );
} );
