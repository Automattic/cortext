import { fireEvent, render, screen } from '@testing-library/react';

let mockRouteUri = 'settings/import';
let mockCanManageSettings = true;
let mockPublicWebAffordances = true;
const mockNavigate = jest.fn();

jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mockNavigate,
	useParams: () => ( { _splat: mockRouteUri } ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	Button: ( { children, label, isPressed, onClick, ...props } ) => (
		<button
			type="button"
			aria-label={ label }
			aria-pressed={ isPressed }
			onClick={ onClick }
			{ ...props }
		>
			{ children }
		</button>
	),
	Icon: ( { icon } ) => <span data-testid={ `icon-${ icon }` } />,
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( text ) => text,
} ) );

jest.mock( '@wordpress/icons', () => ( {
	chevronLeft: 'chevron-left',
	globe: 'globe',
	plugins: 'plugins',
	upload: 'upload',
} ) );

jest.mock( '../../../src/settings', () => ( {
	canManageCortextSettings: () => mockCanManageSettings,
	isPublicWebAffordancesEnabled: () => mockPublicWebAffordances,
} ) );

import SidebarSettingsNav from '../../../src/components/SidebarSettingsNav';

beforeEach( () => {
	mockNavigate.mockReset();
	mockRouteUri = 'settings/import';
	mockCanManageSettings = true;
	mockPublicWebAffordances = true;
} );

describe( 'SidebarSettingsNav', () => {
	it( 'calls onBack when Back is clicked', () => {
		const onBack = jest.fn();
		render( <SidebarSettingsNav collapsed={ false } onBack={ onBack } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );

		expect( onBack ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps Import visible and opens settings/import', () => {
		render(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);

		const importButton = screen.getByRole( 'button', { name: 'Import' } );
		expect( importButton ).toHaveAttribute( 'aria-pressed', 'true' );

		fireEvent.click( importButton );

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'settings/import' },
		} );
	} );

	it( 'only shows Published when publishing tools are available', () => {
		const { rerender } = render(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);
		expect(
			screen.getByRole( 'button', { name: 'Published' } )
		).toBeInTheDocument();

		mockPublicWebAffordances = false;
		rerender(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);

		expect(
			screen.queryByRole( 'button', { name: 'Published' } )
		).not.toBeInTheDocument();
	} );

	it( 'only shows Experiments when settings can be managed', () => {
		const { rerender } = render(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);
		expect(
			screen.getByRole( 'button', { name: 'Experiments' } )
		).toBeInTheDocument();

		mockCanManageSettings = false;
		rerender(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);

		expect(
			screen.queryByRole( 'button', { name: 'Experiments' } )
		).not.toBeInTheDocument();
	} );

	it( 'opens settings/experiments', () => {
		render(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Experiments' } )
		);

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'settings/experiments' },
		} );
	} );

	it( 'presses the item for the current settings page', () => {
		mockRouteUri = 'settings/published';

		render(
			<SidebarSettingsNav collapsed={ false } onBack={ jest.fn() } />
		);

		expect(
			screen.getByRole( 'button', { name: 'Import' } )
		).toHaveAttribute( 'aria-pressed', 'false' );
		expect(
			screen.getByRole( 'button', { name: 'Published' } )
		).toHaveAttribute( 'aria-pressed', 'true' );
	} );
} );
