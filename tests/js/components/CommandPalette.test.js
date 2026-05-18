import { act, render } from '@testing-library/react';

const mockUseCommand = jest.fn();
const mockCreateRegistry = jest.fn( () => ( { register: jest.fn() } ) );
const mockOpen = jest.fn();
const mockNavigate = jest.fn();
const mockParentRegistry = { parent: true };
const mockUseDocuments = jest.fn();
let mockRecents = [];
let mockIsPaletteOpen = false;

jest.mock( '@wordpress/commands', () => ( {
	store: { name: 'core/commands' },
	useCommand: ( command ) => mockUseCommand( command ),
} ) );

jest.mock( '@wordpress/keyboard-shortcuts', () => ( {
	store: { name: 'core/keyboard-shortcuts' },
} ) );

jest.mock( '@wordpress/preferences', () => ( {
	store: { name: 'core/preferences' },
} ) );

jest.mock( '@wordpress/data', () => {
	const fakeIsOpenSelector = () => mockIsPaletteOpen;
	return {
		createRegistry: ( ...args ) => mockCreateRegistry( ...args ),
		RegistryProvider: ( { children } ) => children,
		useDispatch: () => ( { open: mockOpen } ),
		useRegistry: () => mockParentRegistry,
		useSelect: ( mapSelect ) =>
			mapSelect( () => ( { isOpen: fakeIsOpenSelector } ) ),
	};
} );

jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '../../../src/hooks/useWorkspaceHomePath', () => ( {
	useWorkspaceHomePath: () => ( {
		homePath: 'page/home-1',
		isResolvingHomePath: false,
	} ),
} ) );

jest.mock( '../../../src/hooks/useRecents', () => ( {
	useRecents: () => ( { recents: mockRecents } ),
} ) );

jest.mock( '../../../src/hooks/useDocuments', () => ( {
	__esModule: true,
	default: ( args ) => mockUseDocuments( args ),
} ) );

const mockMenu = {
	search: '',
	setSearch: () => {},
	isDocumentSearchPending: false,
	descriptions: new Map(),
};

jest.mock( '../../../src/components/CortextCommandMenu', () => {
	const { createContext, useContext } = require( '@wordpress/element' );
	const CommandDescriptionContext = createContext( new Map() );
	const MockCortextCommandMenu = ( props ) => {
		mockMenu.search = props.search;
		mockMenu.setSearch = props.setSearch;
		mockMenu.isDocumentSearchPending = props.isDocumentSearchPending;
		mockMenu.descriptions = useContext( CommandDescriptionContext );
		return null;
	};
	return {
		__esModule: true,
		default: MockCortextCommandMenu,
		CommandDescriptionContext,
	};
} );

jest.mock( '../../../src/components/PageIcon', () => () => null );

import CommandPalette from '../../../src/components/CommandPalette';

beforeEach( () => {
	jest.useFakeTimers();
	mockUseCommand.mockReset();
	mockCreateRegistry.mockClear();
	mockOpen.mockReset();
	mockNavigate.mockReset();
	mockUseDocuments.mockReset();
	mockUseDocuments.mockReturnValue( {
		documents: [],
		total: 0,
		isLoading: false,
		hasResolved: true,
		error: null,
		refresh: jest.fn(),
	} );
	mockRecents = [];
	mockIsPaletteOpen = false;
	mockMenu.descriptions = new Map();
} );

afterEach( () => {
	jest.useRealTimers();
} );

describe( 'CommandPalette recents', () => {
	it( 'registers a command for each recent item', () => {
		mockRecents = [
			{
				kind: 'page',
				id: 7,
				title: 'Notes',
				path: 'page/notes-7',
			},
			{
				kind: 'row',
				id: 12,
				title: 'Ada Lovelace',
				path: 'collection/people-9',
				collection: { title: 'People' },
			},
		];

		render( <CommandPalette canvasRef={ { current: null } } /> );

		expect( mockCreateRegistry ).toHaveBeenCalledWith(
			{},
			mockParentRegistry
		);

		const commands = mockUseCommand.mock.calls.map(
			( [ command ] ) => command
		);
		expect( commands ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					name: 'cortext/recent/page-7',
					label: 'Notes',
					searchLabel: 'Open recent: Notes',
				} ),
				expect.objectContaining( {
					name: 'cortext/recent/row-12',
					label: 'Ada Lovelace in People',
					searchLabel: 'Open recent: Ada Lovelace in People',
				} ),
			] )
		);
	} );

	it( 'navigates to the recent path when a recent command runs', () => {
		const close = jest.fn();
		const focus = jest.fn();
		mockRecents = [
			{
				kind: 'collection',
				id: 9,
				title: 'People',
				path: 'collection/people-9',
			},
		];

		render( <CommandPalette canvasRef={ { current: { focus } } } /> );

		const command = mockUseCommand.mock.calls
			.map( ( [ registered ] ) => registered )
			.find(
				( registered ) =>
					registered.name === 'cortext/recent/collection-9'
			);

		command.callback( { close } );

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'collection/people-9' },
		} );
		expect( close ).toHaveBeenCalled();
		jest.runOnlyPendingTimers();
		expect( focus ).toHaveBeenCalledWith( { preventScroll: true } );
	} );
} );

describe( 'CommandPalette document search', () => {
	it( 'does not fetch documents while the palette is closed', () => {
		mockIsPaletteOpen = false;
		render( <CommandPalette canvasRef={ { current: null } } /> );

		expect( mockUseDocuments ).not.toHaveBeenCalled();
	} );

	it( 'does not fetch documents when the palette is open but the input is empty', () => {
		mockIsPaletteOpen = true;
		render( <CommandPalette canvasRef={ { current: null } } /> );

		expect( mockUseDocuments ).not.toHaveBeenCalled();
	} );

	it( 'registers document results and opens the selected path', () => {
		const close = jest.fn();
		mockIsPaletteOpen = true;
		mockUseDocuments.mockReturnValue( {
			documents: [
				{
					kind: 'page',
					id: 42,
					title: 'Roadmap',
					path: 'roadmap-42',
					excerpt: 'Quarterly themes for next half.',
				},
				{
					kind: 'row',
					id: 77,
					title: 'Ship the thing',
					path: 'ship-the-thing-77',
					collection: {
						id: 9,
						title: 'Projects',
						path: 'collection/projects-9',
					},
				},
			],
			total: 2,
			isLoading: false,
			hasResolved: true,
			error: null,
			refresh: jest.fn(),
		} );

		render( <CommandPalette canvasRef={ { current: null } } /> );

		act( () => {
			mockMenu.setSearch( 'quarterly' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		expect( mockUseDocuments ).toHaveBeenCalledWith(
			expect.objectContaining( { search: 'quarterly', perPage: 10 } )
		);

		const commands = mockUseCommand.mock.calls.map(
			( [ command ] ) => command
		);
		const pageCommand = commands.find(
			( c ) => c.name === 'cortext/document/page-42'
		);
		const rowCommand = commands.find(
			( c ) => c.name === 'cortext/document/row-77'
		);

		expect( pageCommand ).toMatchObject( {
			label: 'Roadmap',
			keywords: [ 'quarterly', 'page' ],
		} );
		expect( rowCommand ).toMatchObject( {
			label: 'Ship the thing',
			keywords: [ 'quarterly', 'row' ],
		} );
		expect( mockMenu.descriptions.get( 'cortext/document/page-42' ) ).toBe(
			'Quarterly themes for next half.'
		);
		expect( mockMenu.descriptions.get( 'cortext/document/row-77' ) ).toBe(
			'in Projects'
		);

		pageCommand.callback( { close } );
		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'roadmap-42' },
		} );
		expect( close ).toHaveBeenCalled();
	} );

	it( 'keeps the menu pending while document search resolves', () => {
		mockIsPaletteOpen = true;
		mockUseDocuments.mockReturnValue( {
			documents: [],
			total: 0,
			isLoading: true,
			hasResolved: false,
			error: null,
			refresh: jest.fn(),
		} );

		render( <CommandPalette canvasRef={ { current: null } } /> );

		act( () => {
			mockMenu.setSearch( 'pending' );
		} );

		// The menu should stay pending during the debounce so it does not flash
		// "No results".
		expect( mockMenu.isDocumentSearchPending ).toBe( true );

		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		expect( mockMenu.isDocumentSearchPending ).toBe( true );

		// Resolve the fetch. A new search makes the parent re-render, which lets
		// DocumentResultsRegistration read the mocked hook value again.
		mockUseDocuments.mockReturnValue( {
			documents: [],
			total: 0,
			isLoading: false,
			hasResolved: true,
			error: null,
			refresh: jest.fn(),
		} );
		act( () => {
			mockMenu.setSearch( 'resolved' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		expect( mockMenu.isDocumentSearchPending ).toBe( false );
	} );

	it( 'does not register stale documents while a new query is loading', () => {
		mockIsPaletteOpen = true;
		const staleDocs = [
			{
				kind: 'page',
				id: 1,
				title: 'Stale',
				path: 'stale-1',
				excerpt: 'old content',
			},
		];
		mockUseDocuments.mockReturnValue( {
			documents: staleDocs,
			total: 1,
			isLoading: false,
			hasResolved: true,
			error: null,
			refresh: jest.fn(),
		} );

		render( <CommandPalette canvasRef={ { current: null } } /> );

		act( () => {
			mockMenu.setSearch( 'first' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		// Sanity check: the resolved doc is registered for the first search.
		expect(
			mockUseCommand.mock.calls
				.map( ( [ c ] ) => c )
				.some(
					( c ) =>
						c.name === 'cortext/document/page-1' &&
						c.keywords?.includes( 'first' )
				)
		).toBe( true );

		mockUseCommand.mockClear();

		// New query is in flight: useDocuments keeps the previous documents
		// but flips hasResolved to false.
		mockUseDocuments.mockReturnValue( {
			documents: staleDocs,
			total: 1,
			isLoading: true,
			hasResolved: false,
			error: null,
			refresh: jest.fn(),
		} );

		act( () => {
			mockMenu.setSearch( 'second' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		// The stale doc must NOT be re-registered with the new keyword.
		expect(
			mockUseCommand.mock.calls
				.map( ( [ c ] ) => c )
				.some(
					( c ) =>
						c.name === 'cortext/document/page-1' &&
						c.keywords?.includes( 'second' )
				)
		).toBe( false );

		// Description for the stale result is cleared too, so the next item
		// rendered under the new query does not inherit an old hint.
		expect( mockMenu.descriptions.size ).toBe( 0 );
	} );
} );
