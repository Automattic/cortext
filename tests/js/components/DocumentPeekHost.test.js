import { act, render, screen } from '@testing-library/react';

const mockNavigate = jest.fn();
const mockInvalidateResolution = jest.fn();
jest.mock( '@wordpress/route', () => ( {
	useNavigate: () => mockNavigate,
} ) );
jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => ( {
		invalidateResolution: mockInvalidateResolution,
	} ),
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	useParams: () => ( { _splat: '' } ),
} ) );

jest.mock( '../../../src/hooks/useCollectionFields', () => () => ( {
	detailFields: [
		{
			id: 'field-7',
			label: 'Status',
			cortextFieldType: 'text',
			editable: true,
		},
	],
	allDetailFields: [
		{
			id: 'field-7',
			label: 'Status',
			cortextFieldType: 'text',
			editable: true,
		},
	],
	detailLayoutEntries: [],
} ) );

jest.mock( '../../../src/components/RowDetailSidebarSlot', () => ( {
	RowDetailSidebar: {
		Fill: ( { children } ) => (
			<div data-testid="row-detail-sidebar">{ children }</div>
		),
	},
} ) );

const mockRowDetailView = jest.fn( ( props ) => (
	<div data-testid="row-detail-view">
		{ props.row?.meta?.[ 'field-7' ] ?? '' }
		<button onClick={ props.onRestored }>Restore</button>
	</div>
) );
jest.mock( '../../../src/components/RowDetailView', () => ( {
	__esModule: true,
	default: ( props ) => mockRowDetailView( props ),
} ) );

import DocumentPeekHost from '../../../src/components/DocumentPeekHost';
import { PUBLISHED_DOCUMENTS_QUERY } from '../../../src/components/page-queries';
import { DOCUMENT_POST_TYPE } from '../../../src/collections';
import {
	DocumentPeekProvider,
	useDocumentPeekActions,
} from '../../../src/components/DocumentPeekProvider';

let capturedActions;
function CaptureActions() {
	capturedActions = useDocumentPeekActions();
	return null;
}

function renderHost() {
	return render(
		<DocumentPeekProvider>
			<CaptureActions />
			<DocumentPeekHost />
		</DocumentPeekProvider>
	);
}

describe( 'DocumentPeekHost', () => {
	beforeEach( () => {
		capturedActions = null;
		mockNavigate.mockReset();
		mockInvalidateResolution.mockReset();
		mockRowDetailView.mockClear();
	} );

	it( 'rerenders the open side peek when its source row list changes', async () => {
		let rows = [ { id: 99, meta: { 'field-7': 'Open' } } ];
		let notifyRowsChanged;
		const source = {
			kind: 'collection',
			collectionId: 44,
			getRowList: () => rows,
			subscribeToRowList: ( listener ) => {
				notifyRowsChanged = listener;
				return jest.fn();
			},
		};

		renderHost();

		await act( async () => {
			capturedActions.openDocument( {
				id: 99,
				postType: 'crtxt_document',
				collectionId: 44,
				preferredMode: 'side',
				source,
			} );
		} );

		expect( screen.getByTestId( 'row-detail-view' ) ).toHaveTextContent(
			'Open'
		);

		rows = [ { id: 99, meta: { 'field-7': 'Closed' } } ];
		act( () => {
			notifyRowsChanged();
		} );

		expect( screen.getByTestId( 'row-detail-view' ) ).toHaveTextContent(
			'Closed'
		);
		expect( mockRowDetailView ).toHaveBeenLastCalledWith(
			expect.objectContaining( {
				row: expect.objectContaining( {
					meta: { 'field-7': 'Closed' },
				} ),
			} )
		);
	} );

	it( 'refreshes the row lists affected by a restore', async () => {
		const refresh = jest.fn();
		const source = {
			kind: 'collection',
			collectionId: 44,
			getRowList: () => [ { id: 99 } ],
			refresh,
		};

		renderHost();

		await act( async () => {
			capturedActions.openDocument( {
				id: 99,
				postType: 'crtxt_document',
				collectionId: 44,
				preferredMode: 'side',
				source,
			} );
		} );

		act( () => {
			screen.getByRole( 'button', { name: 'Restore' } ).click();
		} );

		expect( mockInvalidateResolution ).toHaveBeenCalledTimes( 1 );
		expect( mockInvalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', DOCUMENT_POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ]
		);
		expect( refresh ).toHaveBeenCalledTimes( 1 );
	} );
} );
