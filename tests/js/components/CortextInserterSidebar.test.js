/**
 * Covers `src/components/CortextInserterSidebar.js`. The sidebar mirrors the
 * `core/editor` store's `isInserterOpened` state into rendered UI, forwards
 * the carried insertion context to the inserter library, and closes on
 * ESC or the library's onClose.
 */

import { fireEvent, render, screen } from '@testing-library/react';

let mockInserterState;
const mockSetIsInserterOpened = jest.fn();

jest.mock( '@wordpress/data', () => ( {
	useSelect: ( cb ) =>
		cb( () => ( {
			isInserterOpened: () => mockInserterState,
		} ) ),
	useDispatch: () => ( {
		setIsInserterOpened: mockSetIsInserterOpened,
	} ),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	store: { name: 'core/editor' },
} ) );

jest.mock( '@wordpress/block-editor', () => {
	// `@wordpress/element`'s `forwardRef` isn't loaded under jsdom mocks, so
	// pull from React directly to mirror what the real component does.
	const { forwardRef: realForwardRef } = jest.requireActual( 'react' );
	return {
		__experimentalLibrary: realForwardRef( function MockedLibrary(
			{
				rootClientId,
				__experimentalInsertionIndex,
				__experimentalFilterValue,
				onClose,
			},
			_ref
		) {
			return (
				<div
					data-testid="inserter-library"
					data-root={ rootClientId ?? '' }
					data-index={ __experimentalInsertionIndex ?? '' }
					data-filter={ __experimentalFilterValue ?? '' }
				>
					<button type="button" onClick={ onClose }>
						Close from library
					</button>
				</div>
			);
		} ),
	};
} );

import CortextInserterSidebar from '../../../src/components/CortextInserterSidebar';

beforeEach( () => {
	mockSetIsInserterOpened.mockClear();
	mockInserterState = true;
} );

describe( 'CortextInserterSidebar', () => {
	it( 'renders the inserter library', () => {
		render( <CortextInserterSidebar /> );

		expect( screen.getByTestId( 'inserter-library' ) ).toBeInTheDocument();
	} );

	it( 'forwards insertion context from the editor store', () => {
		mockInserterState = {
			rootClientId: 'parent-id',
			insertionIndex: 3,
			filterValue: 'pull',
		};

		render( <CortextInserterSidebar /> );

		const library = screen.getByTestId( 'inserter-library' );
		expect( library ).toHaveAttribute( 'data-root', 'parent-id' );
		expect( library ).toHaveAttribute( 'data-index', '3' );
		expect( library ).toHaveAttribute( 'data-filter', 'pull' );
	} );

	it( 'defaults context to undefined when the store flag is just true', () => {
		mockInserterState = true;

		render( <CortextInserterSidebar /> );

		const library = screen.getByTestId( 'inserter-library' );
		expect( library ).toHaveAttribute( 'data-root', '' );
		expect( library ).toHaveAttribute( 'data-index', '' );
		expect( library ).toHaveAttribute( 'data-filter', '' );
	} );

	it( 'closes the inserter when the library calls onClose', () => {
		render( <CortextInserterSidebar /> );

		fireEvent.click( screen.getByText( 'Close from library' ) );

		expect( mockSetIsInserterOpened ).toHaveBeenCalledWith( false );
	} );

	it( 'closes on ESC', () => {
		const { container } = render( <CortextInserterSidebar /> );

		fireEvent.keyDown( container.firstChild, {
			keyCode: 27,
		} );

		expect( mockSetIsInserterOpened ).toHaveBeenCalledWith( false );
	} );

	it( 'ignores non-ESC keys', () => {
		const { container } = render( <CortextInserterSidebar /> );

		fireEvent.keyDown( container.firstChild, {
			keyCode: 65,
		} );

		expect( mockSetIsInserterOpened ).not.toHaveBeenCalled();
	} );
} );
