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
	collectionSlug: 'people',
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

describe( 'RelationReferences', () => {
	it( 'renders references with the row URL as href', () => {
		renderReferences();

		const link = screen.getByRole( 'link', { name: 'Ada Lovelace' } );
		expect( link ).toHaveAttribute(
			'href',
			'https://example.test/wp-admin/admin.php?page=cortext&p=%2Fada-lovelace-12'
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
