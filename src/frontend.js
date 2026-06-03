/**
 * Frontend entry point for public Cortext pages.
 *
 * Hydrates interactive DataViews instances into containers rendered by the
 * cortext/data-view block's PHP render callback, and fills WordPress-icon
 * document glyphs that PHP can't render server-side.
 */
import './frontend.scss';

import { createRoot } from '@wordpress/element';

import PublicDataView, {
	PublicDataViewErrorBoundary,
	PublicDataViewErrorFallback,
} from './components/PublicDataView';

// The document-icon block's `wp` variant emits an empty marker because
// @wordpress/icons is JS-only. Render the glyph into each marker; the color
// rides on the span's inline style (the glyph uses currentColor). The icon
// namespace is heavy, so load it only when a page actually has a wp glyph.
const wpIconMarkers = document.querySelectorAll(
	'.cortext-document-icon--wp[data-icon]'
);
if ( wpIconMarkers.length ) {
	import(
		/* webpackChunkName: "document-icon-wp" */ './components/DocumentIconWp'
	).then( ( { default: DocumentIconWp } ) => {
		wpIconMarkers.forEach( ( el ) => {
			const name = el.getAttribute( 'data-icon' );
			if ( ! name ) {
				return;
			}
			createRoot( el ).render(
				<DocumentIconWp name={ name } size={ 44 } />
			);
		} );
	} );
}

document.querySelectorAll( '[data-cortext-data-view]' ).forEach( ( el ) => {
	const script = el.querySelector( '.cortext-dv-init' );
	if ( ! script ) {
		return;
	}

	const root = createRoot( el );
	let init;
	try {
		init = JSON.parse( script.textContent );
	} catch {
		root.render( <PublicDataViewErrorFallback /> );
		return;
	}

	root.render(
		<PublicDataViewErrorBoundary>
			<PublicDataView
				collectionId={ init.collectionId }
				view={ init.view }
			/>
		</PublicDataViewErrorBoundary>
	);
} );
