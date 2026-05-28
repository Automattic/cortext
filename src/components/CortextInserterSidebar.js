// Renders the full block inserter as a secondary sidebar inside the
// Cortext canvas. Gutenberg's Quick Inserter calls
// `__experimentalSetIsInserterOpened` when the user clicks Browse All;
// `@wordpress/editor`'s EditorProvider wires that setting to the
// `core/editor` store's `setIsInserterOpened` action (see
// `use-block-editor-settings.js`), so the click flips the store flag.
// This component is the UI side of that contract: when the flag is
// truthy, render `__experimentalLibrary` with the insertion context the
// Quick Inserter carried in, and close on ESC or selection.
//
// The DOM uses Gutenberg's own `editor-inserter-sidebar` class names so
// the package's CSS applies without Cortext having to redefine it.
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
import { __experimentalLibrary as InserterLibrary } from '@wordpress/block-editor';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useRef } from '@wordpress/element';
import { ESCAPE } from '@wordpress/keycodes';

import './CortextInserterSidebar.scss';

export default function CortextInserterSidebar() {
	const inserter = useSelect(
		( select ) => select( editorStore ).isInserterOpened(),
		[]
	);
	const { setIsInserterOpened } = useDispatch( editorStore );
	const libraryRef = useRef();

	const close = useCallback( () => {
		setIsInserterOpened( false );
	}, [ setIsInserterOpened ] );

	const onKeyDown = useCallback(
		( event ) => {
			if ( event.keyCode === ESCAPE && ! event.defaultPrevented ) {
				event.preventDefault();
				close();
			}
		},
		[ close ]
	);

	// The selector returns `true`, `false`, or an object the Quick Inserter
	// supplied with insertion context. Treat anything non-object as "no
	// extra context" and let the library default to root-level insertion.
	const context = inserter && typeof inserter === 'object' ? inserter : null;

	return (
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			className="editor-inserter-sidebar cortext-inserter-sidebar"
			onKeyDown={ onKeyDown }
		>
			<div className="editor-inserter-sidebar__content">
				<InserterLibrary
					ref={ libraryRef }
					showInserterHelpPanel
					rootClientId={ context?.rootClientId }
					__experimentalInsertionIndex={ context?.insertionIndex }
					__experimentalFilterValue={ context?.filterValue }
					onSelect={ context?.onSelect }
					onClose={ close }
				/>
			</div>
		</div>
	);
}
