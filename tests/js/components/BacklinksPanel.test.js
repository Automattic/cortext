jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockOpenDocument = jest.fn();
jest.mock( '../../../src/components/DocumentPeekProvider', () => ( {
	useDocumentPeekActions: () => ( { openDocument: mockOpenDocument } ),
} ) );
jest.mock( '../../../src/components/CurrentViewModeContext', () => ( {
	useCurrentViewMode: () => 'side',
} ) );

jest.mock( '../../../src/documents', () => ( {
	documentTitle: ( record ) => record?.title || '(untitled)',
	listIconForRecord: () => <span data-testid="backlink-icon" />,
} ) );

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

import BacklinksPanel from '../../../src/components/BacklinksPanel';
import BacklinksToolbarButton from '../../../src/components/BacklinksToolbarButton';
import { notifyBacklinksChanged } from '../../../src/hooks/backlinksInvalidation';

describe( 'BacklinksPanel', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'shows backlinks and opens the source document', async () => {
		apiFetch.mockResolvedValueOnce( {
			total: 2,
			sources: [
				{
					collection: {
						id: 5,
						title: 'Tasks',
						path: 'tasks-5',
					},
					id: 11,
					title: 'Launch',
					path: 'launch-11',
				},
				{
					collection: null,
					id: 12,
					title: 'Notes',
					path: 'notes-12',
				},
			],
		} );

		render( <BacklinksPanel documentId={ 9 } initialOpen /> );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/9/backlinks',
		} );
		expect( await screen.findByText( '2 backlinks' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Tasks (1)' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Pages (1)' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Launch' ) );

		expect( mockOpenDocument ).toHaveBeenCalledWith(
			expect.objectContaining( { id: 11, collectionId: 5 } )
		);
	} );

	it( 'hides itself when there are no backlinks', async () => {
		apiFetch.mockResolvedValueOnce( { total: 0, sources: [] } );

		const { container } = render( <BacklinksPanel documentId={ 9 } /> );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'refreshes when backlink data changes', async () => {
		apiFetch
			.mockResolvedValueOnce( { total: 0, sources: [] } )
			.mockResolvedValueOnce( {
				total: 1,
				sources: [
					{
						collection: null,
						id: 12,
						title: 'Updated source',
						path: 'updated-source-12',
					},
				],
			} );

		const { container } = render(
			<BacklinksPanel documentId={ 9 } initialOpen />
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( container ).toBeEmptyDOMElement();

		act( () => {
			notifyBacklinksChanged();
		} );

		expect( await screen.findByText( '1 backlink' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Updated source' ) ).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'refreshes the popover when it opens', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				total: 1,
				sources: [
					{
						collection: null,
						id: 12,
						title: 'Draft source',
						path: 'draft-source-12',
					},
				],
			} )
			.mockResolvedValueOnce( {
				total: 2,
				sources: [
					{
						collection: null,
						id: 12,
						title: 'Draft source',
						mentions: 2,
						path: 'draft-source-12',
					},
				],
			} );

		render( <BacklinksToolbarButton documentId={ 9 } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: '1 backlink' } )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( await screen.findByText( '2 backlinks' ) ).toBeInTheDocument();
		expect( screen.getByText( '(2)' ) ).toBeInTheDocument();
	} );

	it( 'shows a single backlink without a group header', async () => {
		apiFetch.mockResolvedValueOnce( {
			total: 1,
			sources: [
				{
					collection: null,
					id: 12,
					title: 'Welcome to Cortext',
					path: 'welcome-to-cortext-12',
				},
			],
		} );

		render( <BacklinksPanel documentId={ 9 } initialOpen /> );

		expect( await screen.findByText( '1 backlink' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Welcome to Cortext' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Pages (1)' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps legacy grouped responses from showing the same source twice', async () => {
		apiFetch.mockResolvedValueOnce( {
			total: 2,
			groups: [
				{
					collection: { id: 5, title: 'Tasks' },
					sources: [
						{
							id: 12,
							title: 'Shared source',
							path: 'shared-source-12',
						},
					],
				},
				{
					collection: { id: 6, title: 'Musicians' },
					sources: [
						{
							id: 12,
							title: 'Shared source',
							path: 'shared-source-12',
						},
					],
				},
			],
		} );

		render( <BacklinksPanel documentId={ 9 } initialOpen /> );

		expect(
			await screen.findByText( 'Shared source' )
		).toBeInTheDocument();
		expect( screen.getAllByText( 'Shared source' ) ).toHaveLength( 1 );
		expect( screen.queryByText( 'Tasks (1)' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Musicians (1)' ) ).not.toBeInTheDocument();
	} );
} );
