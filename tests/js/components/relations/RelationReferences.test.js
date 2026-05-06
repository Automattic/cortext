import { render, screen } from '@testing-library/react';

import RelationReferences from '../../../../src/components/relations/RelationReferences';

function renderReferences() {
	return render(
		<RelationReferences
			value={ [
				{
					id: 12,
					title: { raw: 'Ada Lovelace' },
					collectionId: 7,
					collectionSlug: 'people',
				},
			] }
		/>
	);
}

beforeEach( () => {
	window.cortextSettings = {
		adminUrl: 'https://example.test/wp-admin/',
		menuSlug: 'cortext',
	};
	delete window.cortextRouter;
} );

describe( 'RelationReferences', () => {
	it( 'renders references as collection links', () => {
		renderReferences();

		const link = screen.getByRole( 'link', { name: 'Ada Lovelace' } );
		expect( link ).toHaveAttribute(
			'href',
			'https://example.test/wp-admin/admin.php?page=cortext&p=%2Fcollection%2Fpeople-7'
		);
		expect( link ).toHaveAttribute( 'target', '_top' );
	} );

	it( 'uses the Cortext router for plain relation link clicks', () => {
		window.cortextRouter = { navigate: jest.fn() };

		renderReferences();

		const anchor = screen.getByRole( 'link', {
			name: 'Ada Lovelace',
		} );
		const click = new window.MouseEvent( 'click', {
			bubbles: true,
			cancelable: true,
			button: 0,
		} );
		anchor.dispatchEvent( click );

		expect( click.defaultPrevented ).toBe( true );
		expect( window.cortextRouter.navigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'collection/people-7' },
		} );
	} );
} );
