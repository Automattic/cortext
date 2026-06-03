import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn(),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '../../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	buildFieldListQuery: jest.fn( ( ids ) => ( { include: ids } ) ),
} ) );

jest.mock( '../../../../src/components/CollectionFieldsContext', () => ( {
	useCollectionFieldsContext: jest.fn(),
} ) );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useCreateField: jest.fn(),
} ) );

import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import AddFieldPopover from '../../../../src/components/fields/AddFieldPopover';
import { useCollectionFieldsContext } from '../../../../src/components/CollectionFieldsContext';
import { useCreateField } from '../../../../src/hooks/useFieldMutations';

const run = jest.fn();
let targetFields;

beforeEach( () => {
	jest.clearAllMocks();
	targetFields = [
		{
			id: 88,
			title: { raw: 'Amount', rendered: 'Amount' },
			meta: { type: 'number' },
		},
	];
	run.mockResolvedValue( { id: 100, type: 'rollup' } );
	useCreateField.mockReturnValue( {
		run,
		isBusy: false,
		error: null,
	} );
	useCollectionFieldsContext.mockReturnValue( {
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
			kind === 'postType' && name === 'crtxt_trait' && id === 9
				? {
						id: 9,
						title: { raw: 'Invoices', rendered: 'Invoices' },
						meta: {
							fields: targetFields.map( ( field ) => field.id ),
						},
				  }
				: null,
	} ) );
	useEntityRecords.mockImplementation( ( kind, name ) => {
		if ( kind === 'postType' && name === 'crtxt_field' ) {
			return { records: targetFields };
		}
		return { records: [] };
	} );
} );

describe( 'AddFieldPopover rollup config', () => {
	it( 'shows type icons in the picker', () => {
		render( <AddFieldPopover collectionId={ 5 } /> );

		const numberButton = screen.getByRole( 'button', { name: 'Number' } );
		expect(
			numberButton.querySelector(
				'.cortext-add-field-popover__type-icon[data-cortext-field-type="number"]'
			)
		).toBeInTheDocument();
	} );

	it( 'orders rollup controls as relation, target property, then calculate', async () => {
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		const relation = await screen.findByLabelText( 'Relation' );
		const target = screen.getByLabelText( 'Target property' );
		const calculate = screen.getByLabelText( 'Calculate' );
		const controls = screen.getAllByRole( 'combobox' );

		expect( controls[ 0 ] ).toBe( relation );
		expect( controls[ 1 ] ).toBe( target );
		expect( controls[ 2 ] ).toBe( calculate );
	} );

	it( 'defaults value rollup names to the related collection, target, and aggregator', async () => {
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Target property' ) ).toHaveValue(
				'88'
			)
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create rollup' } )
		);

		await waitFor( () =>
			expect( run ).toHaveBeenCalledWith( {
				title: 'Invoices / Amount (Show original)',
				type: 'rollup',
				rollup_relation_field_id: 77,
				rollup_target_field_id: 88,
				rollup_aggregator: 'show_original',
			} )
		);
	} );

	it( 'preselects the only relation and only target field', async () => {
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Target property' ) ).toHaveValue(
				'88'
			)
		);

		fireEvent.change( screen.getByLabelText( 'Calculate' ), {
			target: { value: 'sum' },
		} );

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

	it( 'creates Count all rollups without a target property', async () => {
		targetFields = [];
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Calculate' ) ).toHaveValue(
				'count'
			)
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create rollup' } )
		);

		await waitFor( () =>
			expect( run ).toHaveBeenCalledWith( {
				title: 'Invoices (Count all)',
				type: 'rollup',
				rollup_relation_field_id: 77,
				rollup_aggregator: 'count',
			} )
		);
	} );

	it( 'adds number calculations only after selecting a number target', async () => {
		targetFields = [
			{
				id: 88,
				title: { raw: 'Amount', rendered: 'Amount' },
				meta: { type: 'number' },
			},
			{
				id: 89,
				title: { raw: 'Due', rendered: 'Due' },
				meta: { type: 'date' },
			},
		];
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await screen.findByLabelText( 'Target property' );
		expect( screen.queryByRole( 'option', { name: 'Sum' } ) ).toBeNull();
		expect(
			screen.queryByRole( 'option', { name: 'Latest date' } )
		).toBeNull();

		fireEvent.change( screen.getByLabelText( 'Target property' ), {
			target: { value: '88' },
		} );

		expect( screen.getByRole( 'option', { name: 'Sum' } ) ).toBeTruthy();
		expect(
			screen.queryByRole( 'option', { name: 'Latest date' } )
		).toBeNull();
	} );

	it( 'adds date calculations only after selecting a date target', async () => {
		targetFields = [
			{
				id: 88,
				title: { raw: 'Amount', rendered: 'Amount' },
				meta: { type: 'number' },
			},
			{
				id: 89,
				title: { raw: 'Due', rendered: 'Due' },
				meta: { type: 'date' },
			},
		];
		render( <AddFieldPopover collectionId={ 5 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rollup' } ) );

		await screen.findByLabelText( 'Target property' );
		expect(
			screen.queryByRole( 'option', { name: 'Earliest date' } )
		).toBeNull();

		fireEvent.change( screen.getByLabelText( 'Target property' ), {
			target: { value: '89' },
		} );

		expect(
			screen.getByRole( 'option', { name: 'Earliest date' } )
		).toBeTruthy();
		expect(
			screen.getByRole( 'option', { name: 'Latest date' } )
		).toBeTruthy();
		expect(
			screen.getByRole( 'option', { name: 'Date range' } )
		).toBeTruthy();
		expect( screen.queryByRole( 'option', { name: 'Sum' } ) ).toBeNull();
	} );
} );
