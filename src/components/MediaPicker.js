import { useCallback } from '@wordpress/element';
import { MediaUploadCheck } from '@wordpress/block-editor';

function readWindowWp( candidate ) {
	try {
		return candidate?.wp ?? null;
	} catch {
		return null;
	}
}

function readWindowParent( candidate ) {
	try {
		return candidate?.parent ?? null;
	} catch {
		return null;
	}
}

// Find the closest window that actually has wp.media. In the block canvas that
// is usually the parent; in Playground it can be the current wp-admin iframe.
export function getHostWp(
	startWindow = typeof window === 'undefined' ? null : window
) {
	let candidate = startWindow;
	const visited = new Set();

	while ( candidate && ! visited.has( candidate ) ) {
		visited.add( candidate );

		const wp = readWindowWp( candidate );
		if ( wp?.media ) {
			return wp;
		}

		const parent = readWindowParent( candidate );
		if ( ! parent || parent === candidate ) {
			break;
		}
		candidate = parent;
	}

	return null;
}

// Drop-in alternative to `<MediaUpload>` from `@wordpress/block-editor`
// for the same use cases (single-select image picker). The render-prop
// API matches: `({ open }) => <Trigger />`. Wrap with our own
// `<MediaUploadCheck>` re-export so callers stay symmetrical. Pass `postId`
// to attach uploads to that document so they count as Cortext media.
export default function MediaPicker( {
	allowedTypes = [ 'image' ],
	value,
	onSelect,
	title,
	render,
	postId,
} ) {
	const open = useCallback( () => {
		const wp = getHostWp();
		const wpMedia = wp?.media;
		if ( ! wpMedia ) {
			return;
		}

		// Parent uploads to the active document so they get stamped as Cortext
		// media; otherwise cover/icon uploads land unattached and never enter
		// the (now Cortext-scoped) picker. Core's uploader reads
		// `wp.media.view.settings.post.id` in its `ready()`, so point it at the
		// document for the frame's lifetime and restore it on close.
		const postSettings = wpMedia.view?.settings?.post;
		const shouldParent = !! ( postSettings && postId );
		const previousPostId = postSettings?.id;
		if ( shouldParent ) {
			postSettings.id = postId;
		}

		const frame = wpMedia( {
			title,
			// Scope the library to media uploaded from Cortext (the
			// `cortext_media` taxonomy term; see Cortext\Media\CortextMedia).
			// The term's query_var survives core's query-attachments whitelist.
			library: { type: allowedTypes, cortext_media: 'cortext' },
			multiple: false,
		} );

		if ( shouldParent ) {
			frame.on( 'close', () => {
				postSettings.id = previousPostId;
			} );
		}

		// wp.media does not reinject a freshly uploaded attachment into a
		// library filtered by a custom taxonomy, so a new upload would only
		// appear after reopening. Re-query the library once the upload queue
		// drains (every upload finished, and the new attachments are stamped
		// server-side by then) so it shows immediately. Listening to `reset`
		// avoids a loop: it fires on upload completion, not on library loads.
		const uploaderQueue = wp?.Uploader?.queue;
		if ( uploaderQueue ) {
			const requery = () => {
				const library = frame.state()?.get?.( 'library' );
				if ( library?.props ) {
					library.props.set( 'ignore', Date.now() );
				}
			};
			uploaderQueue.on( 'reset', requery );
			frame.on( 'close', () => uploaderQueue.off( 'reset', requery ) );
		}

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
	}, [ allowedTypes, value, onSelect, title, postId ] );

	return render( { open } );
}

export { MediaUploadCheck };
