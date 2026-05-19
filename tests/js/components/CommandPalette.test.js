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
	selectedValue: undefined,
	onSelectedValueChange: () => {},
};

jest.mock( '../../../src/components/CortextCommandMenu', () => {
	const { createContext, useContext } = require( '@wordpress/element' );
	const CommandDescriptionContext = createContext( new Map() );
	const MockCortextCommandMenu = ( props ) => {
		mockMenu.search = props.search;
		mockMenu.setSearch = props.setSearch;
		mockMenu.isDocumentSearchPending = props.isDocumentSearchPending;
		mockMenu.descriptions = useContext( CommandDescriptionContext );
		mockMenu.selectedValue = props.selectedValue;
		mockMenu.onSelectedValueChange = props.onSelectedValueChange;
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
			keywords: [ 'page' ],
		} );
		expect( rowCommand ).toMatchObject( {
			label: 'Ship the thing',
			keywords: [ 'row' ],
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

	it( 'keeps stale documents visible while the next query is in flight', () => {
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

		// Sanity check: the resolved doc is registered.
		expect(
			mockUseCommand.mock.calls
				.map( ( [ c ] ) => c )
				.some( ( c ) => c.name === 'cortext/document/page-1' )
		).toBe( true );

		mockUseCommand.mockClear();

		// New query is in flight: useDocuments keeps the previous documents
		// but flips hasResolved to false. The stale doc stays registered so
		// the user does not see a flicker between keystrokes.
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

		expect(
			mockUseCommand.mock.calls
				.map( ( [ c ] ) => c )
				.some( ( c ) => c.name === 'cortext/document/page-1' )
		).toBe( true );

		// Descriptions stay populated so the second line does not flicker.
		expect(
			mockMenu.descriptions.get( 'cortext/document/page-1' )
		).toBeTruthy();
	} );

	it( 'anchors the selection to the first document on first arrival, leaves later fetches alone, and clears on empty input', () => {
		mockIsPaletteOpen = true;
		mockUseDocuments.mockReturnValue( {
			documents: [
				{ kind: 'page', id: 42, title: 'Alice', path: 'alice-42' },
				{ kind: 'row', id: 77, title: 'Bob', path: 'bob-77' },
			],
			total: 2,
			isLoading: false,
			hasResolved: true,
			error: null,
			refresh: jest.fn(),
		} );

		render( <CommandPalette canvasRef={ { current: null } } /> );

		act( () => {
			mockMenu.setSearch( 'ali' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		expect( mockMenu.selectedValue ).toBe(
			'document-cortext/document/page-42'
		);

		// User (or cmdk) moves the selection. The next refinement must not
		// jump back to the new first doc; cmdk owns the value from here.
		act( () => {
			mockMenu.onSelectedValueChange(
				'document-cortext/document/row-77'
			);
		} );
		mockUseDocuments.mockReturnValue( {
			documents: [
				{ kind: 'row', id: 99, title: 'Alicia', path: 'alicia-99' },
				{ kind: 'page', id: 42, title: 'Alice', path: 'alice-42' },
				{ kind: 'row', id: 77, title: 'Bob', path: 'bob-77' },
			],
			total: 3,
			isLoading: false,
			hasResolved: true,
			error: null,
			refresh: jest.fn(),
		} );
		act( () => {
			mockMenu.setSearch( 'alic' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );
		expect( mockMenu.selectedValue ).toBe(
			'document-cortext/document/row-77'
		);

		// Clearing the input drops the anchor so cmdk picks fresh next time.
		act( () => {
			mockMenu.setSearch( '' );
		} );
		expect( mockMenu.selectedValue ).toBeUndefined();
	} );

	it( 'clears the input and the controlled selection when the palette closes', () => {
		mockIsPaletteOpen = true;
		mockUseDocuments.mockReturnValue( {
			documents: [ { kind: 'page', id: 1, title: 'Foo', path: 'foo-1' } ],
			total: 1,
			isLoading: false,
			hasResolved: true,
			error: null,
			refresh: jest.fn(),
		} );

		const { rerender } = render(
			<CommandPalette canvasRef={ { current: null } } />
		);

		act( () => {
			mockMenu.setSearch( 'foo' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );
		expect( mockMenu.search ).toBe( 'foo' );
		expect( mockMenu.selectedValue ).toBe(
			'document-cortext/document/page-1'
		);

		// Simulate the palette closing after the user picked a result.
		// `close()` from the command callback bypasses `closeAndReset`, so
		// without the new cleanup the next open would start with the old
		// search prepopulated.
		mockIsPaletteOpen = false;
		rerender( <CommandPalette canvasRef={ { current: null } } /> );

		expect( mockMenu.search ).toBe( '' );
		expect( mockMenu.selectedValue ).toBeUndefined();
	} );

	it( 'drops stale documents when the next query fails', () => {
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

		mockUseCommand.mockClear();

		// Failed fetch: useDocuments resolves with hasResolved=true,
		// keeps the previous documents, and exposes the error. The
		// palette must hide the stale list so the user does not navigate
		// to a document that no longer matches their query.
		mockUseDocuments.mockReturnValue( {
			documents: staleDocs,
			total: 1,
			isLoading: false,
			hasResolved: true,
			error: new Error( 'network' ),
			refresh: jest.fn(),
		} );

		act( () => {
			mockMenu.setSearch( 'second' );
		} );
		act( () => {
			jest.advanceTimersByTime( 150 );
		} );

		expect(
			mockUseCommand.mock.calls
				.map( ( [ c ] ) => c )
				.some( ( c ) => c.name === 'cortext/document/page-1' )
		).toBe( false );
	} );
} );
