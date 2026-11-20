import { fireEvent, render, screen } from '@testing-library/react';

jest.mock( '../../../../src/components/fields/EditRollupPopover', () => ( {
	__esModule: true,
	default: ( { recordId, collectionId } ) => (
		<div data-testid="edit-rollup">{ `${ recordId }:${ collectionId }` }</div>
	),
} ) );

import CollectionFieldsContext from '../../../../src/components/collectionFieldsContextObject';
import RollupInvalidHint, {
	rollupInvalidLabel,
} from '../../../../src/components/fields/RollupInvalidHint';

function renderInCollection( ui, value = {} ) {
	return render(
		<CollectionFieldsContext.Provider
			value={ { collection: { id: 5 }, isSchemaFrozen: false, ...value } }
		>
			{ ui }
		</CollectionFieldsContext.Provider>
	);
}

describe( 'rollupInvalidLabel', () => {
	it( 'says what to fix for each reason the server stores', () => {
		expect( rollupInvalidLabel( 'target_must_be_number' ) ).toBe(
			'Target property changed type'
		);
		expect( rollupInvalidLabel( 'target_must_be_date' ) ).toBe(
			'Target property changed type'
		);
		expect( rollupInvalidLabel( 'relation_invalid' ) ).toBe(
			'Relation is in another collection'
		);
		expect( rollupInvalidLabel( 'target_invalid' ) ).toBe(
			'Target property is missing'
		);
		expect( rollupInvalidLabel( 'something_else' ) ).toBe(
			'Rollup needs a fix'
		);
	} );
} );

describe( 'RollupInvalidHint', () => {
	it( 'opens the rollup editor from a collection that can change', () => {
		renderInCollection(
			<RollupInvalidHint recordId={ 12 } reason="relation_invalid" />
		);

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Relation is in another collection',
			} )
		);

		expect( screen.getByTestId( 'edit-rollup' ) ).toHaveTextContent(
			'12:5'
		);
	} );

	it( 'prefers an explicit collection id over the context one', () => {
		renderInCollection(
			<RollupInvalidHint
				recordId={ 12 }
				reason="target_must_be_number"
				collectionId={ 9 }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Target property changed type',
			} )
		);

		expect( screen.getByTestId( 'edit-rollup' ) ).toHaveTextContent(
			'12:9'
		);
	} );

	it( 'stays plain text when the schema is frozen', () => {
		renderInCollection(
			<RollupInvalidHint recordId={ 12 } reason="target_invalid" />,
			{ isSchemaFrozen: true }
		);

		expect(
			screen.getByText( 'Target property is missing' )
		).toBeVisible();
		expect( screen.queryByRole( 'button' ) ).toBeNull();
	} );

	it( 'stays plain text outside a collection', () => {
		render( <RollupInvalidHint recordId={ 12 } reason="target_invalid" /> );

		expect( screen.queryByRole( 'button' ) ).toBeNull();
	} );

	it( 'stays plain text when rendered as a static preview', () => {
		renderInCollection(
			<RollupInvalidHint
				recordId={ 12 }
				reason="target_invalid"
				isStatic
			/>
		);

		expect( screen.queryByRole( 'button' ) ).toBeNull();
	} );
} );
