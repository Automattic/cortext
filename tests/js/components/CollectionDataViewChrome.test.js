/**
 * Tests for the selection controls in `src/components/CollectionDataViewChrome.js`.
 */
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/dataviews/wp', () => ( {
	DataViews: { Pagination: () => null },
} ) );

import { DataViewsBulkSelectionControls } from '../../../src/components/CollectionDataViewChrome';

function renderControls( props = {} ) {
	const handlers = {
		onArchiveSelected: jest.fn(),
		onClearSelection: jest.fn(),
		onDeleteSelected: jest.fn(),
		onToggleVisibleSelection: jest.fn(),
	};
	render(
		<DataViewsBulkSelectionControls
			selectedIds={ [ 1, 2 ] }
			visibleIds={ [ 1, 2, 3 ] }
			{ ...handlers }
			{ ...props }
		/>
	);
	return handlers;
}

describe( 'DataViewsBulkSelectionControls', () => {
	it( 'archives the selection from the button before Trash', () => {
		const handlers = renderControls();
		const archiveButton = screen.getByRole( 'button', {
			name: 'Archive selected',
		} );
		const trashButton = screen.getByRole( 'button', {
			name: 'Move selected to Trash',
		} );

		expect(
			archiveButton.compareDocumentPosition( trashButton ) &
				window.Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();

		fireEvent.click( archiveButton );
		expect( handlers.onArchiveSelected ).toHaveBeenCalledTimes( 1 );
		expect( handlers.onDeleteSelected ).not.toHaveBeenCalled();
	} );

	it( 'hides the selection actions when nothing is selected', () => {
		renderControls( { selectedIds: [] } );

		expect(
			screen.queryByRole( 'button', { name: 'Archive selected' } )
		).toBeNull();
	} );
} );
