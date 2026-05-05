import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const ReactLib = require( 'react' );
	const Button = ( {
		children,
		className,
		disabled,
		icon, // eslint-disable-line no-unused-vars
		label,
		onClick,
		...rest
	} ) =>
		ReactLib.createElement(
			'button',
			{
				...rest,
				'aria-label': label,
				className,
				disabled,
				onClick,
			},
			children ?? label
		);
	const createSlotFill = () => ( {
		Slot: () => null,
		Fill: ( { children } ) =>
			ReactLib.createElement( ReactLib.Fragment, null, children ),
	} );
	return {
		__esModule: true,
		Button,
		createSlotFill,
	};
} );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	chevronLeft: 'chevron-left-icon',
	chevronRight: 'chevron-right-icon',
} ) );

jest.mock( '../../../src/components/Breadcrumbs', () => ( {
	__esModule: true,
	default: () => <nav aria-label="Breadcrumb">Current</nav>,
} ) );

import WorkspaceTopBar from '../../../src/components/WorkspaceTopBar';

function createFakeHistory( initialIndex = 0 ) {
	const subscribers = new Set();
	const history = {
		location: { state: { __TSR_index: initialIndex } },
		subscribe: jest.fn( ( callback ) => {
			subscribers.add( callback );
			return () => subscribers.delete( callback );
		} ),
		back: jest.fn(),
		forward: jest.fn(),
		flush: jest.fn(),
		emit( type, index ) {
			act( () => {
				history.location = { state: { __TSR_index: index } };
				subscribers.forEach( ( callback ) =>
					callback( {
						location: history.location,
						action: { type },
					} )
				);
			} );
		},
	};
	return history;
}

function renderTopBar( history = createFakeHistory() ) {
	render(
		<WorkspaceTopBar
			history={ history }
			paintedRoute={ { kind: 'unresolved' } }
		/>
	);
	return history;
}

describe( 'WorkspaceTopBar', () => {
	it( 'disables back and forward at the initial history index', () => {
		renderTopBar();

		expect(
			screen.getByRole( 'button', { name: 'Go back' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Go forward' } )
		).toBeDisabled();
	} );

	it( 'enables back and keeps forward disabled after a push', () => {
		const history = renderTopBar();

		history.emit( 'PUSH', 1 );

		expect(
			screen.getByRole( 'button', { name: 'Go back' } )
		).not.toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Go forward' } )
		).toBeDisabled();
	} );

	it( 'enables forward after going back and forwards on click', () => {
		const history = renderTopBar();

		history.emit( 'PUSH', 1 );
		history.emit( 'BACK', 0 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Go forward' } ) );

		expect( history.flush ).toHaveBeenCalled();
		expect( history.forward ).toHaveBeenCalled();
	} );

	it( 'clears the known forward branch after a new push', () => {
		const history = renderTopBar();

		history.emit( 'PUSH', 1 );
		history.emit( 'BACK', 0 );
		history.emit( 'PUSH', 1 );

		expect(
			screen.getByRole( 'button', { name: 'Go back' } )
		).not.toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Go forward' } )
		).toBeDisabled();
	} );
} );
