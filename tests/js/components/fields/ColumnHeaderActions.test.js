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
				icon, // eslint-disable-line no-unused-vars
				isPressed,
				label,
				onClick,
				size, // eslint-disable-line no-unused-vars
				variant, // eslint-disable-line no-unused-vars
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
	const { createElement } = require( '@wordpress/element' );
	const Menu = ( { children } ) => createElement( 'div', null, children );
	Menu.Group = ( { children } ) => createElement( 'div', null, children );
	Menu.Item = ( { children } ) => createElement( 'button', null, children );
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

jest.mock( '../../../../src/components/fields/AddFieldPopover', () => ( {
	__esModule: true,
	default: ( { collectionId } ) => (
		<div>{ `Add field for collection ${ collectionId }` }</div>
	),
} ) );

import ColumnHeaderActions from '../../../../src/components/fields/ColumnHeaderActions';

function Harness( { collectionId } ) {
	return (
		<div className="cortext-data-view">
			<table>
				<thead>
					<tr>
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
} );
