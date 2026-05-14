import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRegistry, RegistryProvider } from '@wordpress/data';
import { store as commandsStore } from '@wordpress/commands';
import { store as keyboardShortcutsStore } from '@wordpress/keyboard-shortcuts';
import { store as preferencesStore } from '@wordpress/preferences';
import { table } from '@wordpress/icons';

import {
	CommandIcon,
	default as CortextCommandMenu,
	splitPaletteCommands,
} from '../../../src/components/CortextCommandMenu';

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

function createCommandPaletteRegistry() {
	const registry = createRegistry();
	registry.register( commandsStore );
	registry.register( keyboardShortcutsStore );
	registry.register( preferencesStore );
	return registry;
}

describe( 'splitPaletteCommands', () => {
	it( 'separates Cortext recents from the rest of the palette commands', () => {
		const home = { name: 'cortext/home', label: 'Go to home' };
		const page = { name: 'cortext/recent/page-7', label: 'Notes' };
		const row = {
			name: 'cortext/recent/row-12',
			label: 'Ada Lovelace in People',
		};

		expect( splitPaletteCommands( [ home, page, row ] ) ).toEqual( {
			recentCommands: [ page, row ],
			commands: [ home ],
		} );
	} );
} );

describe( 'CommandIcon', () => {
	it( 'sizes raw WordPress icon elements before rendering them', () => {
		const { container } = render( <CommandIcon icon={ table } /> );

		const icon = container.querySelector( 'svg' );
		expect( icon ).toHaveAttribute( 'width', '16' );
		expect( icon ).toHaveAttribute( 'height', '16' );
	} );
} );

describe( 'CortextCommandMenu', () => {
	it( 'opens from the primary+k keyboard shortcut', async () => {
		global.ResizeObserver = ResizeObserverMock;
		Element.prototype.scrollIntoView = jest.fn();
		const registry = createCommandPaletteRegistry();
		registry.dispatch( commandsStore ).registerCommand( {
			name: 'cortext/test',
			label: 'Test command',
			context: 'root',
			callback: jest.fn(),
		} );

		render(
			<RegistryProvider value={ registry }>
				<CortextCommandMenu />
			</RegistryProvider>
		);

		await waitFor( () =>
			expect(
				registry
					.select( keyboardShortcutsStore )
					.getShortcutKeyCombination( 'core/commands' )
			).toEqual( { modifier: 'primary', character: 'k' } )
		);

		fireEvent.keyDown( document, {
			key: 'k',
			code: 'KeyK',
			ctrlKey: true,
		} );

		expect(
			await screen.findByPlaceholderText(
				'Search pages, collections, and actions'
			)
		).toBeInTheDocument();
		expect( screen.getByText( 'Test command' ) ).toBeInTheDocument();
	} );
} );
