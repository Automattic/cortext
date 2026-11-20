import { render, screen } from '@testing-library/react';

const mockOpenDocument = jest.fn();
jest.mock( '../../../../src/components/DocumentPeekProvider', () => ( {
	useDocumentPeekActions: () => ( {
		openDocument: mockOpenDocument,
		closeDocument: jest.fn(),
		requestMode: jest.fn(),
	} ),
} ) );

import RelationReferences from '../../../../src/components/relations/RelationReferences';

const FIXTURE = {
	id: 12,
	slug: 'ada-lovelace',
	title: { raw: 'Ada Lovelace' },
	collectionId: 7,
};

function renderReferences() {
	return render( <RelationReferences value={ [ FIXTURE ] } /> );
}

beforeEach( () => {
	window.cortextSettings = {
		adminUrl: 'https://example.test/wp-admin/',
		menuSlug: 'cortext',
	};
	mockOpenDocument.mockReset();
} );

const ARCHIVED = { ...FIXTURE, status: 'crtxt_archived' };
const ACTIVE = { ...FIXTURE, status: 'private' };

describe( 'RelationReferences', () => {
	it( 'mutes archived targets and labels them for assistive technology', () => {
		render( <RelationReferences value={ [ ARCHIVED ] } /> );

		const link = screen.getByRole( 'link', {
			name: 'Ada Lovelace (archived)',
		} );
		expect( link ).toHaveClass( 'cortext-relation-ref--archived' );
		expect( link ).toHaveAttribute( 'title', 'Archived' );
	} );

	it( 'renders active targets as normal chips', () => {
		render( <RelationReferences value={ [ ACTIVE ] } /> );

		const link = screen.getByRole( 'link', { name: 'Ada Lovelace' } );
		expect( link ).not.toHaveClass( 'cortext-relation-ref--archived' );
		expect( link ).not.toHaveAttribute( 'title' );
	} );

	it( 'returns to a normal chip once the target is restored', () => {
		const { rerender } = render(
			<RelationReferences value={ [ ARCHIVED ] } />
		);
		expect(
			screen.getByRole( 'link', { name: 'Ada Lovelace (archived)' } )
		).toBeInTheDocument();

		rerender( <RelationReferences value={ [ ACTIVE ] } /> );

		expect(
			screen.getByRole( 'link', { name: 'Ada Lovelace' } )
		).not.toHaveClass( 'cortext-relation-ref--archived' );
	} );

	it( 'still opens an archived target on plain click', () => {
		render( <RelationReferences value={ [ ARCHIVED ] } /> );

		screen
			.getByRole( 'link', { name: 'Ada Lovelace (archived)' } )
			.dispatchEvent(
				new window.MouseEvent( 'click', {
					bubbles: true,
					cancelable: true,
					button: 0,
				} )
			);

		expect( mockOpenDocument ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 12, postType: 'crtxt_document' } )
		);
	} );

	it( 'renders references with the row URL as href', () => {
		renderReferences();

		const link = screen.getByRole( 'link', { name: 'Ada Lovelace' } );
		expect( link ).toHaveAttribute(
			'href',
			'https://example.test/wp-admin/admin.php?page=cortext&p=%2Fada-lovelace-12&collection=7&collectionRow=12'
		);
		expect( link ).toHaveAttribute( 'target', '_top' );
	} );

	it( 'opens the related row on plain click', () => {
		renderReferences();

		const anchor = screen.getByRole( 'link', { name: 'Ada Lovelace' } );
		const click = new window.MouseEvent( 'click', {
			bubbles: true,
			cancelable: true,
			button: 0,
		} );
		anchor.dispatchEvent( click );

		expect( click.defaultPrevented ).toBe( true );
		expect( mockOpenDocument ).toHaveBeenCalledWith( {
			id: 12,
			slug: 'ada-lovelace',
			postType: 'crtxt_document',
			collectionId: 7,
			preferredMode: 'side',
		} );
	} );

	it( 'leaves Cmd-click to the browser and does not open a peek', () => {
		renderReferences();

		const anchor = screen.getByRole( 'link', { name: 'Ada Lovelace' } );
		const click = new window.MouseEvent( 'click', {
			bubbles: true,
			cancelable: true,
			button: 0,
			metaKey: true,
		} );
		anchor.dispatchEvent( click );

		expect( click.defaultPrevented ).toBe( false );
		expect( mockOpenDocument ).not.toHaveBeenCalled();
	} );
} );
