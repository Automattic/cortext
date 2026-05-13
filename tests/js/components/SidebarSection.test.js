import { render, screen, fireEvent } from '@testing-library/react';

import SidebarSection from '../../../src/components/SidebarSection';

describe( 'SidebarSection', () => {
	it( 'renders an expanded section with accessible toggle state', () => {
		render(
			<SidebarSection
				id="pages"
				title="Pages"
				isCollapsed={ false }
				onToggle={ jest.fn() }
			>
				<div>Page row</div>
			</SidebarSection>
		);

		const toggle = screen.getByRole( 'button', {
			name: 'Collapse Pages',
		} );

		expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'Page row' ) ).toBeInTheDocument();
	} );

	it( 'hides the body when collapsed and calls onToggle from the title', () => {
		const onToggle = jest.fn();
		render(
			<SidebarSection
				id="pages"
				title="Pages"
				isCollapsed
				onToggle={ onToggle }
			>
				<div>Page row</div>
			</SidebarSection>
		);

		const toggle = screen.getByRole( 'button', {
			name: 'Expand Pages',
		} );

		expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			screen
				.getByText( 'Page row' )
				.closest( '.cortext-sidebar__section-body-wrapper' )
		).toHaveAttribute( 'aria-hidden', 'true' );
		expect(
			screen
				.getByText( 'Page row' )
				.closest( '.cortext-sidebar__section-body-wrapper' )
		).toHaveAttribute( 'inert' );

		fireEvent.click( toggle );

		expect( onToggle ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'renders header actions without making them section toggles', () => {
		const onToggle = jest.fn();
		const onAction = jest.fn();
		render(
			<SidebarSection
				id="pages"
				title="Pages"
				isCollapsed={ false }
				onToggle={ onToggle }
				actions={ <button onClick={ onAction }>New page</button> }
			>
				<div>Page row</div>
			</SidebarSection>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'New page' } ) );

		expect( onAction ).toHaveBeenCalledTimes( 1 );
		expect( onToggle ).not.toHaveBeenCalled();
	} );
} );
