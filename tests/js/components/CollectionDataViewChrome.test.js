import { fireEvent, render, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/dataviews/wp', () => {
	const { useEffect, useState } = jest.requireActual( '@wordpress/element' );
	const Empty = () => null;
	const ViewConfig = () => {
		const [ isOpen, setIsOpen ] = useState( false );
		useEffect( () => {
			const closeOnEscape = ( event ) => {
				if ( event.key === 'Escape' ) {
					setIsOpen( false );
				}
			};
			globalThis.document.addEventListener( 'keydown', closeOnEscape );
			return () =>
				globalThis.document.removeEventListener(
					'keydown',
					closeOnEscape
				);
		}, [] );
		return (
			<button
				type="button"
				aria-expanded={ isOpen ? 'true' : 'false' }
				onClick={ () => setIsOpen( ( current ) => ! current ) }
			>
				View options
			</button>
		);
	};
	return {
		DataViews: {
			Search: Empty,
			FiltersToggle: Empty,
			LayoutSwitcher: Empty,
			ViewConfig,
			Filters: Empty,
			Layout: Empty,
		},
	};
} );

import { DataViewsChrome } from '../../../src/components/CollectionDataViewChrome';

describe( 'DataViewsChrome grid options state', () => {
	afterEach( () => {
		document.body.classList.remove( 'cortext-grid-view-options-open' );
	} );

	it( 'clears the global grid class when the options popover closes', async () => {
		const { getByRole } = render(
			<DataViewsChrome view={ { type: 'grid' } } />
		);
		const toggle = getByRole( 'button', { name: 'View options' } );

		fireEvent.click( toggle );
		await waitFor( () =>
			expect( document.body ).toHaveClass(
				'cortext-grid-view-options-open'
			)
		);

		fireEvent.keyDown( document, { key: 'Escape' } );
		await waitFor( () =>
			expect( document.body ).not.toHaveClass(
				'cortext-grid-view-options-open'
			)
		);
	} );
} );
