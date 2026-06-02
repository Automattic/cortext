import { readFileSync } from 'fs';
import { join } from 'path';

function keyframeBody( stylesheet, name ) {
	const start = stylesheet.indexOf( `@keyframes ${ name }` );
	if ( start < 0 ) {
		return '';
	}
	const nextKeyframe = stylesheet.indexOf( '@keyframes ', start + 1 );
	const nextMedia = stylesheet.indexOf( '@media ', start + 1 );
	const endCandidates = [ nextKeyframe, nextMedia ].filter(
		( index ) => index > start
	);
	const end =
		endCandidates.length > 0
			? Math.min( ...endCandidates )
			: stylesheet.length;
	return stylesheet.slice( start, end );
}

describe( 'RowDetailView styles', () => {
	it( 'slides the side peek without squeezing the editor', () => {
		const stylesheet = readFileSync(
			join( process.cwd(), 'src/components/RowDetailView.scss' ),
			'utf8'
		);
		const openAnimation = keyframeBody(
			stylesheet,
			'cortext-row-detail-sidebar-open'
		);
		const closeAnimation = keyframeBody(
			stylesheet,
			'cortext-row-detail-sidebar-close'
		);
		const sidebarAnimations = `${ openAnimation }\n${ closeAnimation }`;

		expect( sidebarAnimations ).toContain( 'transform: translateX' );
		expect( sidebarAnimations ).not.toContain( 'width:' );
		expect( sidebarAnimations ).not.toContain( 'flex-basis:' );
	} );
} );
