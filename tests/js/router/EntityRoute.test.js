import { act, render, screen } from '@testing-library/react';

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
} );
