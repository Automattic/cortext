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

jest.mock( '@wordpress/notices', () => ( {
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
	getDocumentSurfaceFocusClientId,
	getEditorBodyMutationPermissions,
	projectIframeRectToParent,
	rectsOverlap,
	scheduleDocumentSurfaceFocus,
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

describe( 'getDocumentSurfaceFocusClientId', () => {
	const headerBlocks = [
		namedBlock( 'cover', 'cortext/document-cover' ),
		namedBlock( 'icon', 'cortext/document-icon' ),
		namedBlock( 'title', 'core/post-title' ),
		namedBlock( 'properties', 'cortext/document-properties' ),
	];

	it.each( [ '', '   ', '\n\t' ] )(
		'focuses the title when its content is %j',
		( title ) => {
			expect(
				getDocumentSurfaceFocusClientId( {
					blocks: [
						...headerBlocks,
						namedBlock( 'body', 'core/paragraph' ),
					],
					title,
				} )
			).toBe( 'title' );
		}
	);

	it( 'skips document headers and focuses the first root body block', () => {
		expect(
			getDocumentSurfaceFocusClientId( {
				blocks: [
					...headerBlocks,
					namedBlock( 'first-body', 'core/heading' ),
					namedBlock( 'second-body', 'core/paragraph' ),
				],
				title: 'Titled document',
			} )
		).toBe( 'first-body' );
	} );

	it( 'falls back to the title when a titled document has no body block', () => {
		expect(
			getDocumentSurfaceFocusClientId( {
				blocks: headerBlocks,
				title: 'Titled document',
			} )
		).toBe( 'title' );
	} );

	it( 'returns no page target for collections', () => {
		expect(
			getDocumentSurfaceFocusClientId( {
				blocks: headerBlocks,
				title: '',
				ownerBlockName: OWNER,
			} )
		).toBeNull();
	} );
} );

describe( 'scheduleDocumentSurfaceFocus', () => {
	function setup() {
		let frameCallback;
		const ownerWindow = {
			requestAnimationFrame: jest.fn( ( callback ) => {
				frameCallback = callback;
				return 7;
			} ),
			cancelAnimationFrame: jest.fn(),
		};
		const selectBlock = jest.fn();
		const completeSurfaceFocus = jest.fn( ( token, onConsume ) => {
			onConsume();
			return true;
		} );

		return {
			completeSurfaceFocus,
			ownerWindow,
			runFrame: () => frameCallback(),
			selectBlock,
		};
	}

	it( 'clears the selection, then revalidates and places the caret on the next frame', () => {
		const state = setup();
		scheduleDocumentSurfaceFocus( {
			clientId: 'body',
			completeSurfaceFocus: state.completeSurfaceFocus,
			originIsCurrent: () => true,
			ownerWindow: state.ownerWindow,
			requestIsCurrent: () => true,
			selectBlock: state.selectBlock,
			token: 9,
		} );

		expect( state.selectBlock ).toHaveBeenCalledWith( 'body', null );
		expect( state.completeSurfaceFocus ).not.toHaveBeenCalled();

		state.runFrame();

		expect( state.completeSurfaceFocus ).toHaveBeenCalledWith(
			9,
			expect.any( Function )
		);
		expect( state.selectBlock ).toHaveBeenLastCalledWith( 'body', 0 );
	} );

	it( 'stops if the request is cancelled before the next frame', () => {
		const state = setup();
		let requestIsCurrent = true;
		scheduleDocumentSurfaceFocus( {
			clientId: 'body',
			completeSurfaceFocus: state.completeSurfaceFocus,
			originIsCurrent: () => true,
			ownerWindow: state.ownerWindow,
			requestIsCurrent: () => requestIsCurrent,
			selectBlock: state.selectBlock,
			token: 9,
		} );
		requestIsCurrent = false;

		state.runFrame();

		expect( state.completeSurfaceFocus ).not.toHaveBeenCalled();
		expect( state.selectBlock ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'rectsOverlap', () => {
	const toolbarRect = { left: 100, top: 100, right: 200, bottom: 150 };

	it( 'detects an intersection with positive area', () => {
		expect(
			rectsOverlap( toolbarRect, {
				left: 150,
				top: 125,
				right: 250,
				bottom: 175,
			} )
		).toBe( true );
	} );

	it( 'does not treat touching edges as overlap', () => {
		expect(
			rectsOverlap( toolbarRect, {
				left: 200,
				top: 100,
				right: 250,
				bottom: 150,
			} )
		).toBe( false );
	} );
} );

describe( 'projectIframeRectToParent', () => {
	it( 'accounts for iframe borders and scaling and clips the result to the viewport', () => {
		const frameElement = {
			clientHeight: 50,
			clientLeft: 5,
			clientTop: 5,
			clientWidth: 100,
			getBoundingClientRect: () => ( {
				left: 10,
				top: 20,
				width: 220,
				height: 120,
			} ),
			offsetHeight: 60,
			offsetWidth: 110,
		};

		expect(
			projectIframeRectToParent(
				{ left: -25, top: 10, right: 250, bottom: 120 },
				frameElement,
				{ innerWidth: 100, innerHeight: 50 }
			)
		).toEqual( { left: 20, top: 50, right: 220, bottom: 130 } );
	} );

	it( 'returns null while the frame has no layout box', () => {
		const frameElement = {
			getBoundingClientRect: () => ( { width: 0, height: 0 } ),
			offsetHeight: 0,
			offsetWidth: 0,
		};

		expect(
			projectIframeRectToParent(
				{ left: 0, top: 0, right: 10, bottom: 10 },
				frameElement,
				{}
			)
		).toBeNull();
	} );
} );

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

describe( 'getEditorBodyMutationPermissions', () => {
	it( 'keeps lock-safe structural maintenance active during an external post lock', () => {
		expect(
			getEditorBodyMutationPermissions( { isLocked: true } )
		).toEqual( {
			canMaintainBodyStructure: true,
			canRepairUnlockedStructure: false,
		} );
	} );

	it( 'prevents every body mutation while previewing a revision', () => {
		expect(
			getEditorBodyMutationPermissions( {
				isLocked: true,
				isRevisionsMode: true,
			} )
		).toEqual( {
			canMaintainBodyStructure: false,
			canRepairUnlockedStructure: false,
		} );
	} );

	it( 'prevents every body mutation for trashed documents', () => {
		expect(
			getEditorBodyMutationPermissions( { isTrashed: true } )
		).toEqual( {
			canMaintainBodyStructure: false,
			canRepairUnlockedStructure: false,
		} );
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
