/**
 * Tests for `src/components/lifecycle/LifecycleView.js`, the canvas at `trash`
 * or `archived` before an item is selected.
 */

import { render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Icon: () => null,
} ) );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	box: 'box-icon',
	trash: 'trash-icon',
} ) );

jest.mock( '../../../../src/hooks/useTrashedDocuments', () => ( {
	__esModule: true,
	default: () => mockTrashState,
} ) );

jest.mock( '../../../../src/hooks/useArchivedDocuments', () => ( {
	__esModule: true,
	default: () => mockTrashState,
} ) );

// The state configs also carry the dialogs and the list helpers, which the
// empty pane doesn't use.
jest.mock( '../../../../src/components/lifecycle/EmptyTrashButton', () => ( {
	__esModule: true,
	default: () => null,
} ) );
jest.mock( '../../../../src/components/lifecycle/TrashConfirmDialog', () => ( {
	__esModule: true,
	default: () => null,
} ) );
jest.mock(
	'../../../../src/components/lifecycle/ArchivedTrashConfirmDialog',
	() => ( { __esModule: true, default: () => null } )
);
jest.mock( '../../../../src/components/lifecycle/lifecycleItems', () => ( {
	__esModule: true,
	archivedLabel: () => '',
	deletionLabel: () => '',
} ) );

import LifecycleView from '../../../../src/components/lifecycle/LifecycleView';
import {
	ARCHIVED,
	TRASH,
} from '../../../../src/components/lifecycle/lifecycleStates';

function TrashView( props ) {
	return <LifecycleView state={ TRASH } { ...props } />;
}

let mockTrashState;

function setTrash( documents, overrides = {} ) {
	mockTrashState = {
		documents,
		hasResolved: true,
		error: null,
		...overrides,
	};
}

describe( 'LifecycleView as Trash', () => {
	it( 'renders nothing while Trash is not showing', () => {
		setTrash( [] );
		const { container } = render( <TrashView isActive={ false } /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'says when Trash is empty and how long items stay', () => {
		setTrash( [] );
		render( <TrashView isActive /> );
		expect( screen.getByText( 'Nothing in Trash' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /They stay for 30 days/ )
		).toBeInTheDocument();
	} );

	it( 'leaves the canvas to the selected document when Trash has items', () => {
		setTrash( [ { id: 1 } ] );
		const { container } = render( <TrashView isActive /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'waits for the list before saying anything', () => {
		setTrash( [], { hasResolved: false } );
		const { container } = render( <TrashView isActive /> );
		expect( container ).toBeEmptyDOMElement();
	} );
} );

describe( 'LifecycleView as Archived', () => {
	it( 'says when nothing is archived and that it stays until restored', () => {
		setTrash( [] );
		render( <LifecycleView state={ ARCHIVED } isActive /> );
		expect( screen.getByText( 'Nothing archived' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /until you restore them/ )
		).toBeInTheDocument();
	} );
} );
