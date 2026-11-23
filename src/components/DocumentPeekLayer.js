import {
	createSlotFill,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalUseSlotFills as useSlotFills,
} from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';

import PeekWindow from './PeekWindow';
import { getPeekToFullStage } from './rowDetailUtils';
import {
	useDocumentPeekActions,
	useDocumentPeekState,
} from './DocumentPeekProvider';

export const DocumentPeekSlot = createSlotFill( 'CortextDocumentPeek' );

// Longest exit animation (side peek slide-out) plus a margin, in case the
// animationend event never arrives.
const EXIT_FALLBACK_MS = 400;

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

// Where the open peek lives on screen. It renders the peek's window and,
// for a center peek, the overlay behind it. The window stays mounted while
// the peek moves between side and center, and plays its exit animation
// after the peek closes.
export function DocumentPeekLayer() {
	const fills = useSlotFills( DocumentPeekSlot.name );
	const hasPeek = Boolean( fills?.length );
	const { peek } = useDocumentPeekState();
	const { closeDocument } = useDocumentPeekActions();
	const [ isRendered, setIsRendered ] = useState( hasPeek );
	// The enter animation depends on how the peek opened, not on later mode
	// switches, so it doesn't replay while the window resizes.
	const [ openedAsCenter, setOpenedAsCenter ] = useState(
		peek?.mode === 'modal'
	);
	// Each open gets a fresh window, even one that starts while the previous
	// window is still playing its exit animation, so its enter animation and
	// focus match how this open started.
	const [ openCount, setOpenCount ] = useState( 0 );
	const [ wasOpen, setWasOpen ] = useState( hasPeek );
	// Show the window in the same render the fill arrives in.
	if ( hasPeek !== wasOpen ) {
		setWasOpen( hasPeek );
		if ( hasPeek ) {
			setIsRendered( true );
			setOpenedAsCenter( peek?.mode === 'modal' );
			setOpenCount( ( count ) => count + 1 );
		}
	}
	// Keep the last mode while the window closes, so a center peek fades out
	// where it is.
	const [ mode, setMode ] = useState( peek?.mode ?? 'side' );
	if ( peek?.mode && peek.mode !== mode ) {
		setMode( peek.mode );
	}

	useEffect( () => {
		if ( hasPeek || ! isRendered ) {
			return undefined;
		}
		if ( prefersReducedMotion() || getPeekToFullStage() ) {
			setIsRendered( false );
			return undefined;
		}
		const timeout = setTimeout(
			() => setIsRendered( false ),
			EXIT_FALLBACK_MS
		);
		return () => clearTimeout( timeout );
	}, [ hasPeek, isRendered ] );

	if ( ! isRendered ) {
		return null;
	}

	const isClosing = ! hasPeek;
	const isCenter = mode === 'modal';

	return (
		<>
			{ /* Mouse-only shortcut; the window handles Escape. */ }
			{ /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */ }
			<div
				className={
					'cortext-row-detail-overlay' +
					( isCenter && ! isClosing ? ' is-visible' : '' )
				}
				onClick={ closeDocument }
			/>
			<PeekWindow
				key={ openCount }
				mode={ mode }
				openedAsCenter={ openedAsCenter }
				isClosing={ isClosing }
				onRequestClose={ closeDocument }
				onExited={ () => setIsRendered( false ) }
			>
				<DocumentPeekSlot.Slot
					bubblesVirtually
					className="cortext-row-detail-sidebar"
				/>
			</PeekWindow>
		</>
	);
}
