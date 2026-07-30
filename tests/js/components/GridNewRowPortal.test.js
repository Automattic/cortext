import { render, waitFor } from '@testing-library/react';
import { useRef } from '@wordpress/element';

import GridNewRowPortal from '../../../src/components/GridNewRowPortal';

jest.mock( '../../../src/components/DataViewNewRowButton', () => {
	return function MockDataViewNewRowButton() {
		return <button type="button">New document</button>;
	};
} );

function GridHarness( { hasRows } ) {
	const wrapperRef = useRef( null );

	return (
		<div ref={ wrapperRef }>
			{ hasRows && (
				<div className="dataviews-view-grid">
					<div className="dataviews-view-grid__row" />
				</div>
			) }
			<GridNewRowPortal
				wrapperRef={ wrapperRef }
				collectionId={ 7 }
				view={ { type: 'grid' } }
				fields={ [] }
				hasRows={ hasRows }
			/>
		</div>
	);
}

describe( 'GridNewRowPortal', () => {
	it( 'keeps the new-row card when rows arrive after the wrapper mounts', async () => {
		const { container, rerender } = render(
			<GridHarness hasRows={ false } />
		);

		expect( container ).toHaveTextContent( 'New document' );

		rerender( <GridHarness hasRows /> );

		await waitFor( () =>
			expect(
				container.querySelector( '.dataviews-view-grid__row' )
			).toHaveTextContent( 'New document' )
		);
		expect(
			container.querySelector( '.cortext-data-view__grid-new-row' )
		).not.toBeInTheDocument();
		expect( container.querySelectorAll( 'button' ) ).toHaveLength( 1 );
	} );

	it( 'mounts the new-row card when rows are already available', async () => {
		const { container } = render( <GridHarness hasRows /> );

		await waitFor( () =>
			expect(
				container.querySelector(
					'.dataviews-view-grid__row .cortext-data-view__new-row-gridcell'
				)
			).toHaveTextContent( 'New document' )
		);
		expect(
			container.querySelector( '.cortext-data-view__grid-new-row' )
		).not.toBeInTheDocument();
		expect( container.querySelectorAll( 'button' ) ).toHaveLength( 1 );
	} );
} );
