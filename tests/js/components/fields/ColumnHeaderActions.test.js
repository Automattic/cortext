import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const {
		createElement,
		forwardRef,
		useState,
	} = require( '@wordpress/element' );

	const Button = forwardRef(
		(
			{
				children,
				icon,
				isPressed,
				label,
				onClick,
				size,
				variant,
				...rest
			},
			ref
		) =>
			createElement(
				'button',
				{
					...rest,
					ref,
					type: 'button',
					'aria-label': label,
					'aria-pressed': isPressed ? 'true' : 'false',
					onClick,
				},
				children ?? label
			)
	);
	Button.displayName = 'Button';

	const Dropdown = ( { renderToggle, renderContent } ) => {
		const [ isOpen, setIsOpen ] = useState( false );
		const onClose = () => setIsOpen( false );
		const onToggle = () => setIsOpen( ( current ) => ! current );

		return createElement(
			'div',
			null,
			renderToggle( { isOpen, onClose, onToggle } ),
			isOpen
				? createElement(
						'div',
						{ role: 'dialog' },
						renderContent( { onClose } )
				  )
				: null
		);
	};

	const Passthrough = ( { children } ) =>
		createElement( 'div', null, children );

	return {
		__esModule: true,
		Button,
		Dropdown,
		Icon: () => null,
		Popover: Passthrough,
		privateApis: {},
		__experimentalConfirmDialog: Passthrough,
	};
} );

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn(),
} ) );

jest.mock( '../../../../src/lock-unlock', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );
	const Menu = ( { children } ) => createElement( 'div', null, children );
	Menu.Group = ( { children } ) => createElement( 'div', null, children );
	Menu.Item = forwardRef( ( { children, onClick }, ref ) =>
		createElement( 'button', { ref, onClick }, children )
	);
	Menu.Item.displayName = 'MenuItem';
	Menu.ItemLabel = ( { children } ) =>
		createElement( 'span', null, children );
	Menu.Popover = ( { children } ) => createElement( 'div', null, children );
	Menu.RadioItem = ( { children } ) =>
		createElement( 'button', null, children );
	Menu.Separator = () => createElement( 'hr' );
	Menu.TriggerButton = ( { children } ) =>
		createElement( 'button', null, children );

	return {
		unlock: () => ( { Menu } ),
	};
} );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useDeleteField: () => ( { run: jest.fn() } ),
	useDuplicateField: () => ( { run: jest.fn() } ),
} ) );

jest.mock( '../../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '../../../../src/components/fields/AddFieldPopover', () => ( {
	__esModule: true,
	default: ( { collectionId } ) => (
		<div>{ `Add field for collection ${ collectionId }` }</div>
	),
} ) );

import ColumnHeaderActions from '../../../../src/components/fields/ColumnHeaderActions';
import { useEntityRecord } from '@wordpress/core-data';
import useCollectionFields from '../../../../src/hooks/useCollectionFields';

function Harness( { collectionId, recordId } ) {
	return (
		<div className="cortext-data-view">
			<table>
				<thead>
					<tr>
						{ recordId ? (
							<th>
								<span data-cortext-field-marker={ recordId } />
							</th>
						) : null }
						<th>
							<span data-cortext-add-field-marker="true" />
						</th>
					</tr>
				</thead>
			</table>
			<ColumnHeaderActions
				collectionId={ collectionId }
				view={ { fields: [] } }
				onChangeView={ jest.fn() }
			/>
		</div>
	);
}

describe( 'ColumnHeaderActions', () => {
	beforeEach( () => {
		useCollectionFields.mockReturnValue( { fields: [] } );
		useEntityRecord.mockReturnValue( {
			record: {
				id: 77,
				title: { raw: 'Invoices', rendered: 'Invoices' },
				meta: { type: 'relation' },
			},
		} );
	} );

	it( 'closes the add-field dropdown when the collection changes', async () => {
		const { rerender } = render( <Harness collectionId={ 5 } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add field' } )
		);

		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'Add field for collection 5'
		);

		rerender( <Harness collectionId={ 6 } /> );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'warns when deleting a field will also delete dependent rollups', async () => {
		useCollectionFields.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Invoices',
					cortextType: 'relation',
				},
				{
					id: 'field-88',
					recordId: 88,
					label: 'Invoice total',
					cortextType: 'rollup',
					rollupRelationFieldId: 77,
					rollupTargetFieldId: 99,
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Delete' } )
		);

		expect(
			screen.getByText(
				'This will also delete 1 rollup that depends on it:',
				{ exact: false }
			)
		).toBeInTheDocument();
		expect( screen.getByText( /Invoice total/ ) ).toBeInTheDocument();
	} );
} );
