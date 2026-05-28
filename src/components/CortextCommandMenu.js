import { Command, defaultFilter, useCommandState } from 'cmdk';

import { Modal, TextHighlight } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	isValidElement,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, search as inputIcon } from '@wordpress/icons';
import {
	store as keyboardShortcutsStore,
	useShortcut,
} from '@wordpress/keyboard-shortcuts';
import { store as commandsStore } from '@wordpress/commands';

// `@wordpress/commands` drops unknown command fields. Keep descriptions in a
// separate map keyed by `command.name`.
const EMPTY_DESCRIPTIONS = new Map();
export const CommandDescriptionContext = createContext( EMPTY_DESCRIPTIONS );

// tech-debt.md#td-command-palette-host-glue: @wordpress/commands has no custom group API. Keep the
// upstream store/hooks, but render the menu locally so workspace recents
// can live in their own section.
const ITEM_ID_PREFIX = 'command-palette-item-';
const RECENT_COMMAND_PREFIX = 'cortext/recent/';
const DOCUMENT_COMMAND_PREFIX = 'cortext/document/';
const commandMenuLabel = __( 'Search or run a command', 'cortext' );
const inputPlaceholder = __(
	'Search pages, collections, and actions',
	'cortext'
);

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

function isDocumentCommand( command ) {
	return command?.name?.startsWith( DOCUMENT_COMMAND_PREFIX );
}

export function splitPaletteCommands( commands ) {
	return commands.reduce(
		( groups, command ) => {
			if ( isDocumentCommand( command ) ) {
				groups.documentCommands.push( command );
			} else if ( isRecentCommand( command ) ) {
				groups.recentCommands.push( command );
			} else {
				groups.commands.push( command );
			}
			return groups;
		},
		{ documentCommands: [], recentCommands: [], commands: [] }
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
	const descriptions = useContext( CommandDescriptionContext );
	const description = descriptions.get( command.name );
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
				<div className="commands-command-menu__item-main">
					<span className="commands-command-menu__item-label">
						<TextHighlight
							text={ command.label }
							highlight={ search }
						/>
					</span>
					{ description && (
						<span className="commands-command-menu__item-description">
							<TextHighlight
								text={ description }
								highlight={ search }
							/>
						</span>
					) }
				</div>
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
			placeholder={ inputPlaceholder }
			aria-activedescendant={ selectedItemId }
		/>
	);
}

function PaletteGroups( { search } ) {
	const { contextualCommands, staticCommands } = useSelect( ( select ) => {
		const { getCommands } = select( commandsStore );
		return {
			contextualCommands: getCommands( true ),
			staticCommands: getCommands( false ),
		};
	}, [] );
	const allCommands = useMemo(
		() => [ ...staticCommands, ...contextualCommands ],
		[ staticCommands, contextualCommands ]
	);
	const { documentCommands, recentCommands, commands } = splitPaletteCommands(
		search ? allCommands : contextualCommands
	);

	return (
		<>
			{ search && documentCommands.length > 0 && (
				<Command.Group
					className="cortext-command-palette__group cortext-command-palette__group--documents"
					heading={ __( 'Search results', 'cortext' ) }
				>
					<CommandList
						commands={ documentCommands }
						search={ search }
						showCategory={ false }
						valuePrefix="document-"
					/>
				</Command.Group>
			) }
			{ ! search && recentCommands.length > 0 && (
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
			{ ! search && commands.length > 0 && (
				<Command.Group
					className="cortext-command-palette__group"
					heading={ __( 'Suggestions', 'cortext' ) }
				>
					<CommandList commands={ commands } search={ search } />
				</Command.Group>
			) }
		</>
	);
}

// cmdk re-scores and re-sorts every item on each keystroke. For server-side
// search results (the documents group) that means the highlighted item can
// hop around the list as the user types. Pin all document commands to a
// constant score so cmdk keeps the server's order and stops shuffling them.
// Non-document items still go through cmdk's default filter.
function palettePinnedFilter( value, search, keywords ) {
	if ( value.startsWith( 'document-' ) ) {
		return 1;
	}
	return defaultFilter( value, search, keywords );
}

export default function CortextCommandMenu( {
	search = '',
	setSearch = () => {},
	isDocumentSearchPending = false,
	selectedValue,
	onSelectedValueChange = () => {},
} = {} ) {
	const { registerShortcut } = useDispatch( keyboardShortcutsStore );
	const { open, close } = useDispatch( commandsStore );
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
				<Command
					label={ commandMenuLabel }
					loop
					filter={ palettePinnedFilter }
					value={ selectedValue }
					onValueChange={ onSelectedValueChange }
				>
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
						{ search && ! isDocumentSearchPending && (
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
