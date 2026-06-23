jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockNavigate = jest.fn();
jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '../../../src/documents', () => ( {
	documentTitle: ( record ) => record?.title || '(untitled)',
	listIconForRecord: () => <span data-testid="backlink-icon" />,
} ) );

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

import BacklinksPanel from '../../../src/components/BacklinksPanel';

describe( 'BacklinksPanel', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'renders flat backlinks and navigates to a source', async () => {
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
		expect(
			await screen.findByText( 'Backlinks (2)' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Tasks (1)' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Pages (1)' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Launch' ) );

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'launch-11' },
		} );
	} );

	it( 'stays hidden when there are no backlinks', async () => {
		apiFetch.mockResolvedValueOnce( { total: 0, sources: [] } );

		const { container } = render( <BacklinksPanel documentId={ 9 } /> );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'does not repeat the collection header for a single backlink', async () => {
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

		expect( await screen.findByText( 'Backlink (1)' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Welcome to Cortext' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Pages (1)' ) ).not.toBeInTheDocument();
	} );

	it( 'deduplicates legacy grouped responses by source id', async () => {
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
