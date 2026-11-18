import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockUnarchive = jest.fn();
const mockTrash = jest.fn();
const mockNavigate = jest.fn();

jest.mock( '@wordpress/components', () => {
	const React = require( 'react' );
	return {
		Button: ( {
			children,
			label,
			onClick,
			disabled,
			icon,
			isDestructive,
			size,
			variant,
			...props
		} ) => (
			<button
				type="button"
				aria-label={ label }
				onClick={ onClick }
				disabled={ disabled }
				{ ...props }
			>
				{ children ?? label }
			</button>
		),
		__experimentalConfirmDialog: ( {
			children,
			onConfirm,
			confirmButtonText,
		} ) =>
			React.createElement(
				'div',
				{ role: 'dialog' },
				children,
				React.createElement(
					'button',
					{ type: 'button', onClick: onConfirm },
					confirmButtonText
				)
			),
	};
} );

jest.mock( '@wordpress/icons', () => ( {
	rotateLeft: 'restore',
	trash: 'trash',
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '../../../src/components/DocumentIcon', () => () => null );
jest.mock( '../../../src/components/Skeleton', () => ( {
	SidebarListSkeleton: () => <div data-testid="skeleton" />,
} ) );
jest.mock( '../../../src/hooks/useDelayedFlag', () => ( {
	__esModule: true,
	default: () => false,
	SKELETON_MIN_VISIBLE_MS: 0,
} ) );

jest.mock( '../../../src/documents', () => ( {
	useDocumentActions: () => ( {
		unarchive: mockUnarchive,
		trash: mockTrash,
	} ),
	useDocumentRecord: ( record ) => ( {
		title:
			record.title?.rendered?.trim() ||
			record.title?.raw?.trim() ||
			'(untitled)',
		features: {
			hierarchy: ! record.crtxt_trait?.length,
		},
		nestedDocumentCountLabel: ( counts ) =>
			`${ counts.total } nested ${
				counts.total === 1 ? 'document' : 'documents'
			}`,
	} ),
} ) );

import SidebarArchive, {
	computeSidebarArchiveRoots,
} from '../../../src/components/SidebarArchive';

function makeDocument( overrides = {} ) {
	return {
		id: 1,
		path: 'page/finished-1',
		title: { raw: 'Finished', rendered: 'Finished' },
		meta: {},
		...overrides,
	};
}

function makeState( documents = [] ) {
	return {
		documents,
		total: documents.length,
		isLoading: false,
		hasResolved: true,
		error: null,
		refresh: jest.fn(),
	};
}

function renderArchive( documents, props = {} ) {
	return render(
		<SidebarArchive
			activePages={ [] }
			archivedDocumentsState={ makeState( documents ) }
			{ ...props }
		/>
	);
}

beforeEach( () => {
	mockUnarchive.mockReset();
	mockUnarchive.mockResolvedValue( undefined );
	mockTrash.mockReset();
	mockTrash.mockResolvedValue( undefined );
	mockNavigate.mockReset();
} );

it( 'shows the archived empty state', () => {
	renderArchive( [] );
	expect( screen.getByText( 'No archived documents.' ) ).toBeInTheDocument();
} );

it( 'collapses parent and collection cascades into recoverable roots', () => {
	const root = makeDocument();
	const child = makeDocument( {
		id: 2,
		title: { raw: 'Child', rendered: 'Child' },
		meta: { _cortext_archived_by_parent: 1 },
	} );
	const row = makeDocument( {
		id: 3,
		crtxt_trait: [ 1 ],
		title: { raw: 'Row', rendered: 'Row' },
		meta: { _cortext_archived_by_collection: 2 },
	} );

	const result = computeSidebarArchiveRoots( [ root, child, row ] );

	expect( result.roots ).toEqual( [ root ] );
	expect( result.descendantCountById.get( 1 ) ).toEqual( { total: 2 } );
	renderArchive( [ root, child, row ] );
	expect( screen.getByText( 'Finished' ) ).toBeInTheDocument();
	expect( screen.queryByText( 'Child' ) ).not.toBeInTheDocument();
	expect( screen.getByText( '2 nested documents' ) ).toBeInTheDocument();
} );

it( 'promotes a document with a stale marker to a root', () => {
	const orphan = makeDocument( {
		id: 8,
		title: { raw: 'Recover me', rendered: 'Recover me' },
		meta: { _cortext_archived_by_parent: 99 },
	} );

	expect( computeSidebarArchiveRoots( [ orphan ] ).roots ).toEqual( [
		orphan,
	] );
} );

it( 'restores an archived document', async () => {
	const record = makeDocument();
	renderArchive( [ record ] );

	fireEvent.click( screen.getByRole( 'button', { name: 'Restore' } ) );

	await waitFor( () =>
		expect( mockUnarchive ).toHaveBeenCalledWith( record )
	);
} );

it( 'identifies the selected archived document to assistive technology', () => {
	const record = makeDocument();
	const { container } = renderArchive( [ record ], {
		selectedId: record.id,
	} );

	expect(
		screen.getByRole( 'button', { name: 'Finished' } )
	).toHaveAttribute( 'aria-current', 'page' );
	expect(
		container.querySelector( '[data-cortext-document-id="1"]' )
	).toBeInTheDocument();
} );

it( 'confirms the 30 day purge before moving an archive to Trash', async () => {
	const record = makeDocument();
	renderArchive( [ record ] );

	fireEvent.click( screen.getByRole( 'button', { name: 'Move to Trash' } ) );
	expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( '30 days' );
	fireEvent.click( screen.getByRole( 'dialog' ).querySelector( 'button' ) );

	await waitFor( () => expect( mockTrash ).toHaveBeenCalledWith( record ) );
} );
