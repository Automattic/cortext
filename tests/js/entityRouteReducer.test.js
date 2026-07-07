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
const redirectTarget = ( to ) => ( { kind: 'redirect', to, tail: '' } );
const publishedTarget = { kind: 'published', tail: '' };
const importTarget = { kind: 'import', tail: '' };

function activate( state, target ) {
	let next = reducer( state, { type: 'TARGET_CHANGED', target } );
	if ( target.kind === 'document' && target.id !== null ) {
		next = reducer( next, { type: 'DOCUMENT_RESOLVED', id: target.id } );
		next = reducer( next, { type: 'DOCUMENT_DISPLAYED', id: target.id } );
	}
	return next;
}

describe( 'EntityRoute reducer', () => {
	describe( 'parseTarget', () => {
		it( 'sends legacy `published` links to settings/published', () => {
			expect( parseTarget( 'published' ) ).toEqual(
				redirectTarget( 'settings/published' )
			);
		} );

		it( 'keeps legacy `published` links on the Published settings page before feature checks', () => {
			expect(
				parseTarget( 'published', { publicWebAffordances: false } )
			).toEqual( redirectTarget( 'settings/published' ) );
		} );

		it( 'does not match `published/<anything>` (falls through to document)', () => {
			expect( parseTarget( 'published/foo' ).kind ).toBe( 'document' );
		} );

		it( 'sends legacy `import` links to settings/import', () => {
			expect( parseTarget( 'import' ) ).toEqual(
				redirectTarget( 'settings/import' )
			);
		} );

		it( 'leaves `import/<anything>` for document routing', () => {
			expect( parseTarget( 'import/foo' ).kind ).toBe( 'document' );
		} );

		it( 'opens Import from the Settings landing route', () => {
			expect( parseTarget( 'settings' ) ).toEqual(
				redirectTarget( 'settings/import' )
			);
		} );

		it( 'opens Import from settings/import', () => {
			expect( parseTarget( 'settings/import' ) ).toEqual( {
				kind: 'import',
				tail: '',
			} );
		} );

		it( 'opens Published from settings/published when publishing tools are available', () => {
			expect( parseTarget( 'settings/published' ) ).toEqual( {
				kind: 'published',
				tail: '',
			} );
		} );

		it( 'falls back to Import when Published is unavailable', () => {
			expect(
				parseTarget( 'settings/published', {
					publicWebAffordances: false,
				} )
			).toEqual( redirectTarget( 'settings/import' ) );
		} );

		it( 'leaves unknown settings pages for document routing', () => {
			expect( parseTarget( 'settings/foo' ) ).toEqual( {
				kind: 'document',
				id: null,
				tail: 'settings/foo',
			} );
		} );

		it( 'maps an empty splat to the empty kind', () => {
			expect( parseTarget( '' ) ).toEqual( {
				kind: 'empty',
				tail: '',
			} );
		} );

		it( 'maps a bare id to a document target', () => {
			expect( parseTarget( '42' ) ).toEqual( {
				kind: 'document',
				id: 42,
				tail: '42',
			} );
		} );

		it( 'maps a slug-prefixed splat to a document target', () => {
			expect( parseTarget( 'about-us-42' ) ).toEqual( {
				kind: 'document',
				id: 42,
				tail: 'about-us-42',
			} );
		} );

		it( 'maps a malformed splat (no trailing id) to a document target with null id', () => {
			expect( parseTarget( 'about-us' ) ).toEqual( {
				kind: 'document',
				id: null,
				tail: 'about-us',
			} );
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

		it( 'starts an import target on the import pane', () => {
			expect( init( importTarget ).active ).toEqual( {
				kind: 'import',
			} );
		} );

		it( 'starts a deep-linked redirect on the loading pane', () => {
			expect(
				init( redirectTarget( 'settings/import' ) ).active
			).toEqual( {
				kind: 'loading',
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

		it( 'has empty mount state', () => {
			const state = init( documentTarget( 1 ) );
			expect( state.mountedDocumentId ).toBeNull();
			expect( state.displayedDocumentId ).toBeNull();
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

		it( 'reactivates a document that is already mounted and displayed', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = activate( state, documentTarget( 2 ) );
			expect( state.active ).toEqual( { kind: 'document', id: 2 } );

			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			// Switching back to a previously displayed doc requires
			// remount before reactivation; the previous paint is preserved.
			expect( state.active ).toEqual( { kind: 'document', id: 2 } );
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

		it( 'switches to import immediately', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: importTarget,
			} );
			expect( next.active ).toEqual( { kind: 'import' } );
		} );

		it( 'keeps the current pane visible while redirecting', () => {
			const state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			const next = reducer( state, {
				type: 'TARGET_CHANGED',
				target: redirectTarget( 'settings/import' ),
			} );
			expect( next.target ).toEqual(
				redirectTarget( 'settings/import' )
			);
			expect( next.active ).toBe( state.active );
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

		it( 'reuses an already-mounted document when target id matches both mount and paint', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			// Already mounted+displayed. A TARGET_CHANGED back to the same id
			// flips active immediately without going through loading.
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
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
			state = reducer( state, { type: 'DOCUMENT_RESOLVED', id: 1 } );
			expect( state.mountedDocumentId ).toBe( 1 );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );

		it( 'mounts but does not activate before the document paints', () => {
			let state = init( documentTarget( 1 ) );
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 1 ),
			} );
			state = reducer( state, { type: 'DOCUMENT_RESOLVED', id: 1 } );
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
			} );
			expect( next ).toBe( state );
		} );

		it( 'ignores a stale resolution from a previous target id', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 2 ),
			} );
			const next = reducer( state, {
				type: 'DOCUMENT_RESOLVED',
				id: 1,
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
			state = reducer( state, {
				type: 'DOCUMENT_NOT_FOUND',
				id: 99,
			} );
			expect( state.active ).toEqual( { kind: 'document-not-found' } );
		} );

		it( 'is ignored when the not-found id does not match the current target', () => {
			let state = activate(
				init( documentTarget( 1 ) ),
				documentTarget( 1 )
			);
			state = reducer( state, {
				type: 'TARGET_CHANGED',
				target: documentTarget( 2 ),
			} );
			const next = reducer( state, {
				type: 'DOCUMENT_NOT_FOUND',
				id: 1,
			} );
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
			state = reducer( state, { type: 'DOCUMENT_RESOLVED', id: 1 } );
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

	describe( 'navigation flows', () => {
		it( 'cold-loads a document through loading → document', () => {
			let state = init( documentTarget( 1 ) );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'DOCUMENT_RESOLVED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'loading' } );
			state = reducer( state, { type: 'DOCUMENT_DISPLAYED', id: 1 } );
			expect( state.active ).toEqual( { kind: 'document', id: 1 } );
		} );
	} );
} );
