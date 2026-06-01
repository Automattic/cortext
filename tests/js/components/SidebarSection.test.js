import { render, screen, fireEvent } from '@testing-library/react';

import SidebarSection from '../../../src/components/SidebarSection';

describe( 'SidebarSection', () => {
	it( 'renders an expanded section with accessible toggle state', () => {
		render(
			<SidebarSection
				id="pages"
				title="Documents"
				isCollapsed={ false }
				onToggle={ jest.fn() }
			>
				<div>Document row</div>
			</SidebarSection>
		);

		const toggle = screen.getByRole( 'button', {
			name: 'Collapse Documents',
		} );

		expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'Document row' ) ).toBeInTheDocument();
	} );

	it( 'hides the body when collapsed and calls onToggle from the title', () => {
		const onToggle = jest.fn();
		render(
			<SidebarSection
				id="pages"
				title="Documents"
				isCollapsed
				onToggle={ onToggle }
			>
				<div>Document row</div>
			</SidebarSection>
		);

		const toggle = screen.getByRole( 'button', {
			name: 'Expand Documents',
		} );

		expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		expect(
			screen
				.getByText( 'Document row' )
				.closest( '.cortext-sidebar__section-body-wrapper' )
		).toHaveAttribute( 'aria-hidden', 'true' );
		expect(
			screen
				.getByText( 'Document row' )
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
				title="Documents"
				isCollapsed={ false }
				onToggle={ onToggle }
				actions={ <button onClick={ onAction }>New document</button> }
			>
				<div>Document row</div>
			</SidebarSection>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'New document' } )
		);

		expect( onAction ).toHaveBeenCalledTimes( 1 );
		expect( onToggle ).not.toHaveBeenCalled();
	} );
} );
