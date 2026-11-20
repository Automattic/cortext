import { act, render, screen, waitFor } from '@testing-library/react';

import EntityRoute from '../../../src/router/EntityRoute';

let mockSplat = '';
let mockResolution = null;
// Hooks hand back stable values, as the real ones do, so effects keyed on
// them don't re-run on every render.
const mockNavigate = jest.fn();
const mockPages = { records: [], isResolving: false };
const mockCoreDispatch = { invalidateResolution: jest.fn() };
const mockRecents = { touchRecent: jest.fn() };
const mockHome = { home: null, isResolving: false };
const mockCollectionFields = { isResolving: false };
const mockSurfaceFocus = { request: null, consume: jest.fn() };

jest.mock( '@tanstack/react-router', () => ( {
	useParams: () => ( { _splat: mockSplat } ),
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecords: () => mockPages,
} ) );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => mockCoreDispatch,
} ) );

jest.mock( '../../../src/router/useResolveEntity', () => ( {
	...jest.requireActual( '../../../src/router/useResolveEntity' ),
	useResolveDocument: () => mockResolution,
} ) );

jest.mock( '../../../src/components/Canvas', () => ( {
	__esModule: true,
	default: function MockCanvas( { postId, onDisplayedPost } ) {
		const { useEffect } = jest.requireActual( '@wordpress/element' );
		useEffect( () => {
			onDisplayedPost( postId );
		}, [ postId, onDisplayedPost ] );
		return <div data-testid="canvas">{ postId }</div>;
	},
} ) );

jest.mock( '../../../src/hooks/useRecents', () => ( {
	useRecents: () => mockRecents,
} ) );

jest.mock( '../../../src/hooks/useWorkspaceHome', () => ( {
	useWorkspaceHome: () => mockHome,
} ) );

jest.mock( '../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	default: () => mockCollectionFields,
} ) );

jest.mock( '../../../src/components/SurfaceFocusContext', () => ( {
	useSurfaceFocusIntent: () => mockSurfaceFocus,
} ) );

jest.mock( '../../../src/settings', () => ( {
	isPublicWebAffordancesEnabled: () => false,
} ) );

jest.mock( '../../../src/components/EditableCell', () => ( {
	RowMutationContext: jest
		.requireActual( '@wordpress/element' )
		.createContext( null ),
} ) );
jest.mock( '../../../src/components/Skeleton', () => ( {
	CanvasProgressBar: () => null,
} ) );
jest.mock( '../../../src/components/CanvasSkeleton', () => () => null );
jest.mock( '../../../src/components/PublishedDocumentsPane', () => () => null );
jest.mock( '../../../src/components/WorkspaceTopBar', () => () => null );
jest.mock( '../../../src/components/CortextSnackbars', () => () => null );
jest.mock( '../../../src/components/ExperimentsPane', () => () => null );
jest.mock( '../../../src/components/ImportPane', () => () => null );
const mockLifecycleView = jest.fn( () => null );
jest.mock(
	'../../../src/components/lifecycle/LifecycleView',
	() =>
		( ...args ) =>
			mockLifecycleView( ...args )
);
jest.mock( '../../../src/components/lifecycle/lifecycleStates', () => ( {
	TRASH: { name: 'trash' },
	ARCHIVED: { name: 'archived' },
} ) );

// Whether the last render of a lifecycle pane asked it to load.
function lastLifecycleViewActive( name ) {
	const calls = mockLifecycleView.mock.calls.filter(
		( [ props ] ) => props.state.name === name
	);
	return calls[ calls.length - 1 ][ 0 ].isActive;
}
jest.mock( '../../../src/router/EmptyState', () => () => null );

const resolved = ( id ) => ( {
	entity: { id },
	traitIds: [],
	isResolving: false,
	notFound: false,
	id,
} );

describe( 'EntityRoute', () => {
	let heldTransitions;
	let holdTransitions;

	beforeEach( () => {
		mockSplat = '';
		mockResolution = {
			entity: null,
			traitIds: [],
			isResolving: false,
			notFound: false,
			id: null,
		};
		heldTransitions = [];
		holdTransitions = true;
		// The browser runs the update callback once it has captured a frame,
		// which a slow or occluded window can put off for a long time.
		document.startViewTransition = ( callback ) => {
			if ( holdTransitions ) {
				heldTransitions.push( callback );
			} else {
				Promise.resolve().then( callback );
			}
			return {
				ready: Promise.resolve(),
				finished: Promise.resolve(),
				updateCallbackDone: Promise.resolve(),
			};
		};
	} );

	afterEach( () => {
		delete document.startViewTransition;
	} );

	it( 'opens a document that resolves before the loading pane transition runs', async () => {
		const { rerender } = render( <EntityRoute /> );

		// The home redirect lands on a document whose record is already in hand,
		// so the resolution reaches the route while the switch to the loading
		// pane still waits on its view transition.
		mockSplat = 'welcome-to-cortext-284';
		mockResolution = resolved( 284 );
		rerender( <EntityRoute /> );
		expect( heldTransitions ).toHaveLength( 1 );

		holdTransitions = false;
		act( () => heldTransitions.forEach( ( callback ) => callback() ) );

		expect( await screen.findByTestId( 'canvas' ) ).toHaveTextContent(
			'284'
		);
		expect(
			document.querySelector(
				'.cortext-workspace__pane[data-active="true"] [data-testid="canvas"]'
			)
		).not.toBeNull();
	} );

	it( 'stops the Trash pane as soon as the URL leaves Trash', () => {
		mockSplat = 'trash';
		const { rerender } = render( <EntityRoute /> );
		expect( lastLifecycleViewActive( 'trash' ) ).toBe( true );
		expect( lastLifecycleViewActive( 'archived' ) ).toBe( false );

		// Opening a document changes the URL before the Trash pane fades out.
		mockSplat = 'old-draft-722';
		mockResolution = { ...resolved( 722 ), isResolving: true };
		rerender( <EntityRoute /> );

		expect( lastLifecycleViewActive( 'trash' ) ).toBe( false );
	} );

	it( 'shows the Archived pane at `archived`', () => {
		mockSplat = 'archived';
		render( <EntityRoute /> );
		expect( lastLifecycleViewActive( 'archived' ) ).toBe( true );
		expect( lastLifecycleViewActive( 'trash' ) ).toBe( false );
	} );

	it( 'keeps documents opened from Archived out of Recents', async () => {
		mockRecents.touchRecent.mockClear();
		mockSplat = 'archived/722';
		mockResolution = resolved( 722 );
		holdTransitions = false;
		render( <EntityRoute /> );
		expect( await screen.findByTestId( 'canvas' ) ).toHaveTextContent(
			'722'
		);
		expect( mockRecents.touchRecent ).not.toHaveBeenCalled();
	} );

	it( 'opens the item Trash selects while the switch to Trash still waits on its transition', async () => {
		mockSplat = 'welcome-to-cortext-284';
		mockResolution = resolved( 284 );
		holdTransitions = false;
		const { rerender } = render( <EntityRoute /> );
		expect( await screen.findByTestId( 'canvas' ) ).toHaveTextContent(
			'284'
		);

		// Trash opens, and before its pane transition runs the sidebar selects
		// the first item, which opens that document from Trash.
		holdTransitions = true;
		mockSplat = 'trash';
		rerender( <EntityRoute /> );
		mockSplat = 'trash/722';
		mockResolution = resolved( 722 );
		rerender( <EntityRoute /> );

		holdTransitions = false;
		act( () => heldTransitions.forEach( ( callback ) => callback() ) );

		// The held switch to Trash must not win over the newer document: the
		// document pane is the one showing.
		await waitFor( () =>
			expect(
				document.querySelector(
					'.cortext-workspace__pane[data-active="true"] [data-testid="canvas"]'
				)
			).toHaveTextContent( '722' )
		);
	} );
} );
