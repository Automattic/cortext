import { useNavigate } from '@tanstack/react-router';
import { Button } from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useCallback, useLayoutEffect, useRef } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import { SidebarListSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useRecents } from '../hooks/useRecents';
import { useDocumentRecord } from '../documents';
import { DOCUMENT_POST_TYPE } from '../collections';
import { definesTrait } from '../documents/capabilities';

const RECENT_REPOSITION_OPTIONS = {
	duration: 180,
	easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

const RECENT_APPEARANCE_OPTIONS = {
	duration: 140,
	easing: 'ease-out',
};

function recentKey( recent ) {
	return `recent:${ recent.id }`;
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

function recentTitle( recent ) {
	return recent?.title?.trim?.() || __( '(untitled)', 'cortext' );
}

function recentContextTitle( recent ) {
	return recent?.collection?.title?.trim?.() ?? '';
}

function recentDisplayTitle( recent ) {
	const title = recentTitle( recent );
	const contextTitle = recentContextTitle( recent );
	return contextTitle
		? sprintf(
				/* translators: 1: document title, 2: collection title */
				__( '%1$s in %2$s', 'cortext' ),
				title,
				contextTitle
		  )
		: title;
}

/**
 * One item in Recents. The descriptor supplies the icon; this row only adds
 * collection context when it helps distinguish matching document titles.
 *
 * @param {Object}   props
 * @param {Object}   props.recent           Recent activity record from the server.
 * @param {boolean}  props.isDuplicateLabel Whether another recent has the same display label.
 * @param {Function} props.setNodeRef       Ref setter used by the FLIP animation.
 * @param {Function} props.onSelect         Navigate to the recent's path.
 */
function SidebarRecentsRow( {
	recent,
	isDuplicateLabel,
	setNodeRef,
	onSelect,
} ) {
	// Recents wire shape only carries id/title/path/icon (and optional row
	// context). Capability checks need `meta.cortext_fields` / `crtxt_trait`,
	// so we load the document record at render time and merge it with the
	// snapshot. Already-loaded records hit the core-data cache instantly.
	const { record } = useEntityRecord(
		'postType',
		DOCUMENT_POST_TYPE,
		recent.id || 0
	);
	const merged = record ? { ...recent, ...record } : recent;
	const { listIcon } = useDocumentRecord( merged );
	const displayTitle = recentDisplayTitle( recent );
	const duplicateContext = definesTrait( merged )
		? __( 'contains rows', 'cortext' )
		: __( 'plain document', 'cortext' );

	const ariaLabel = isDuplicateLabel
		? sprintf(
				/* translators: 1: recent title, 2: context for duplicate recent titles */
				__( 'Recent: %1$s, %2$s', 'cortext' ),
				displayTitle,
				duplicateContext
		  )
		: sprintf(
				/* translators: %s: recent title */
				__( 'Recent: %s', 'cortext' ),
				displayTitle
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
	const labelCounts = new Map();
	recents.forEach( ( recent ) => {
		const label = recentDisplayTitle( recent );
		labelCounts.set( label, ( labelCounts.get( label ) ?? 0 ) + 1 );
	} );
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
								isDuplicateLabel={
									( labelCounts.get(
										recentDisplayTitle( recent )
									) ?? 0 ) > 1
								}
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
