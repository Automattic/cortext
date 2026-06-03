import {
	makeRowDocumentContext,
	rememberRowDocumentContext,
	rowDocumentContextForEditorPost,
} from '../../../src/router/rowContextCache';

describe( 'row document context cache', () => {
	it( 'keeps the mounted row context while another document is resolving', () => {
		const cache = new Map();
		const mountedRowContext = makeRowDocumentContext( {
			documentId: 20,
			collectionId: 10,
			fields: [ { id: 'title' }, { id: 'field-11' } ],
			allFields: [ { id: 'title' }, { id: 'field-11' } ],
			detailLayoutEntries: [ { field: 'field-11', visible: true } ],
			row: { id: 20, title: { raw: 'Gabriel Garcia Marquez' } },
			isResolving: false,
		} );
		rememberRowDocumentContext( cache, mountedRowContext );

		const resolvingTargetContext = makeRowDocumentContext( {
			documentId: 21,
			collectionId: 10,
			fields: [ { id: 'title' }, { id: 'field-11' } ],
			allFields: [ { id: 'title' }, { id: 'field-11' } ],
			detailLayoutEntries: [ { field: 'field-11', visible: true } ],
			row: { id: 21, title: { raw: 'Jorge Luis Borges' } },
			isResolving: true,
		} );

		expect(
			rowDocumentContextForEditorPost( cache, 20, resolvingTargetContext )
		).toBe( mountedRowContext );
	} );

	it( 'uses the current context once it matches the mounted editor post', () => {
		const cache = new Map();
		const currentContext = makeRowDocumentContext( {
			documentId: 21,
			collectionId: 10,
			fields: [ { id: 'title' } ],
			allFields: [ { id: 'title' } ],
			detailLayoutEntries: [],
			row: { id: 21 },
			isResolving: true,
		} );

		expect(
			rowDocumentContextForEditorPost( cache, 21, currentContext )
		).toBe( currentContext );
		expect( currentContext.isResolving ).toBe( true );
	} );

	it( 'returns null for non-row documents', () => {
		expect(
			makeRowDocumentContext( {
				documentId: 30,
				collectionId: null,
			} )
		).toBeNull();
		expect(
			rowDocumentContextForEditorPost( new Map(), 30, null )
		).toBeNull();
	} );

	it( 'keeps the rendered row context when the mounted target becomes a non-row document', () => {
		const cache = new Map();
		const renderedRowContext = makeRowDocumentContext( {
			documentId: 20,
			collectionId: 10,
			fields: [ { id: 'title' }, { id: 'field-11' } ],
			allFields: [ { id: 'title' }, { id: 'field-11' } ],
			detailLayoutEntries: [ { field: 'field-11', visible: true } ],
			row: { id: 20 },
			isResolving: false,
		} );
		rememberRowDocumentContext( cache, renderedRowContext );

		expect( rowDocumentContextForEditorPost( cache, 20, null ) ).toBe(
			renderedRowContext
		);
	} );
} );
