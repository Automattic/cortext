import { fireEvent, render, screen } from '@testing-library/react';

import DocumentPropertiesActions from '../../../src/components/DocumentPropertiesActions';
import { DocumentPropertiesProvider } from '../../../src/components/DocumentPropertiesContext';

jest.mock( '@wordpress/components', () => ( {
	Button: ( { children, isPressed, onClick } ) => (
		<button type="button" aria-pressed={ isPressed } onClick={ onClick }>
			{ children }
		</button>
	),
	Dropdown: () => null,
	PanelBody: ( { children, title } ) => (
		<section aria-label={ title }>{ children }</section>
	),
} ) );

jest.mock( '@wordpress/icons', () => ( {
	pencil: 'pencil',
	plus: 'plus',
	seen: 'seen',
	unseen: 'unseen',
} ) );

jest.mock( '../../../src/components/fields/AddFieldPopover', () => ( {
	__esModule: true,
	default: () => null,
} ) );

jest.mock( '../../../src/components/CollectionFieldsContext', () => ( {
	CollectionFieldsProvider: ( { children } ) => <>{ children }</>,
} ) );

describe( 'DocumentPropertiesActions', () => {
	it( 'shows the row properties edit action in the inspector', () => {
		const onRequestLayoutEdit = jest.fn();

		render(
			<DocumentPropertiesProvider
				fields={ [ { id: 'field-1', label: 'Status' } ] }
				isVisible
				onRequestLayoutEdit={ onRequestLayoutEdit }
				onToggleVisible={ jest.fn() }
			>
				<DocumentPropertiesActions />
			</DocumentPropertiesProvider>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);

		expect( onRequestLayoutEdit ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'marks the edit action pressed while properties are being edited', () => {
		render(
			<DocumentPropertiesProvider
				fields={ [ { id: 'field-1', label: 'Status' } ] }
				isLayoutEditing
				isVisible
				onRequestLayoutEdit={ jest.fn() }
				onToggleVisible={ jest.fn() }
			>
				<DocumentPropertiesActions />
			</DocumentPropertiesProvider>
		);

		expect(
			screen.getByRole( 'button', { name: 'Done customizing' } )
		).toHaveAttribute( 'aria-pressed', 'true' );
	} );
} );
