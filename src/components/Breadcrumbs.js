import { __ } from '@wordpress/i18n';
import { Fragment } from '@wordpress/element';

import useBreadcrumbSegments from '../hooks/useBreadcrumbSegments';

// Truncate once the bar would carry more than this many segments. A
// four-deep page hierarchy fits unchanged; anything beyond collapses the
// middle into "first / … / parent / current".
const MAX_SEGMENTS = 4;

// Collapses [root, a, b, c, ..., last] down to [root, …, parent, last] when the
// chain gets too long. The ellipsis is non-interactive (no popover in this
// pass) — the issue only asks for overflow protection.
function truncate( segments ) {
	if ( segments.length <= MAX_SEGMENTS ) {
		return segments;
	}
	const first = segments[ 0 ];
	const tail = segments.slice( -2 );
	return [
		first,
		{
			key: 'ellipsis',
			label: '…',
			onClick: null,
			isCurrent: false,
			isEllipsis: true,
		},
		...tail,
	];
}

function Segment( { segment } ) {
	if ( segment.isEllipsis ) {
		return (
			<span className="cortext-breadcrumbs__ellipsis" aria-hidden="true">
				{ segment.label }
			</span>
		);
	}

	if ( segment.isCurrent || ! segment.onClick ) {
		return (
			<span
				className="cortext-breadcrumbs__segment is-current"
				aria-current={ segment.isCurrent ? 'page' : undefined }
			>
				{ segment.label }
			</span>
		);
	}

	return (
		<button
			type="button"
			className="cortext-breadcrumbs__segment"
			onClick={ segment.onClick }
		>
			{ segment.label }
		</button>
	);
}

export default function Breadcrumbs() {
	const segments = truncate( useBreadcrumbSegments() );

	if ( segments.length === 0 ) {
		return null;
	}

	return (
		<nav
			className="cortext-breadcrumbs"
			aria-label={ __( 'Breadcrumb', 'cortext' ) }
		>
			<ol className="cortext-breadcrumbs__list">
				{ segments.map( ( segment, index ) => (
					<Fragment key={ segment.key }>
						{ index > 0 && (
							<li
								className="cortext-breadcrumbs__separator"
								aria-hidden="true"
							>
								/
							</li>
						) }
						<li className="cortext-breadcrumbs__item">
							<Segment segment={ segment } />
						</li>
					</Fragment>
				) ) }
			</ol>
		</nav>
	);
}
