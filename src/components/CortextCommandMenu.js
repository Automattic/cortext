import { Command, useCommandState } from 'cmdk';

import { Modal, TextHighlight } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	useEffect,
	useRef,
	useState,
	isValidElement,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, search as inputIcon } from '@wordpress/icons';
import {
	store as keyboardShortcutsStore,
	useShortcut,
} from '@wordpress/keyboard-shortcuts';
import { store as commandsStore } from '@wordpress/commands';

// tech-debt.md#38: @wordpress/commands has no custom group API. Keep the
// upstream store/hooks, but render the menu locally so workspace recents
// can live in their own section.
const ITEM_ID_PREFIX = 'command-palette-item-';
const RECENT_COMMAND_PREFIX = 'cortext/recent/';
const inputLabel = __( 'Search commands and settings' );

const CATEGORY_LABELS = {
	command: __( 'Command' ),
	view: __( 'View' ),
	edit: __( 'Edit' ),
	action: __( 'Action' ),
	workflow: __( 'Workflow' ),
};

function isRecentCommand( command ) {
	return command?.name?.startsWith( RECENT_COMMAND_PREFIX );
}

export function splitPaletteCommands( commands ) {
	return commands.reduce(
		( groups, command ) => {
			if ( isRecentCommand( command ) ) {
				groups.recentCommands.push( command );
			} else {
				groups.commands.push( command );
			}
			return groups;
		},
		{ recentCommands: [], commands: [] }
	);
}

function isRawSvgIconElement( icon ) {
	return (
		isValidElement( icon ) &&
		icon.props?.xmlns === 'http://www.w3.org/2000/svg' &&
		!! icon.props?.viewBox
	);
}

export function CommandIcon( { icon } ) {
	if ( ! icon ) {
		return null;
	}
	if ( isRawSvgIconElement( icon ) ) {
		return <Icon icon={ icon } size={ 16 } />;
	}
	if ( isValidElement( icon ) ) {
		return icon;
	}
	return <Icon icon={ icon } size={ 16 } />;
}

function CommandItem( {
	command,
	search,
	showCategory = true,
	valuePrefix = '',
} ) {
	const { close } = useDispatch( commandsStore );
	const label = command.searchLabel ?? command.label;
	const value = valuePrefix ? `${ valuePrefix }${ command.name }` : label;
	const itemId = `${ ITEM_ID_PREFIX }${ value.toLowerCase() }`;

	return (
		<Command.Item
			key={ command.name }
			id={ itemId }
			value={ value }
			keywords={
				valuePrefix
					? [ ...( command.keywords ?? [] ), label ]
					: command.keywords
			}
			onSelect={ () => command.callback( { close } ) }
		>
			<div
				className={ [
					'commands-command-menu__item',
					command.icon ? 'has-icon' : null,
				]
					.filter( Boolean )
					.join( ' ' ) }
			>
				<CommandIcon icon={ command.icon } />
				<span className="commands-command-menu__item-label">
					<TextHighlight
						text={ command.label }
						highlight={ search }
					/>
				</span>
				{ showCategory && CATEGORY_LABELS[ command.category ] && (
					<span className="commands-command-menu__item-category">
						{ CATEGORY_LABELS[ command.category ] }
					</span>
				) }
			</div>
		</Command.Item>
	);
}

function CommandList( { commands, search, showCategory, valuePrefix } ) {
	return commands.map( ( command ) => (
		<CommandItem
			key={ command.name }
			command={ command }
			search={ search }
			showCategory={ showCategory }
			valuePrefix={ valuePrefix }
		/>
	) );
}

function CommandInput( { search, setSearch } ) {
	const commandMenuInput = useRef();
	const selectedValue = useCommandState( ( state ) => state.value );
	const selectedItemId = selectedValue
		? `${ ITEM_ID_PREFIX }${ selectedValue.toLowerCase() }`
		: null;

	useEffect( () => {
		commandMenuInput.current?.focus();
	}, [] );

	return (
		<Command.Input
			ref={ commandMenuInput }
			value={ search }
			onValueChange={ setSearch }
			placeholder={ inputLabel }
			aria-activedescendant={ selectedItemId }
		/>
	);
}

function PaletteGroups( { search } ) {
	const { contextualCommands, allCommands } = useSelect( ( select ) => {
		const { getCommands } = select( commandsStore );
		return {
			contextualCommands: getCommands( true ),
			allCommands: [ ...getCommands( false ), ...getCommands( true ) ],
		};
	}, [] );
	const { recentCommands, commands } = splitPaletteCommands(
		search ? allCommands : contextualCommands
	);

	return (
		<>
			{ recentCommands.length > 0 && (
				<Command.Group
					className="cortext-command-palette__group cortext-command-palette__group--recent"
					heading={ __( 'Recent', 'cortext' ) }
				>
					<CommandList
						commands={ recentCommands }
						search={ search }
						showCategory={ false }
						valuePrefix="recent-"
					/>
				</Command.Group>
			) }
			{ commands.length > 0 && (
				<Command.Group
					className="cortext-command-palette__group"
					heading={
						search
							? __( 'Results', 'cortext' )
							: __( 'Suggestions', 'cortext' )
					}
				>
					<CommandList commands={ commands } search={ search } />
				</Command.Group>
			) }
		</>
	);
}

export default function CortextCommandMenu() {
	const { registerShortcut } = useDispatch( keyboardShortcutsStore );
	const { open, close } = useDispatch( commandsStore );
	const [ search, setSearch ] = useState( '' );
	const paletteIsOpen = useSelect(
		( select ) => select( commandsStore ).isOpen(),
		[]
	);

	useEffect( () => {
		registerShortcut( {
			name: 'core/commands',
			category: 'global',
			description: __( 'Open the command palette.' ),
			keyCombination: {
				modifier: 'primary',
				character: 'k',
			},
		} );
	}, [ registerShortcut ] );

	useShortcut(
		'core/commands',
		( event ) => {
			if ( event.defaultPrevented ) {
				return;
			}

			event.preventDefault();
			if ( paletteIsOpen ) {
				close();
			} else {
				open();
			}
		},
		{ bindGlobal: true }
	);

	const closeAndReset = () => {
		setSearch( '' );
		close();
	};

	if ( ! paletteIsOpen ) {
		return false;
	}

	return (
		<Modal
			className="commands-command-menu"
			overlayClassName="commands-command-menu__overlay"
			onRequestClose={ closeAndReset }
			__experimentalHideHeader
			size="medium"
			contentLabel={ __( 'Command palette' ) }
		>
			<div className="commands-command-menu__container">
				<Command label={ inputLabel } loop>
					<div className="commands-command-menu__header">
						<Icon
							className="commands-command-menu__header-search-icon"
							icon={ inputIcon }
						/>
						<CommandInput
							search={ search }
							setSearch={ setSearch }
						/>
					</div>
					<Command.List label={ __( 'Command suggestions' ) }>
						{ search && (
							<Command.Empty>
								{ __( 'No results found.' ) }
							</Command.Empty>
						) }
						<PaletteGroups search={ search } />
					</Command.List>
				</Command>
			</div>
		</Modal>
	);
}
