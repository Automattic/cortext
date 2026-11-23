import { render, screen } from '@testing-library/react';

jest.mock( '../../../src/components/fields/RollupInvalidHint', () => ( {
	__esModule: true,
	default: ( { recordId, reason } ) => (
		<span data-testid="hint">{ `${ recordId }:${ reason }` }</span>
	),
} ) );

import CollectionFieldsContext from '../../../src/components/collectionFieldsContextObject';
import { withRollupInvalidCells } from '../../../src/components/CollectionDataViewFields';

const valueRender = () => null;
const flagged = {
	id: 'field-5',
	recordId: 5,
	cortextRollupInvalid: 'target_must_be_number',
	render: valueRender,
};
const valid = {
	id: 'field-6',
	recordId: 6,
	cortextRollupInvalid: '',
	render: valueRender,
};

describe( 'withRollupInvalidCells', () => {
	it( 'swaps the renderer of flagged rollups only', () => {
		const [ hinted, untouched ] = withRollupInvalidCells( [
			flagged,
			valid,
		] );

		expect( hinted.render ).not.toBe( valueRender );
		expect( untouched ).toBe( valid );
	} );

	it( 'keeps the same render component across field-list refreshes', () => {
		const [ first ] = withRollupInvalidCells( [ flagged ] );
		const [ second ] = withRollupInvalidCells( [ { ...flagged } ] );

		expect( first.render ).toBe( second.render );
	} );

	it( "reads the reason from the collection's fields", () => {
		const [ hinted ] = withRollupInvalidCells( [ flagged ] );
		const Cell = hinted.render;

		// DataViews hands `render` its own normalized field, which keeps the
		// id but drops our props.
		render(
			<CollectionFieldsContext.Provider
				value={ { fieldsByRecordId: new Map( [ [ 5, flagged ] ] ) } }
			>
				<Cell item={ {} } field={ { id: 'field-5' } } />
			</CollectionFieldsContext.Provider>
		);

		expect( screen.getByTestId( 'hint' ) ).toHaveTextContent(
			'5:target_must_be_number'
		);
	} );
} );
