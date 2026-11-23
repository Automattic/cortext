import { visibleTraits } from '../../../src/documents/traits';

describe( 'visibleTraits', () => {
	it( 'shows only the live collections while the row lives somewhere', () => {
		const projects = { id: 1, title: 'Projects', active: true };
		const archived = { id: 2, title: 'Archived', active: false };

		expect( visibleTraits( [ projects, archived ] ) ).toEqual( [
			projects,
		] );
	} );

	it( 'shows every collection of a row retired together with them', () => {
		const collections = [
			{ id: 1, title: 'Projects', active: false },
			{ id: 2, title: 'People', active: false },
		];

		expect( visibleTraits( collections ) ).toEqual( collections );
	} );

	it( 'never shows a collection the user cannot read', () => {
		const projects = { id: 1, title: 'Projects', active: false };
		const hidden = { id: 2, active: true, readable: false };

		expect( visibleTraits( [ projects, hidden ] ) ).toEqual( [ projects ] );
	} );
} );
