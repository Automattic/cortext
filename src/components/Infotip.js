import { Icon, Popover, VisuallyHidden } from '@wordpress/components';
import { useEffect, useId, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { info } from '@wordpress/icons';

const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_DELAY_MS = 200;

// Accessible hover-triggered info popup.
//
// Reach for this instead of `Tooltip` when the trigger's only purpose is to
// reveal the popup, since tooltips are hidden from touch users and announce as
// no-op buttons to AT.
//
// Mirrors the Gutenberg design system's "Infotip" pattern (Popover with
// openOnHover on the trigger), reimplemented on top of @wordpress/components
// since the new @wordpress/ui package isn't a dependency here and is still
// experimental.
//
// @see https://github.com/WordPress/gutenberg/blob/trunk/packages/ui/src/tooltip/stories/usage-guidelines.mdx#infotips
export default function Infotip( {
	description,
	label = __( 'More information', 'cortext' ),
	placement = 'top',
} ) {
	const [ isOpen, setIsOpen ] = useState( false );
	const triggerRef = useRef( null );
	const openTimer = useRef( null );
	const closeTimer = useRef( null );
	const descriptionId = useId();

	const cancelTimers = () => {
		if ( openTimer.current ) {
			clearTimeout( openTimer.current );
			openTimer.current = null;
		}
		if ( closeTimer.current ) {
			clearTimeout( closeTimer.current );
			closeTimer.current = null;
		}
	};

	useEffect( () => () => cancelTimers(), [] );

	const scheduleOpen = () => {
		cancelTimers();
		openTimer.current = setTimeout(
			() => setIsOpen( true ),
			HOVER_OPEN_DELAY_MS
		);
	};
	const scheduleClose = () => {
		cancelTimers();
		closeTimer.current = setTimeout(
			() => setIsOpen( false ),
			HOVER_CLOSE_DELAY_MS
		);
	};
	const openNow = () => {
		cancelTimers();
		setIsOpen( true );
	};
	const closeNow = () => {
		cancelTimers();
		setIsOpen( false );
	};

	const onKeyDown = ( event ) => {
		if ( event.key === 'Escape' && isOpen ) {
			event.preventDefault();
			event.stopPropagation();
			closeNow();
			triggerRef.current?.focus();
		}
	};

	return (
		<>
			<button
				ref={ triggerRef }
				type="button"
				className="cortext-infotip__trigger"
				aria-label={ label }
				aria-expanded={ isOpen }
				aria-describedby={ isOpen ? descriptionId : undefined }
				onMouseEnter={ scheduleOpen }
				onMouseLeave={ scheduleClose }
				onFocus={ openNow }
				onBlur={ closeNow }
				onKeyDown={ onKeyDown }
			>
				<Icon icon={ info } size={ 18 } />
			</button>
			{ isOpen && (
				<Popover
					anchor={ triggerRef.current }
					placement={ placement }
					offset={ 8 }
					shift
					onClose={ closeNow }
					focusOnMount={ false }
					className="cortext-infotip__popup"
					onMouseEnter={ openNow }
					onMouseLeave={ scheduleClose }
				>
					<VisuallyHidden>{ label }</VisuallyHidden>
					<div
						id={ descriptionId }
						className="cortext-infotip__description"
					>
						{ description }
					</div>
				</Popover>
			) }
		</>
	);
}
