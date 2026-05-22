export default function afterNextPaint( ownerWindow ) {
	const win =
		ownerWindow ?? ( typeof window !== 'undefined' ? window : globalThis );
	const requestFrame = win.requestAnimationFrame?.bind( win );
	const delay = win.setTimeout?.bind( win ) ?? setTimeout;

	return new Promise( ( resolve ) => {
		if ( ! requestFrame ) {
			delay( resolve, 0 );
			return;
		}

		requestFrame( () => {
			requestFrame( () => {
				delay( resolve, 0 );
			} );
		} );
	} );
}
