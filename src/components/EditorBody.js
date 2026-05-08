/**
 * Shared editor body for Cortext documents (pages and rows). Runs inside
 * an existing `EditorProvider` and renders the block-editor-owned document
 * body: cover -> icon -> locked title -> block content. Owns
 * the trash banner, the identity affordances that
 * live above the title, and the layout effect that keeps the locked
 * header blocks present in `post_content`.
 *
 * Mounted by `Canvas`'s `VisualCanvas` (full-page documents) and by
 * `RowDetailView` (side peek and modal panes), so the editor surface
 * is identical across all three row open modes.
 */

import apiFetch from '@wordpress/api-fetch';
import {
	BlockCanvas,
	BlockList,
	store as blockEditorStore,
	useSettings,
} from '@wordpress/block-editor';
import { createBlock } from '@wordpress/blocks';
import { Button, Disabled, Notice } from '@wordpress/components';
import { useEntityProp } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __ } from '@wordpress/i18n';
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';

import DocumentIdentityControls from './DocumentIdentityControls';
import MediaPicker, { MediaUploadCheck } from './MediaPicker';

const DOCUMENT_ICON_BLOCK = 'cortext/document-icon';
const DOCUMENT_COVER_BLOCK = 'cortext/document-cover';
const POST_TITLE_BLOCK = 'core/post-title';
const LEGACY_HEADER_ACTIONS_BLOCK = 'cortext/page-header-actions';

function DocumentIdentityActions( { postId, postType } ) {
	const isInsertingCoverRef = useRef( false );
	const actionsRef = useRef( null );
	const [ meta ] = useEntityProp( 'postType', postType, 'meta', postId );
	const iconMeta = meta?.cortext_document_icon ?? '';
	const { hasIcon, hasCover, isTrashed, selectedBlockName } = useSelect(
		( select ) => {
			const store = select( blockEditorStore );
			const blocks = store.getBlocks();
			const selectedClientId = store.getSelectedBlockClientId();
			return {
				hasCover: blocks.some(
					( block ) => block.name === DOCUMENT_COVER_BLOCK
				),
				hasIcon: blocks.some(
					( block ) => block.name === DOCUMENT_ICON_BLOCK
				),
				isTrashed:
					select( editorStore ).getCurrentPostAttribute(
						'status'
					) === 'trash',
				selectedBlockName: selectedClientId
					? store.getBlockName( selectedClientId )
					: null,
			};
		},
		[]
	);
	const { insertBlocks } = useDispatch( blockEditorStore );
	const { editEntityRecord, saveEditedEntityRecord } = useDispatch( 'core' );

	useEffect( () => {
		if ( isTrashed || hasCover ) {
			return undefined;
		}
		const node = actionsRef.current;
		const ownerDocument = node?.ownerDocument;
		if ( ! node || ! ownerDocument ) {
			return undefined;
		}
		const focusFirstActionFromTitle = ( event ) => {
			if (
				event.key !== 'Tab' ||
				event.shiftKey ||
				event.defaultPrevented
			) {
				return;
			}
			const target = event.target;
			const targetIsPostTitle =
				target &&
				typeof target.closest === 'function' &&
				target.closest( '[data-type="core/post-title"]' );
			const titleHasFocus = ownerDocument.querySelector(
				'[data-type="core/post-title"]:focus-within'
			);
			if (
				! targetIsPostTitle &&
				! titleHasFocus &&
				selectedBlockName !== POST_TITLE_BLOCK
			) {
				return;
			}
			const firstAction = node.querySelector(
				'.cortext-canvas__identity-action:not(:disabled)'
			);
			if ( ! firstAction ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			firstAction.focus();
		};
		ownerDocument.addEventListener(
			'keydown',
			focusFirstActionFromTitle,
			true
		);
		return () =>
			ownerDocument.removeEventListener(
				'keydown',
				focusFirstActionFromTitle,
				true
			);
	}, [ hasCover, isTrashed, selectedBlockName ] );

	if ( isTrashed || hasCover ) {
		return null;
	}

	const ensureIconBlock = () => {
		if ( hasIcon ) {
			return;
		}
		const block = createBlock( DOCUMENT_ICON_BLOCK, {
			lock: { move: true },
		} );
		insertBlocks( block, 0, undefined, false );
	};

	const insertCover = async ( mediaId ) => {
		if ( hasCover || isInsertingCoverRef.current ) {
			return;
		}
		isInsertingCoverRef.current = true;
		const block = createBlock( DOCUMENT_COVER_BLOCK, {
			align: 'full',
			lock: { move: true },
		} );
		insertBlocks( block, 0, undefined, false );
		try {
			editEntityRecord( 'postType', postType, postId, {
				featured_media: mediaId,
			} );
			await saveEditedEntityRecord( 'postType', postType, postId );
		} finally {
			isInsertingCoverRef.current = false;
		}
	};

	return (
		<div
			ref={ actionsRef }
			className="cortext-canvas__identity-actions"
			role="group"
			aria-label={ __( 'Document identity actions', 'cortext' ) }
		>
			{ ! hasIcon && ! hasCover && (
				<DocumentIdentityControls
					postId={ postId }
					postType={ postType }
					currentIcon={ iconMeta }
					onAfterSave={ ensureIconBlock }
					renderToggle={ ( { onToggle } ) => (
						<Button
							className="cortext-canvas__identity-action"
							variant="tertiary"
							onClick={ onToggle }
						>
							{ __( 'Add icon', 'cortext' ) }
						</Button>
					) }
				/>
			) }
			{ ! hasCover && (
				<MediaUploadCheck>
					<MediaPicker
						allowedTypes={ [ 'image' ] }
						onSelect={ ( media ) => insertCover( media.id ) }
						render={ ( { open } ) => (
							<Button
								className="cortext-canvas__identity-action"
								variant="tertiary"
								onClick={ open }
							>
								{ __( 'Add cover', 'cortext' ) }
							</Button>
						) }
					/>
				</MediaUploadCheck>
			) }
		</div>
	);
}

function EnsureHeaderBlocks( { postId, postType } ) {
	const [ meta ] = useEntityProp( 'postType', postType, 'meta', postId );
	const [ featuredId ] = useEntityProp(
		'postType',
		postType,
		'featured_media',
		postId
	);
	const iconMeta = meta?.cortext_document_icon ?? '';
	const {
		coverIndex,
		hasCover,
		hasIcon,
		hasTitle,
		duplicateHeaderIds,
		legacyActionIds,
		isTrashed,
	} = useSelect( ( select ) => {
		const store = select( blockEditorStore );
		const blocks = store.getBlocks();
		const names = blocks.map( ( block ) => block.name );
		const seenSingletons = new Set();
		const duplicateIds = [];
		blocks.forEach( ( block ) => {
			if (
				block.name !== DOCUMENT_COVER_BLOCK &&
				block.name !== DOCUMENT_ICON_BLOCK &&
				block.name !== POST_TITLE_BLOCK
			) {
				return;
			}
			if ( seenSingletons.has( block.name ) ) {
				duplicateIds.push( block.clientId );
				return;
			}
			seenSingletons.add( block.name );
		} );
		return {
			coverIndex: names.indexOf( DOCUMENT_COVER_BLOCK ),
			hasCover: names.includes( DOCUMENT_COVER_BLOCK ),
			hasIcon: names.includes( DOCUMENT_ICON_BLOCK ),
			hasTitle: names.includes( POST_TITLE_BLOCK ),
			duplicateHeaderIds: duplicateIds,
			legacyActionIds: blocks
				.filter(
					( block ) => block.name === LEGACY_HEADER_ACTIONS_BLOCK
				)
				.map( ( block ) => block.clientId ),
			isTrashed:
				select( editorStore ).getCurrentPostAttribute( 'status' ) ===
				'trash',
		};
	}, [] );
	const {
		insertBlocks,
		removeBlock,
		updateBlockAttributes,
		startTyping,
		stopTyping,
	} = useDispatch( blockEditorStore );

	useLayoutEffect( () => {
		if ( isTrashed ) {
			return;
		}

		[ ...legacyActionIds, ...duplicateHeaderIds ].forEach( ( clientId ) => {
			updateBlockAttributes( clientId, { lock: {} } );
			removeBlock( clientId, false );
		} );
	}, [
		duplicateHeaderIds,
		isTrashed,
		legacyActionIds,
		removeBlock,
		updateBlockAttributes,
	] );

	// useLayoutEffect rather than useEffect: we want the insertion to
	// happen between render and paint so the user never sees the
	// intermediate state where the document has body content but the
	// locked header blocks haven't been added yet.
	//
	// `useMovingAnimation` (the hook that animates blocks when their
	// index changes) skips the animation while `isTyping` is true. Wrap
	// the inserts in a startTyping/stopTyping pair so existing body
	// blocks don't slide downward as the headers land — that animation
	// reads as "the icon is being inserted right now" when really the
	// document is just hydrating.
	useLayoutEffect( () => {
		if ( isTrashed ) {
			return;
		}

		const needsCover = featuredId > 0 && ! hasCover;
		const needsIcon = iconMeta && ! hasIcon;
		const needsTitle = ! hasTitle;
		if ( ! needsCover && ! needsIcon && ! needsTitle ) {
			return;
		}

		startTyping();

		if ( needsCover ) {
			insertBlocks(
				createBlock( DOCUMENT_COVER_BLOCK, {
					align: 'full',
					lock: { move: true },
				} ),
				0,
				undefined,
				false
			);
		}
		if ( needsIcon ) {
			let iconIndex = 0;
			if ( hasCover ) {
				iconIndex = coverIndex + 1;
			} else if ( featuredId > 0 ) {
				iconIndex = 1;
			}
			insertBlocks(
				createBlock( DOCUMENT_ICON_BLOCK, {
					lock: { move: true },
				} ),
				iconIndex,
				undefined,
				false
			);
		}
		if ( needsTitle ) {
			const titleIndex =
				( featuredId > 0 ? 1 : 0 ) + ( iconMeta ? 1 : 0 );
			insertBlocks(
				createBlock( POST_TITLE_BLOCK, {
					lock: { move: true, remove: true },
				} ),
				titleIndex,
				undefined,
				false
			);
		}

		// Release the typing flag on the next frame, after the moving
		// animation has been decided (and skipped) for this render pass.
		const handle = window.requestAnimationFrame( () => stopTyping() );
		return () => window.cancelAnimationFrame( handle );
	}, [
		coverIndex,
		featuredId,
		hasCover,
		hasIcon,
		hasTitle,
		iconMeta,
		insertBlocks,
		isTrashed,
		startTyping,
		stopTyping,
	] );

	return null;
}

function TrashedNotice( { postId, postType, onRestored } ) {
	const [ isRestoring, setIsRestoring ] = useState( false );
	const [ error, setError ] = useState( null );

	const restore = async () => {
		setError( null );
		setIsRestoring( true );
		try {
			const response = await apiFetch( {
				path: `/cortext/v1/documents/${ postId }/restore`,
				method: 'POST',
			} );
			onRestored?.( postId, postType, response );
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not restore document.', 'cortext' )
			);
		} finally {
			setIsRestoring( false );
		}
	};

	return (
		<Notice
			className="cortext-canvas__notice"
			status="warning"
			isDismissible={ false }
			actions={ [
				{
					label: __( 'Restore', 'cortext' ),
					onClick: restore,
					disabled: isRestoring,
					variant: 'primary',
				},
			] }
		>
			{ error ? error : __( 'This document is in trash.', 'cortext' ) }
		</Notice>
	);
}

function CanvasReadyEffect( { postId, onReady } ) {
	useEffect( () => {
		onReady?.( postId );
	}, [ postId, onReady ] );

	return null;
}

export default function EditorBody( {
	postId,
	postType,
	extraStyles,
	onReady,
	onRestored,
} ) {
	const baseStyles = useSelect(
		( select ) => select( editorStore ).getEditorSettings().styles,
		[]
	);
	const styles = extraStyles
		? [ ...( baseStyles ?? [] ), ...extraStyles ]
		: baseStyles;
	const [ layout ] = useSettings( 'layout' );
	const isTrashed = useSelect(
		( select ) =>
			select( editorStore ).getCurrentPostAttribute( 'status' ) ===
			'trash',
		[]
	);

	const blockCanvas = (
		<div className="cortext-canvas__block-canvas">
			<BlockCanvas height="100%" styles={ styles }>
				<DocumentIdentityActions
					postId={ postId }
					postType={ postType }
				/>
				<EnsureHeaderBlocks postId={ postId } postType={ postType } />
				<div className="cortext-canvas__editor">
					<BlockList
						className="wp-block-post-content is-layout-constrained has-global-padding"
						layout={ { type: 'constrained', ...layout } }
					/>
				</div>
				<CanvasReadyEffect postId={ postId } onReady={ onReady } />
			</BlockCanvas>
		</div>
	);

	return (
		<div className="cortext-canvas__visual">
			{ isTrashed && (
				<TrashedNotice
					postId={ postId }
					postType={ postType }
					onRestored={ onRestored }
				/>
			) }
			{ isTrashed ? (
				<Disabled className="cortext-canvas__locked">
					{ blockCanvas }
				</Disabled>
			) : (
				blockCanvas
			) }
		</div>
	);
}
