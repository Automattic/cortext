// Renders Gutenberg's full inserter inside the Cortext canvas. Browse All
// stores either `true` or the Quick Inserter payload: filter text, insertion
// target, and `onSelect`. Pass that payload through so a slash-menu search
// opens the same filtered view in the sidebar.
//
// The public `isInserterOpened` selector only gives us a boolean. Gutenberg's
// own sidebar reads the private `getInserter` selector via `unlock`; we do the
// same here so Browse All keeps the Quick Inserter context.
//
// Keep Gutenberg's class names so its sidebar styles apply here too.
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
import { __experimentalLibrary as InserterLibrary } from '@wordpress/block-editor';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useRef } from '@wordpress/element';
import { ESCAPE } from '@wordpress/keycodes';

import { unlock } from '../lock-unlock';
import './CortextInserterSidebar.scss';

export default function CortextInserterSidebar() {
	const inserter = useSelect(
		( select ) => unlock( select( editorStore ) ).getInserter(),
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
					rootClientId={ inserter?.rootClientId }
					__experimentalInsertionIndex={ inserter?.insertionIndex }
					__experimentalFilterValue={ inserter?.filterValue }
					onSelect={ inserter?.onSelect }
					onClose={ close }
				/>
			</div>
		</div>
	);
}
