/**
 * Frontend entry point for public Cortext pages.
 *
 * Hydrates interactive DataViews instances into containers rendered by
 * the cortext/data-view block's PHP render callback.
 */
import './frontend.scss';

import { createRoot } from '@wordpress/element';

import PublicDataView from './components/PublicDataView';

document.querySelectorAll( '[data-cortext-data-view]' ).forEach( ( el ) => {
	const script = el.querySelector( '.cortext-dv-init' );
	if ( ! script ) {
		return;
	}

	const init = JSON.parse( script.textContent );
	const root = createRoot( el );
	root.render(
		<PublicDataView
			collectionId={ init.collectionId }
			view={ init.view }
		/>
	);
} );
