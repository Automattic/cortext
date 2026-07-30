// `EditorBody.js` carries a `collectDuplicateHeaderClientIds` invariant: a
// schema-bearing document's body owns one self-referencing `cortext/data-view`,
// and anything else at the root (foreign data-views or extra copies) must
// surface as a duplicate so the layout effect can drop it. The cleanup catches
// the race where a document switch leaves the previous document's blocks in
// the editor store before the new entity's blocks hydrate.

jest.mock( '@wordpress/block-editor', () => ( {
	__esModule: true,
	BlockCanvas: () => null,
	BlockList: () => null,
	store: {},
	useSettings: () => [],
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: () => null,
	Disabled: () => null,
	Notice: () => null,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityProp: () => [ null, () => {} ],
	useEntityRecord: () => ( { record: null } ),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => ( {} ),
	useSelect: () => null,
} ) );

jest.mock( '@wordpress/editor', () => ( {
	__esModule: true,
	store: {},
} ) );

jest.mock( '@wordpress/blocks', () => ( {
	__esModule: true,
	createBlock: () => null,
} ) );

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: () => Promise.resolve(),
} ) );

jest.mock( '../../../src/components/DocumentIdentityControls', () => ( {
	__esModule: true,
	default: () => null,
} ) );

jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	__esModule: true,
	useDocumentPropertiesContext: () => null,
} ) );

jest.mock( '../../../src/components/CanvasOwnerInspector', () => ( {
	__esModule: true,
	findCanvasOwnerBlock: () => null,
	getCanvasOwnerBlockNameForRecord: () => null,
	getCanvasOwnerInitialAttributesForRecord: () => null,
} ) );

jest.mock( '../../../src/components/MediaPicker', () => ( {
	__esModule: true,
	default: () => null,
	MediaUploadCheck: () => null,
} ) );

jest.mock( '../../../src/hooks/afterNextPaint', () => ( {
	__esModule: true,
	default: () => () => {},
} ) );

const {
	areCanvasReadyRequirementsMet,
	collectCollectionBodyClientIdsToRemove,
	collectDuplicateHeaderClientIds,
	useEditorBodyStyles,
} = require( '../../../src/components/EditorBody' );
const { renderHook } = require( '@testing-library/react' );

const COLLECTION_ID = 7;
const OWNER = 'cortext/data-view';

function ownerBlock( clientId, collectionId ) {
	return {
		clientId,
		name: OWNER,
		attributes: { collectionId },
	};
}

function namedBlock( clientId, name, attributes = {} ) {
	return { clientId, name, attributes };
}

describe( 'collectDuplicateHeaderClientIds', () => {
	it( 'returns nothing when the only data-view is self-referencing', () => {
		const blocks = [
			namedBlock( 'title', 'core/post-title' ),
			ownerBlock( 'self', COLLECTION_ID ),
		];

		expect(
			collectDuplicateHeaderClientIds( blocks, OWNER, COLLECTION_ID )
		).toEqual( [] );
	} );

	it( 'marks a foreign data-view as duplicate so it gets removed', () => {
		// Simulates the document-switch race: editor still holds the old
		// document's data-view (pointing at a different collection) while
		// EnsureHeaderBlocks already runs against the new postId.
		const blocks = [
			namedBlock( 'title', 'core/post-title' ),
			ownerBlock( 'stale', 9999 ),
			ownerBlock( 'self', COLLECTION_ID ),
		];

		expect(
			collectDuplicateHeaderClientIds( blocks, OWNER, COLLECTION_ID )
		).toEqual( [ 'stale' ] );
	} );

	it( 'marks foreign data-views even when no self-referencing block is present yet', () => {
		// The transient window before the owner-insertion effect runs: only the
		// stale block is at the root. It still has to be removed.
		const blocks = [
			namedBlock( 'title', 'core/post-title' ),
			ownerBlock( 'stale', 9999 ),
		];

		expect(
			collectDuplicateHeaderClientIds( blocks, OWNER, COLLECTION_ID )
		).toEqual( [ 'stale' ] );
	} );

	it( 'keeps only the first self-referencing data-view when duplicates land at the root', () => {
		const blocks = [
			ownerBlock( 'first', COLLECTION_ID ),
			ownerBlock( 'second', COLLECTION_ID ),
		];

		expect(
			collectDuplicateHeaderClientIds( blocks, OWNER, COLLECTION_ID )
		).toEqual( [ 'second' ] );
	} );

	it( 'leaves foreign data-views alone on pages (no owner block)', () => {
		// Pages have `ownerBlockName === null`; their root may legitimately
		// embed data-views for any collection.
		const blocks = [
			namedBlock( 'title', 'core/post-title' ),
			ownerBlock( 'embed-a', 100 ),
			ownerBlock( 'embed-b', 200 ),
		];

		expect(
			collectDuplicateHeaderClientIds( blocks, null, COLLECTION_ID )
		).toEqual( [] );
	} );

	it( 'still dedupes singletons (cover, icon, title, properties)', () => {
		const blocks = [
			namedBlock( 'cover-1', 'cortext/document-cover' ),
			namedBlock( 'cover-2', 'cortext/document-cover' ),
			namedBlock( 'title-1', 'core/post-title' ),
			namedBlock( 'title-2', 'core/post-title' ),
			ownerBlock( 'self', COLLECTION_ID ),
		];

		expect(
			collectDuplicateHeaderClientIds( blocks, OWNER, COLLECTION_ID )
		).toEqual( [ 'cover-2', 'title-2' ] );
	} );
} );

describe( 'collectCollectionBodyClientIdsToRemove', () => {
	it( 'skips a data view already removed as a duplicate', () => {
		const collectionBodyClientIds = [
			'new-collection',
			'new-paragraph',
			'legacy-paragraph',
		];
		const snapshotClientIds = new Set( [ 'legacy-paragraph' ] );
		const removedClientIds = new Set( [ 'new-collection' ] );

		expect(
			collectCollectionBodyClientIdsToRemove(
				collectionBodyClientIds,
				snapshotClientIds,
				removedClientIds
			)
		).toEqual( [ 'new-paragraph' ] );
	} );
} );

describe( 'areCanvasReadyRequirementsMet', () => {
	it( 'waits for row properties when a schema-bearing row is rendering', () => {
		expect(
			areCanvasReadyRequirementsMet( {
				hasTitle: true,
				needsProperties: true,
				hasProperties: false,
			} )
		).toBe( false );

		expect(
			areCanvasReadyRequirementsMet( {
				hasTitle: true,
				needsProperties: true,
				hasProperties: true,
			} )
		).toBe( true );
	} );

	it( 'waits for collection owner content when a collection owns the body', () => {
		expect(
			areCanvasReadyRequirementsMet( {
				hasTitle: true,
				needsOwner: true,
				hasOwner: true,
				isOwnerContentReady: false,
			} )
		).toBe( false );

		expect(
			areCanvasReadyRequirementsMet( {
				hasTitle: true,
				needsOwner: true,
				hasOwner: true,
				isOwnerContentReady: true,
			} )
		).toBe( true );
	} );

	it( 'does not mark a row ready while its property schema is resolving', () => {
		expect(
			areCanvasReadyRequirementsMet( {
				hasTitle: true,
				isPropertiesResolving: true,
			} )
		).toBe( false );
	} );
} );

describe( 'useEditorBodyStyles', () => {
	it( 'keeps the merged styles reference stable while its inputs are unchanged', () => {
		const baseStyles = [ { css: '.base {}' } ];
		const extraStyles = [ { css: '.extra {}' } ];
		const { result, rerender } = renderHook(
			( props ) =>
				useEditorBodyStyles(
					props.baseStyles,
					props.extraStyles,
					props.isDocumentCanvas
				),
			{
				initialProps: {
					baseStyles,
					extraStyles,
					isDocumentCanvas: true,
				},
			}
		);
		const firstResult = result.current;

		rerender( { baseStyles, extraStyles, isDocumentCanvas: true } );

		expect( result.current ).toBe( firstResult );
	} );

	it( 'rebuilds the merged styles when extra styles change', () => {
		const baseStyles = [ { css: '.base {}' } ];
		const extraStyles = [ { css: '.extra {}' } ];
		const { result, rerender } = renderHook(
			( props ) =>
				useEditorBodyStyles(
					props.baseStyles,
					props.extraStyles,
					props.isDocumentCanvas
				),
			{
				initialProps: {
					baseStyles,
					extraStyles,
					isDocumentCanvas: true,
				},
			}
		);
		const firstResult = result.current;

		rerender( {
			baseStyles,
			extraStyles: [ { css: '.next-extra {}' } ],
			isDocumentCanvas: true,
		} );

		expect( result.current ).not.toBe( firstResult );
	} );
} );
