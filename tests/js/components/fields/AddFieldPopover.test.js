import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn(),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '../../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	default: jest.fn(),
	buildFieldListQuery: jest.fn( ( ids ) => ( { include: ids } ) ),
} ) );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useCreateField: jest.fn(),
} ) );

import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import AddFieldPopover from '../../../../src/components/fields/AddFieldPopover';
import useCollectionFields from '../../../../src/hooks/useCollectionFields';
import { useCreateField } from '../../../../src/hooks/useFieldMutations';

const run = jest.fn();

beforeEach( () => {
	jest.clearAllMocks();
	run.mockResolvedValue( { id: 100, type: 'rollup' } );
	useCreateField.mockReturnValue( {
		run,
		isBusy: false,
		error: null,
	} );
	useCollectionFields.mockReturnValue( {
		fields: [
			{
				id: 'field-77',
				recordId: 77,
				cortextType: 'relation',
				label: 'Invoices',
				relatedCollectionId: 9,
			},
		],
	} );
	useEntityRecord.mockImplementation( ( kind, name, id ) => ( {
		record:
			kind === 'postType' && name === 'crtxt_collection' && id === 9
				? {
						id: 9,
						title: { raw: 'Invoices', rendered: 'Invoices' },
						meta: { fields: [ 88 ] },
				  }
				: null,
	} ) );
	useEntityRecords.mockImplementation( ( kind, name ) => {
		if ( kind === 'postType' && name === 'crtxt_field' ) {
			return {
				records: [
					{
						id: 88,
						title: { raw: 'Amount', rendered: 'Amount' },
						meta: { type: 'number' },
					},
				],
			};
		}
		return { records: [] };
	} );
} );

describe( 'AddFieldPopover rollup config', () => {
	it( 'defaults count rollup names to the related collection and aggregator', async () => {
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Relation' ) ).toHaveValue( '77' )
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create rollup' } )
		);

		await waitFor( () =>
			expect( run ).toHaveBeenCalledWith( {
				title: 'Invoices (Count)',
				type: 'rollup',
				rollup_relation_field_id: 77,
				rollup_target_field_id: undefined,
				rollup_aggregator: 'count',
			} )
		);
	} );

	it( 'preselects the only relation and only compatible target field', async () => {
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Relation' ) ).toHaveValue( '77' )
		);

		fireEvent.change( screen.getByLabelText( 'Calculate' ), {
			target: { value: 'sum' },
		} );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Target field' ) ).toHaveValue(
				'88'
			)
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create rollup' } )
		);

		await waitFor( () =>
			expect( run ).toHaveBeenCalledWith( {
				title: 'Invoices / Amount (Sum)',
				type: 'rollup',
				rollup_relation_field_id: 77,
				rollup_target_field_id: 88,
				rollup_aggregator: 'sum',
			} )
		);
	} );
} );
