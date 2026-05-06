import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '../../../../src/hooks/useCollectionRows', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import RelationEditor from '../../../../src/components/relations/RelationEditor';
import useCollectionRows from '../../../../src/hooks/useCollectionRows';

beforeEach( () => {
	apiFetch.mockReset();
	useCollectionRows.mockReturnValue( {
		data: [],
		collection: null,
		isLoading: false,
		refresh: jest.fn(),
	} );
} );

describe( 'RelationEditor', () => {
	it( 'saves selected target row ids from the relation picker', async () => {
		useCollectionRows.mockReturnValue( {
			data: [
				{ id: 22, title: { raw: 'Ada Lovelace' } },
				{ id: 33, title: { raw: 'Grace Hopper' } },
			],
			collection: { title: { raw: 'People' } },
			isLoading: false,
			refresh: jest.fn(),
		} );
		const onSave = jest.fn().mockResolvedValue( true );

		render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ onSave }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		const option = screen.getByText( 'Ada Lovelace' );
		const mouseDown = new window.MouseEvent( 'mousedown', {
			bubbles: true,
			cancelable: true,
		} );
		option.dispatchEvent( mouseDown );
		expect( mouseDown.defaultPrevented ).toBe( true );
		fireEvent.click( option );

		await waitFor( () => expect( onSave ).toHaveBeenCalledWith( [ 22 ] ) );
		expect( useCollectionRows ).toHaveBeenCalledWith(
			9,
			expect.objectContaining( { type: 'table' } )
		);
	} );

	it( 'creates a missing target row from the relation picker', async () => {
		const refreshTargetRows = jest.fn();
		useCollectionRows.mockReturnValue( {
			data: [],
			collection: { title: { raw: 'People' } },
			isLoading: false,
			refresh: refreshTargetRows,
		} );
		apiFetch.mockResolvedValue( { id: 44, title: { raw: 'New Ada' } } );
		const onSave = jest.fn().mockResolvedValue( true );

		render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ onSave }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		fireEvent.change( screen.getByLabelText( 'Search rows' ), {
			target: { value: 'New Ada' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create row "New Ada"' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/collections/9/rows',
				method: 'POST',
				data: { title: 'New Ada' },
			} )
		);
		await waitFor( () => expect( onSave ).toHaveBeenCalledWith( [ 44 ] ) );
		expect( refreshTargetRows ).toHaveBeenCalled();
	} );
} );
