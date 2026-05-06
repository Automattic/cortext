import { useCallback } from '@wordpress/element';
import { MediaUploadCheck } from '@wordpress/block-editor';

// Resolves to the wp.media (Backbone media library) instance available in
// the host document. From inside the BlockCanvas iframe `window.wp.media`
// is undefined — `wp_enqueue_media()` only enqueues media-views into the
// parent — so we walk up to `window.parent` when needed. Returns null when
// the host hasn't loaded media-views (e.g., the screen called this without
// `wp_enqueue_media()`); callers should treat the trigger as a no-op.
function getHostWpMedia() {
	if ( typeof window === 'undefined' ) {
		return null;
	}
	const host =
		window.parent && window.parent !== window ? window.parent : window;
	return host?.wp?.media ?? null;
}

// Drop-in alternative to `<MediaUpload>` from `@wordpress/block-editor`
// for the same use cases (single-select image picker). The render-prop
// API matches: `({ open }) => <Trigger />`. Wrap with our own
// `<MediaUploadCheck>` re-export so callers stay symmetrical.
export default function MediaPicker( {
	allowedTypes = [ 'image' ],
	value,
	onSelect,
	title,
	render,
} ) {
	const open = useCallback( () => {
		const wpMedia = getHostWpMedia();
		if ( ! wpMedia ) {
			return;
		}

		const frame = wpMedia( {
			title,
			library: { type: allowedTypes },
			multiple: false,
		} );

		// Pre-select the current attachment so the modal opens with it
		// highlighted, mirroring core's MediaUpload behavior.
		if ( value ) {
			frame.on( 'open', () => {
				const selection = frame.state().get( 'selection' );
				const attachment = wpMedia.attachment( value );
				attachment.fetch();
				selection.add( attachment ? [ attachment ] : [] );
			} );
		}

		frame.on( 'select', () => {
			const picked = frame.state().get( 'selection' ).first()?.toJSON();
			if ( picked ) {
				onSelect( picked );
			}
		} );

		frame.open();
	}, [ allowedTypes, value, onSelect, title ] );

	return render( { open } );
}

export { MediaUploadCheck };
