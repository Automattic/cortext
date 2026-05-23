import { useNavigate } from '@tanstack/react-router';
import { Button } from '@wordpress/components';
import { useCallback, useLayoutEffect, useRef } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import { SidebarListSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useRecents } from '../hooks/useRecents';
import { useDocumentRecord } from '../documents';

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

/**
 * Single row in the recents list. Pulls display copy through
 * `useDocumentRecord` so this component stays kind-blind: the descriptor
 * decides the icon and the type label, and the row formats the title with
 * the collection context when the record carries one (i.e. rows).
 *
 * @param {Object}   props
 * @param {Object}   props.recent     Recent activity record from the server.
 * @param {Function} props.setNodeRef Ref setter used by the FLIP animation.
 * @param {Function} props.onSelect   Navigate to the recent's path.
 */
function SidebarRecentsRow( { recent, setNodeRef, onSelect } ) {
	const { listIcon, kindLabel } = useDocumentRecord( recent );
	const title = recent?.title?.trim?.() || __( '(untitled)', 'cortext' );
	const contextTitle = recent?.collection?.title?.trim?.() ?? '';

	const displayTitle = contextTitle
		? sprintf(
				/* translators: 1: row title, 2: collection title */
				__( '%1$s in %2$s', 'cortext' ),
				title,
				contextTitle
		  )
		: title;

	const ariaLabel = contextTitle
		? sprintf(
				/* translators: 1: row title, 2: collection title */
				__( 'Recent row: %1$s in %2$s', 'cortext' ),
				title,
				contextTitle
		  )
		: sprintf(
				/* translators: 1: recent item type, 2: recent item title */
				__( 'Recent %1$s: %2$s', 'cortext' ),
				kindLabel.toLowerCase(),
				title
		  );

	return (
		<li
			ref={ setNodeRef }
			className="cortext-sidebar__node cortext-sidebar__recent-node"
		>
			<div className="cortext-sidebar__row">
				<span
					className="cortext-sidebar__recent-icon"
					aria-hidden="true"
				>
					{ listIcon?.() }
				</span>
				<Button
					className="cortext-sidebar__title cortext-sidebar__recent-title"
					size="compact"
					variant="tertiary"
					onClick={ ( event ) => {
						event.currentTarget.blur();
						onSelect( recent );
					} }
					aria-label={ ariaLabel }
				>
					{ displayTitle }
				</Button>
			</div>
		</li>
	);
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

	const onSelectRecent = useCallback(
		( recent ) => {
			if ( ! recent.path ) {
				return;
			}
			navigate( {
				to: '/$',
				params: { _splat: recent.path },
			} );
		},
		[ navigate ]
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
							<SidebarRecentsRow
								key={ key }
								recent={ recent }
								setNodeRef={ setRecentNodeRef( key ) }
								onSelect={ onSelectRecent }
							/>
						);
					} ) }
				</ul>
			) }
		</>
	);
}
