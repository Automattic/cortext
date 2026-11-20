import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/components', () => ( {
	...jest.requireActual( '@wordpress/components' ),
	Popover: ( { children } ) => <div>{ children }</div>,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn( () => ( { record: null } ) ),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '../../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	buildFieldListQuery: jest.fn( ( ids ) => ( { include: ids } ) ),
} ) );

jest.mock( '../../../../src/components/CollectionFieldsContext', () => ( {
	useCollectionFieldsContext: jest.fn(),
	useMappedField: jest.fn(),
} ) );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useUpdateRollup: jest.fn(),
} ) );

jest.mock( '../../../../src/hooks/rowInvalidation', () => ( {
	notifyCollectionRowsChanged: jest.fn(),
} ) );

import { useEntityRecords } from '@wordpress/core-data';
import EditRollupPopover from '../../../../src/components/fields/EditRollupPopover';
import {
	useCollectionFieldsContext,
	useMappedField,
} from '../../../../src/components/CollectionFieldsContext';
import { useUpdateRollup } from '../../../../src/hooks/useFieldMutations';
import { notifyCollectionRowsChanged } from '../../../../src/hooks/rowInvalidation';

const run = jest.fn();

beforeEach( () => {
	jest.clearAllMocks();
	run.mockResolvedValue( {} );
	useUpdateRollup.mockReturnValue( { run, isBusy: false, error: null } );
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
	// The target was converted from number to text, so `sum` no longer fits.
	useEntityRecords.mockReturnValue( {
		records: [
			{
				id: 88,
				title: { raw: 'Amount', rendered: 'Amount' },
				meta: { type: 'text' },
			},
		],
	} );
	useMappedField.mockReturnValue( {
		recordId: 12,
		cortextType: 'rollup',
		rollupRelationFieldId: 77,
		rollupTargetFieldId: 88,
		rollupAggregator: 'sum',
	} );
} );

describe( 'EditRollupPopover', () => {
	it( 'starts from the saved settings and saves a calculation that fits', async () => {
		const onClose = jest.fn();
		const onSaved = jest.fn();
		render(
			<EditRollupPopover
				recordId={ 12 }
				collectionId={ 5 }
				onClose={ onClose }
				onSaved={ onSaved }
			/>
		);

		expect( screen.getByLabelText( 'Relation' ) ).toHaveValue( '77' );
		expect( screen.getByLabelText( 'Target property' ) ).toHaveValue(
			'88'
		);
		await waitFor( () =>
			expect( screen.getByLabelText( 'Calculate' ) ).toHaveValue(
				'show_original'
			)
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save rollup' } )
		);

		await waitFor( () =>
			expect( run ).toHaveBeenCalledWith(
				12,
				expect.objectContaining( {
					relationFieldId: 77,
					targetFieldId: 88,
					aggregator: 'show_original',
				} )
			)
		);
		expect( notifyCollectionRowsChanged ).toHaveBeenCalledWith( 5 );
		expect( onSaved ).toHaveBeenCalled();
		expect( onClose ).toHaveBeenCalled();
	} );

	it( 'keeps a saved number calculation while the target loads', async () => {
		useMappedField.mockReturnValue( {
			recordId: 12,
			cortextType: 'rollup',
			rollupRelationFieldId: 77,
			rollupTargetFieldId: 88,
			rollupAggregator: 'sum',
		} );
		useEntityRecords.mockReturnValue( { records: null } );

		const { rerender } = render(
			<EditRollupPopover recordId={ 12 } collectionId={ 5 } />
		);
		expect( screen.getByLabelText( 'Calculate' ) ).toHaveValue( 'sum' );

		useEntityRecords.mockReturnValue( {
			records: [
				{
					id: 88,
					title: { raw: 'Amount', rendered: 'Amount' },
					meta: { type: 'number' },
				},
			],
		} );
		rerender( <EditRollupPopover recordId={ 12 } collectionId={ 5 } /> );

		expect( screen.getByLabelText( 'Target property' ) ).toHaveValue(
			'88'
		);
		expect( screen.getByLabelText( 'Calculate' ) ).toHaveValue( 'sum' );
	} );

	it( 'keeps a count with no target as it was saved', () => {
		useMappedField.mockReturnValue( {
			recordId: 12,
			cortextType: 'rollup',
			rollupRelationFieldId: 77,
			rollupTargetFieldId: 0,
			rollupAggregator: 'count',
		} );

		render( <EditRollupPopover recordId={ 12 } collectionId={ 5 } /> );

		expect( screen.getByLabelText( 'Target property' ) ).toHaveValue( '' );
		expect( screen.getByLabelText( 'Calculate' ) ).toHaveValue( 'count' );
	} );

	it( "suggests this collection's relation when the saved one is from another collection", async () => {
		useMappedField.mockReturnValue( {
			recordId: 12,
			cortextType: 'rollup',
			rollupRelationFieldId: 999,
			rollupTargetFieldId: 88,
			rollupAggregator: 'sum',
		} );

		render(
			<EditRollupPopover
				recordId={ 12 }
				collectionId={ 5 }
				onClose={ jest.fn() }
			/>
		);

		await waitFor( () =>
			expect( screen.getByLabelText( 'Relation' ) ).toHaveValue( '77' )
		);
		// The saved target belongs to the other collection, so pick one here.
		fireEvent.change( screen.getByLabelText( 'Target property' ), {
			target: { value: '88' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save rollup' } )
		);

		await waitFor( () =>
			expect( run ).toHaveBeenCalledWith(
				12,
				expect.objectContaining( {
					relationFieldId: 77,
					targetFieldId: 88,
				} )
			)
		);
	} );

	it( 'leaves the relation unpicked when several could replace it', () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					cortextType: 'relation',
					label: 'Invoices',
					relatedCollectionId: 9,
				},
				{
					id: 'field-78',
					recordId: 78,
					cortextType: 'relation',
					label: 'Clients',
					relatedCollectionId: 10,
				},
			],
		} );
		useMappedField.mockReturnValue( {
			recordId: 12,
			cortextType: 'rollup',
			rollupRelationFieldId: 999,
			rollupTargetFieldId: 88,
			rollupAggregator: 'sum',
		} );

		render( <EditRollupPopover recordId={ 12 } collectionId={ 5 } /> );

		expect( screen.getByLabelText( 'Relation' ) ).toHaveValue( '' );
		expect(
			screen.getByRole( 'button', { name: 'Save rollup' } )
		).toBeDisabled();
	} );

	it( 'shows why the server rejected the settings', async () => {
		run.mockRejectedValue(
			new Error( 'Numeric rollups must target a number field.' )
		);

		render(
			<EditRollupPopover
				recordId={ 12 }
				collectionId={ 5 }
				onClose={ jest.fn() }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save rollup' } )
		);

		expect(
			await screen.findByText(
				'Numeric rollups must target a number field.',
				{ selector: '.components-notice__content' }
			)
		).toBeVisible();
	} );
} );
