import { useNavigate } from '@tanstack/react-router';
import { Button, Icon } from '@wordpress/components';
import { useCallback, useLayoutEffect, useRef } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { listItem, table } from '@wordpress/icons';

import PageIcon from './PageIcon';
import { SidebarListSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useRecents } from '../hooks/useRecents';

const RECENT_REPOSITION_OPTIONS = {
	duration: 180,
	easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

const RECENT_APPEARANCE_OPTIONS = {
	duration: 140,
	easing: 'ease-out',
};

function recentKey( recent ) {
	return `${ recent.kind }:${ recent.id }`;
}

function shouldAnimateRecents() {
	return (
		typeof window !== 'undefined' &&
		! window.matchMedia?.( '(prefers-reduced-motion: reduce)' )?.matches &&
		typeof window.Element !== 'undefined' &&
		typeof window.Element.prototype.animate === 'function'
	);
}

function collectRects( nodesByKey ) {
	const rects = new Map();
	nodesByKey.forEach( ( node, key ) => {
		rects.set( key, node.getBoundingClientRect() );
	} );
	return rects;
}

function runNodeAnimation( node, keyframes, options ) {
	node.getAnimations?.().forEach( ( animation ) => animation.cancel() );
	node.animate( keyframes, options );
}

function kindLabel( kind ) {
	if ( kind === 'collection' ) {
		return __( 'Collection', 'cortext' );
	}
	if ( kind === 'row' ) {
		return __( 'Row', 'cortext' );
	}
	return __( 'Page', 'cortext' );
}

function recentTitle( recent ) {
	const title = recent?.title?.trim?.() || __( '(untitled)', 'cortext' );
	if ( recent?.kind === 'row' && recent?.collection?.title ) {
		return sprintf(
			/* translators: 1: row title, 2: collection title */
			__( '%1$s in %2$s', 'cortext' ),
			title,
			recent.collection.title
		);
	}
	return title;
}

function recentAriaLabel( recent ) {
	const title = recent?.title?.trim?.() || __( '(untitled)', 'cortext' );
	if ( recent?.kind === 'row' && recent?.collection?.title ) {
		return sprintf(
			/* translators: 1: row title, 2: collection title */
			__( 'Recent row: %1$s in %2$s', 'cortext' ),
			title,
			recent.collection.title
		);
	}
	return sprintf(
		/* translators: 1: recent item type, 2: recent item title */
		__( 'Recent %1$s: %2$s', 'cortext' ),
		kindLabel( recent?.kind ).toLowerCase(),
		title
	);
}

function RecentIcon( { recent } ) {
	if ( recent?.kind === 'page' ) {
		return <PageIcon icon={ recent.icon ?? '' } size={ 16 } />;
	}
	const icon = recent?.kind === 'row' ? listItem : table;
	return <Icon icon={ icon } size={ 16 } />;
}

export default function SidebarRecents() {
	const navigate = useNavigate();
	const { recents, isResolving } = useRecents();
	const recentNodes = useRef( new Map() );
	const previousRects = useRef( new Map() );
	const hasCompletedInitialLoad = useRef( false );
	const setRecentNodeRef = useCallback(
		( key ) => ( node ) => {
			if ( node ) {
				recentNodes.current.set( key, node );
			} else {
				recentNodes.current.delete( key );
			}
		},
		[]
	);

	useLayoutEffect( () => {
		const nextRects = collectRects( recentNodes.current );

		if ( hasCompletedInitialLoad.current && shouldAnimateRecents() ) {
			nextRects.forEach( ( rect, key ) => {
				const node = recentNodes.current.get( key );
				if ( ! node ) {
					return;
				}

				const previousRect = previousRects.current.get( key );
				if ( previousRect ) {
					const deltaY = previousRect.top - rect.top;
					if ( Math.abs( deltaY ) > 0.5 ) {
						runNodeAnimation(
							node,
							[
								{ transform: `translateY(${ deltaY }px)` },
								{ transform: 'translateY(0)' },
							],
							RECENT_REPOSITION_OPTIONS
						);
					}
					return;
				}

				runNodeAnimation(
					node,
					[
						{ opacity: 0, transform: 'translateY(-4px)' },
						{ opacity: 1, transform: 'translateY(0)' },
					],
					RECENT_APPEARANCE_OPTIONS
				);
			} );
		}

		previousRects.current = nextRects;
		if ( ! isResolving ) {
			hasCompletedInitialLoad.current = true;
		}
	}, [ isResolving, recents ] );

	const showSkeleton = useDelayedFlag(
		isResolving && recents.length === 0,
		120,
		SKELETON_MIN_VISIBLE_MS
	);

	return (
		<>
			{ isResolving && recents.length === 0 && showSkeleton && (
				<SidebarListSkeleton itemCount={ 3 } />
			) }
			{ ! isResolving && recents.length === 0 && (
				<p className="cortext-sidebar__empty">
					{ __( 'No recent activity yet.', 'cortext' ) }
				</p>
			) }
			{ recents.length > 0 && (
				<ul className="cortext-sidebar__list cortext-sidebar__recents-list">
					{ recents.map( ( recent ) => {
						const key = recentKey( recent );
						return (
							<li
								key={ key }
								ref={ setRecentNodeRef( key ) }
								className="cortext-sidebar__node cortext-sidebar__recent-node"
							>
								<div className="cortext-sidebar__row">
									<span
										className="cortext-sidebar__recent-icon"
										aria-hidden="true"
									>
										<RecentIcon recent={ recent } />
									</span>
									<Button
										className="cortext-sidebar__title cortext-sidebar__recent-title"
										size="compact"
										variant="tertiary"
										onClick={ ( event ) => {
											event.currentTarget.blur();
											if ( ! recent.path ) {
												return;
											}
											navigate( {
												to: '/$',
												params: {
													_splat: recent.path,
												},
											} );
										} }
										aria-label={ recentAriaLabel( recent ) }
									>
										{ recentTitle( recent ) }
									</Button>
								</div>
							</li>
						);
					} ) }
				</ul>
			) }
		</>
	);
}
