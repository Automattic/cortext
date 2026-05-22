import {
	parseTarget,
	reducer,
	init,
} from '../../src/router/entityRouteReducer';

const emptyTarget = { kind: 'empty', tail: '' };
const documentTarget = ( id ) => ( {
	kind: 'document',
	id,
	tail: `${ id }`,
} );
const collectionTarget = ( id ) => ( {
	kind: 'collection',
	id,
	tail: `${ id }`,
} );
const publishedTarget = { kind: 'published', tail: '' };

const PAGE_TYPE = 'crtxt_page';

function activate( state, target, options = {} ) {
	const postType = options.postType ?? PAGE_TYPE;
	let next = reducer( state, { type: 'TARGET_CHANGED', target } );
	if ( target.kind === 'document' && target.id !== null ) {
		next = reducer( next, {
			type: 'DOCUMENT_RESOLVED',
			id: target.id,
			postType,
		} );
		next = reducer( next, { type: 'DOCUMENT_DISPLAYED', id: target.id } );
	} else if ( target.kind === 'collection' && target.id !== null ) {
		next = reducer( next, { type: 'COLLECTION_RESOLVED', id: target.id } );
		next = reducer( next, { type: 'COLLECTION_READY', id: target.id } );
	}
	return next;
}

describe( 'EntityRoute reducer', () => {
	describe( 'parseTarget', () => {
		it( 'maps a bare `published` splat to the published kind', () => {
			expect( parseTarget( 'published' ) ).toEqual( {
				kind: 'published',
				tail: '',
			} );
		} );

		it( 'does not match `published/<anything>` (falls through to document)', () => {
			expect( parseTarget( 'published/foo' ).kind ).toBe( 'document' );
		} );
	} );

	describe( 'init', () => {
		it( 'starts an empty target on the empty pane', () => {
			expect( init( emptyTarget ).active ).toEqual( { kind: 'empty' } );
		} );

		it( 'starts a published target on the published pane', () => {
			expect( init( publishedTarget ).active ).toEqual( {
				kind: 'published',
			} );
		} );

		it( 'starts a document target as loading', () => {
			expect( init( documentTarget( 1 ) ).active ).toEqual( {
				kind: 'loading',
			} );
		} );

		it( 'starts a malformed document target as document-not-found', () => {
			const target = { kind: 'document', id: null, tail: 'foo' };
			expect( init( target ).active ).toEqual( {
				kind: 'document-not-found',
			} );
		} );

		it( 'starts a malformed collection target as collection-not-found', () => {
			const target = { kind: 'collection', id: null, tail: 'foo' };
			expect( init( target ).active ).toEqual( {
				kind: 'collection-not-found',
			} );
		} );

		it( 'has empty mount state', () => {
			const state = init( documentTarget( 1 ) );
			expect( state.mountedDocumentId ).toBeNull();
			expect( state.mountedDocumentType ).toBeNull();
			expect( state.displayedDocumentId ).toBeNull();
			expect( state.mountedCollectionIds ).toEqual( [] );
			expect( state.readyCollectionIds.size ).toBe( 0 );
		} );
	} );

	describe( 'TARGET_CHANGED', () => {
		it( 'preserves paint when navigating to a not-yet-mounted document', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 2 ),
			} );
			expect( next.target ).toEqual( documentTarget( 2 ) );
			// Still painting document 1 — preservePaint until 2 is ready.
			expect( next.active ).toEqual( { kind: 'document', id: 1 } );
		} );

		it( 'preserves paint when navigating to a collection that is not ready yet', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			expect( next.target ).toEqual( collectionTarget( 5 ) );
			expect( next.active ).toEqual( { kind: 'document', id: 1 } );
		} );

		it( 'preserves the previous collection until the next collection mounts', () => {
			const state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 7 ),
			} );
			expect( next.target ).toEqual( collectionTarget( 7 ) );
			expect( next.active ).toEqual( { kind: 'collection', id: 5 } );
			expect( next.mountedCollectionIds ).toEqual( [ 5 ] );
		} );

		it( 'reactivates a document that is already mounted and displayed', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = activate( state, collectionTarget( 5 ) );
			expect( state.active ).toEqual( { kind: 'collection', id: 5 } );

			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );

		it( 'reactivates a collection that is already mounted and ready', () => {
			let state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			state = activate( state, documentTarget( 1 ) );
			// The previous collection is pruned once the document activates.
			expect( state.mountedCollectionIds ).toEqual( [] );
		} );

		it( 'switches to published immediately', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: publishedTarget,
			} );
			expect( next.active ).toEqual( { kind: 'published' } );
		} );

		it( 'switches to empty immediately', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: emptyTarget,
			} );
			expect( next.active ).toEqual( { kind: 'empty' } );
		} );

		it( 'switches to document-not-found for a malformed document url', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: { kind: 'document', id: null, tail: 'foo' },
			} );
			expect( next.active ).toEqual( { kind: 'document-not-found' } );
		} );
	} );

	describe( 'DOCUMENT_RESOLVED', () => {
		it( 'mounts the document and activates when displayed matches', () => {
			let state = init( documentTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			state = reducer( state, { type: 'DOCUMENT_DISPLAYED', id: 1 } );
			state = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 1,
				postType: PAGE_TYPE,
			} );
			expect( state.mountedDocumentId ).toBe( 1 );
			expect( state.mountedDocumentType ).toBe( PAGE_TYPE );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );

		it( 'mounts but does not activate before the document paints', () => {
			let state = init( documentTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			state = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 1,
				postType: PAGE_TYPE,
			} );
			expect( state.mountedDocumentId ).toBe( 1 );
			expect( state.active ).toEqual( { kind: 'loading' } );
		} );

		it( 'ignores a resolution for a different target', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 99,
				postType: PAGE_TYPE,
			} );
			expect( next ).toBe( state );
		} );

		it( 'ignores a resolution when the target is no longer a document', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			const next = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 1,
				postType: PAGE_TYPE,
			} );
			expect( next ).toBe( state );
		} );
	} );

	describe( 'DOCUMENT_NOT_FOUND', () => {
		it( 'activates document-not-found on a document target', () => {
			let state = init( documentTarget( 99 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 99 ),
			} );
			state = reducer( state, { type: 'DOCUMENT_NOT_FOUND' } );
			expect( state.active ).toEqual( { kind: 'document-not-found' } );
		} );

		it( 'is ignored when the target is no longer a document', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			const next = reducer( state, { type: 'DOCUMENT_NOT_FOUND' } );
			expect( next ).toBe( state );
		} );
	} );

	describe( 'DOCUMENT_DISPLAYED', () => {
		it( 'activates document when paint catches up to mount + target', () => {
			let state = init( documentTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			state = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 1,
				postType: PAGE_TYPE,
			} );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'DOCUMENT_DISPLAYED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
			expect( state.displayedDocumentId ).toBe( 1 );
		} );

		it( 'records displayedDocumentId even when it does not match the target', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 2 ),
			} );
			state = reducer( state, { type: 'DOCUMENT_DISPLAYED', id: 1 } );
			expect( state.displayedDocumentId ).toBe( 1 );
			// Preserved paint of document 1 while target is 2.
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );
	} );

	describe( 'COLLECTION_RESOLVED', () => {
		it( 'mounts the collection before row data is ready', () => {
			let state = init( collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 5 } );
			expect( state.mountedCollectionIds ).toEqual( [ 5 ] );
			expect( state.active ).toEqual( { kind: 'collection', id: 5 } );
		} );

		it( 'preserves the active content pane until collection rows are ready', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 5 ),
			} );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 5 } );
			expect( state.mountedCollectionIds ).toEqual( [ 5 ] );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
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
		it( 'drops the previous collection after the next one activates', () => {
			let state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: collectionTarget( 7 ),
			} );
			state = reducer( state, { type: 'COLLECTION_RESOLVED', id: 7 } );
			expect( state.mountedCollectionIds ).toEqual( [ 5, 7 ] );
			state = reducer( state, { type: 'COLLECTION_READY', id: 7 } );
			expect( state.mountedCollectionIds ).toEqual( [ 7 ] );
		} );

		it( 'drops mounted collections when leaving for a document', () => {
			let state = activate(
				init( collectionTarget( 5 ) ),
				collectionTarget( 5 )
			);
			state = activate( state, documentTarget( 1 ) );
			expect( state.mountedCollectionIds ).toEqual( [] );
			expect( state.readyCollectionIds.size ).toBe( 0 );
		} );
	} );

	describe( 'navigation flows', () => {
		it( 'cold-loads a document through loading → document', () => {
			let state = init( documentTarget( 1 ) );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 1,
				postType: PAGE_TYPE,
			} );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'DOCUMENT_DISPLAYED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );

		it( 'document → collection → document reuses the document mount', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const mountedDocumentId = state.mountedDocumentId;
			state = activate( state, collectionTarget( 5 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			expect( state.mountedDocumentId ).toBe( mountedDocumentId );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );
	} );
} );
