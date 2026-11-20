import { render, screen } from '@testing-library/react';

import { TITLE_FIELD } from '../../../src/components/CollectionDataViewFields';

jest.mock( '../../../src/components/FrozenBadge', () => ( {
	__esModule: true,
	default: ( { frozen } ) => (
		<span data-testid="lock">{ frozen.frozen_at }</span>
	),
} ) );

function renderTitle( item ) {
	return render( TITLE_FIELD.render( { item } ) );
}

describe( 'Title cell lock icon', () => {
	it( 'shows the lock icon for a locked row', () => {
		renderTitle( {
			id: 1,
			title: { raw: 'Roadmap' },
			cortext_frozen: { frozen_at: '2026-11-19T10:00:00' },
		} );

		expect( screen.getByTestId( 'lock' ) ).toHaveTextContent(
			'2026-11-19T10:00:00'
		);
	} );

	it( 'shows no lock icon for an unlocked row', () => {
		renderTitle( { id: 1, title: { raw: 'Roadmap' } } );

		expect( screen.queryByTestId( 'lock' ) ).toBeNull();
	} );
} );
