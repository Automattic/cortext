import { render } from '@testing-library/react';

const mockUseCommand = jest.fn();
const mockOpen = jest.fn();
const mockNavigate = jest.fn();
let mockRecents = [];

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

jest.mock( '@wordpress/data', () => ( {
	createRegistry: () => ( { register: jest.fn() } ),
	RegistryProvider: ( { children } ) => children,
	useDispatch: () => ( { open: mockOpen } ),
} ) );

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

jest.mock( '../../../src/components/CortextCommandMenu', () => () => null );

jest.mock( '../../../src/components/PageIcon', () => () => null );

import CommandPalette from '../../../src/components/CommandPalette';

beforeEach( () => {
	jest.useFakeTimers();
	mockUseCommand.mockReset();
	mockOpen.mockReset();
	mockNavigate.mockReset();
	mockRecents = [];
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
