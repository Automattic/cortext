import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '../../../../src/hooks/useCollectionRows', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );
jest.mock( '../../../../src/hooks/useCollectionRowsByIds', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

// Keep debounce out of most picker tests. Mocking the hook lets Popover keep
// its real positioning effects without jest-console reporting act() noise.
jest.mock( '../../../../src/hooks/useDebouncedValue', () => ( {
	__esModule: true,
	default: jest.fn( ( value ) => value ),
} ) );

const mockTouchRecent = jest.fn();
jest.mock( '../../../../src/hooks/useRecents', () => ( {
	useRecents: () => ( { touchRecent: mockTouchRecent } ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import RelationEditor from '../../../../src/components/relations/RelationEditor';
import useCollectionRows from '../../../../src/hooks/useCollectionRows';
import useCollectionRowsByIds from '../../../../src/hooks/useCollectionRowsByIds';
import useDebouncedValue from '../../../../src/hooks/useDebouncedValue';

function mockRowsResponse( overrides = {} ) {
	useCollectionRows.mockReturnValue( {
		data: [],
		collection: null,
		paginationInfo: { totalItems: 0, totalPages: 1 },
		isLoading: false,
		refresh: jest.fn(),
		...overrides,
	} );
}

async function flushPopoverEffects() {
	// Popover schedules positioning work after render. Flush it before the
	// test ends so act() warnings stay quiet.
	await act( async () => {} );
}

beforeEach( () => {
	apiFetch.mockReset();
	mockTouchRecent.mockReset();
	useDebouncedValue.mockImplementation( ( value ) => value );
	mockRowsResponse();
	useCollectionRowsByIds.mockReturnValue( {
		rows: [],
		isLoading: false,
		error: null,
	} );
} );

describe( 'RelationEditor', () => {
	it( 'queries the rows endpoint in server mode (no forceClient)', async () => {
		mockRowsResponse( {
			data: [ { id: 22, title: { raw: 'Ada Lovelace' } } ],
			collection: { title: { raw: 'People' } },
		} );

		render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		expect( useCollectionRows ).toHaveBeenCalled();
		const lastCall = useCollectionRows.mock.calls.at( -1 );
		// Args: (collectionId, view, fields). No fourth arg means server mode.
		expect( lastCall[ 0 ] ).toBe( 9 );
		expect( lastCall[ 1 ] ).toEqual(
			expect.objectContaining( {
				type: 'table',
				page: 1,
				search: '',
				perPage: 25,
			} )
		);
		expect( lastCall[ 3 ] ).toBeUndefined();
		await flushPopoverEffects();
	} );

	it( 'saves the selected target row id when a row is clicked', async () => {
		mockRowsResponse( {
			data: [
				{ id: 22, title: { raw: 'Ada Lovelace' } },
				{ id: 33, title: { raw: 'Grace Hopper' } },
			],
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

		fireEvent.click( screen.getByText( 'Ada Lovelace' ) );

		await waitFor( () => expect( onSave ).toHaveBeenCalledWith( [ 22 ] ) );
	} );

	it( 'sends the search term to the server view', async () => {
		render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		fireEvent.change( screen.getByLabelText( 'Search rows' ), {
			target: { value: 'abc' },
		} );

		const view = useCollectionRows.mock.calls.at( -1 )[ 1 ];
		expect( view.search ).toBe( 'abc' );
		// Page resets to 1 whenever the effective search changes.
		expect( view.page ).toBe( 1 );
		await flushPopoverEffects();
	} );

	it( 'does not fetch labels by id when the value already has titles', async () => {
		render(
			<RelationEditor
				value={ [ { id: 22, title: { raw: 'Ada Lovelace' } } ] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		const lastCall = useCollectionRowsByIds.mock.calls.at( -1 );
		expect( lastCall[ 0 ] ).toBe( 9 );
		expect( lastCall[ 1 ] ).toEqual( [] );
		await flushPopoverEffects();
	} );

	it( 'fetches labels by id when the value carries only ids', async () => {
		render(
			<RelationEditor
				value={ [ { id: 22 }, { id: 33 } ] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		const lastCall = useCollectionRowsByIds.mock.calls.at( -1 );
		expect( lastCall[ 0 ] ).toBe( 9 );
		expect( lastCall[ 1 ] ).toEqual( [ 22, 33 ] );
		await flushPopoverEffects();
	} );

	it( 'shows by-id labels for selected rows', async () => {
		useCollectionRowsByIds.mockReturnValue( {
			rows: [ { id: 22, title: { raw: 'Ada Lovelace' } } ],
			isLoading: false,
			error: null,
		} );

		render(
			<RelationEditor
				value={ [ { id: 22 } ] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		// At least one pill should show the title, not the `#22` fallback.
		expect( screen.getAllByText( 'Ada Lovelace' ).length ).toBeGreaterThan(
			0
		);
		await flushPopoverEffects();
	} );

	it( 'hides "Create row" while the debounced search has not caught up', async () => {
		// Pin the debounced value so search ('New Row') stays unsettled.
		useDebouncedValue.mockImplementation( () => '' );

		render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		fireEvent.change( screen.getByLabelText( 'Search rows' ), {
			target: { value: 'New Row' },
		} );

		expect(
			screen.queryByRole( 'button', { name: 'Create row "New Row"' } )
		).toBeNull();
		await flushPopoverEffects();
	} );

	it( 'hides "Create row" when an exact-title match exists in results', async () => {
		mockRowsResponse( {
			data: [ { id: 5, title: { raw: 'Exact Match' } } ],
		} );

		render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		fireEvent.change( screen.getByLabelText( 'Search rows' ), {
			target: { value: 'Exact Match' },
		} );

		expect(
			screen.queryByRole( 'button', { name: 'Create row "Exact Match"' } )
		).toBeNull();
		await flushPopoverEffects();
	} );

	it( 'preserves accumulated rows while a new fetch is in flight', async () => {
		mockRowsResponse( {
			data: [
				{ id: 1, title: { raw: 'Alpha' } },
				{ id: 2, title: { raw: 'Beta' } },
			],
			paginationInfo: { totalItems: 2, totalPages: 1 },
			isLoading: false,
		} );

		const { rerender } = render(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		expect( screen.getByText( 'Alpha' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Beta' ) ).toBeInTheDocument();

		// During a search change, useCollectionRows can return stale data while
		// loading. The visible list should keep the last settled rows.
		mockRowsResponse( {
			data: [ { id: 99, title: { raw: 'Stale' } } ],
			paginationInfo: { totalItems: 1, totalPages: 1 },
			isLoading: true,
		} );

		rerender(
			<RelationEditor
				value={ [] }
				relation={ { targetCollectionId: 9, multiple: true } }
				onSave={ jest.fn() }
				onCancel={ jest.fn() }
				label="Assignee"
			/>
		);

		expect( screen.getByText( 'Alpha' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Beta' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Stale' ) ).toBeNull();
		await flushPopoverEffects();
	} );

	it( 'creates a missing target row from the relation picker', async () => {
		const refreshTargetRows = jest.fn();
		mockRowsResponse( {
			collection: { title: { raw: 'People' } },
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
		expect( mockTouchRecent ).toHaveBeenCalledWith( {
			kind: 'row',
			id: 44,
			collectionId: 9,
		} );
		expect( refreshTargetRows ).toHaveBeenCalled();
		await flushPopoverEffects();
	} );
} );
