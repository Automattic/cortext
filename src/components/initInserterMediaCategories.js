// Register Images, Videos, and Audio for the inserter's Media tab. The editor
// normally gets these from `useBlockEditorSettings`, but Cortext's global
// block-editor store does not have them at runtime, so the tab would show
// "No results". Registering the categories directly is the public API.
//
// Skip Openverse: Cortext should not offer external image sources by default.
import apiFetch from '@wordpress/api-fetch';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { dispatch } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { addQueryArgs } from '@wordpress/url';

function fetchMediaItems( mediaType ) {
	return async ( query = {} ) => {
		const items = await apiFetch( {
			path: addQueryArgs( '/wp/v2/media', {
				...query,
				media_type: mediaType,
				// Scope the tab to media uploaded from Cortext. The server reads
				// this on /wp/v2/media; see Cortext\Media\CortextMedia.
				cortext_origin: 1,
			} ),
		} );
		return items.map( ( item ) => ( {
			...item,
			previewUrl:
				item.media_details?.sizes?.medium?.source_url ??
				item.source_url,
			url: item.source_url,
			alt: item.alt_text,
			caption: item.caption?.raw,
		} ) );
	};
}

export const CORTEXT_INSERTER_MEDIA_CATEGORIES = [
	{
		name: 'images',
		labels: {
			name: __( 'Images', 'cortext' ),
			search_items: __( 'Search images', 'cortext' ),
		},
		mediaType: 'image',
		fetch: fetchMediaItems( 'image' ),
	},
	{
		name: 'videos',
		labels: {
			name: __( 'Videos', 'cortext' ),
			search_items: __( 'Search videos', 'cortext' ),
		},
		mediaType: 'video',
		fetch: fetchMediaItems( 'video' ),
	},
	{
		name: 'audio',
		labels: {
			name: __( 'Audio', 'cortext' ),
			search_items: __( 'Search audio', 'cortext' ),
		},
		mediaType: 'audio',
		fetch: fetchMediaItems( 'audio' ),
	},
];

if ( ! window.__cortextInserterMediaCategoriesRegistered ) {
	const { registerInserterMediaCategory } = dispatch( blockEditorStore );
	CORTEXT_INSERTER_MEDIA_CATEGORIES.forEach( ( category ) =>
		registerInserterMediaCategory( category )
	);
	window.__cortextInserterMediaCategoriesRegistered = true;
}
