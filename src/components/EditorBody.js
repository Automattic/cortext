/**
 * Shared editor body for Cortext documents (pages, collections, and rows). Runs inside
 * an existing `EditorProvider` and renders the block-editor-owned document
 * body: cover -> icon -> locked title -> block content. Owns the trash banner,
 * the identity controls above the title, and the layout effect that keeps the
 * locked header blocks present in `post_content`.
 *
 * Mounted by `Canvas`'s `VisualCanvas` for full-page documents and by
 * `RowDetailView` for side peek and modal panes.
 */

import apiFetch from '@wordpress/api-fetch';
import {
	BlockCanvas,
	BlockList,
	Inserter,
	store as blockEditorStore,
	useSettings,
} from '@wordpress/block-editor';
import { createBlock } from '@wordpress/blocks';
import { Button, Disabled, Notice } from '@wordpress/components';
import { useEntityProp, useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __ } from '@wordpress/i18n';
import { ENTER, SPACE } from '@wordpress/keycodes';
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';

import DocumentIdentityControls from './DocumentIdentityControls';
import { useDocumentPropertiesContext } from './DocumentPropertiesContext';
import {
	findCanvasOwnerBlock,
	getCanvasOwnerBlockName,
	getCanvasOwnerInitialAttributes,
} from './CanvasOwnerInspector';
import MediaPicker, { MediaUploadCheck } from './MediaPicker';
import afterNextPaint from '../hooks/afterNextPaint';

const DOCUMENT_ICON_BLOCK = 'cortext/document-icon';
const DOCUMENT_COVER_BLOCK = 'cortext/document-cover';
const DOCUMENT_PROPERTIES_BLOCK = 'cortext/document-properties';
const POST_TITLE_BLOCK = 'core/post-title';
const ROOT_BLOCK_LIST = '';
const DISABLE_HEADER_BOUNDARY_MOVE_UP_CLASS =
	'cortext-disable-header-boundary-move-up';
const DISABLED_BY_HEADER_BOUNDARY_ATTR =
	'data-cortext-header-boundary-disabled';
const HEADER_BOUNDARY_MOVE_UP_SELECTOR =
	'.block-editor-block-mover-button.is-up-button';
const HEADER_BOUNDARY_MOVE_UP_SCOPE_SELECTOR = [
	'.block-editor-block-list__block-popover',
	'.block-editor-block-contextual-toolbar',
	'.block-editor-block-toolbar',
].join( ',' );
const activeHeaderBoundaryMoveUpGuards = new Set();
const DEFAULT_HEADER_BLOCK_NAMES = new Set( [
	DOCUMENT_COVER_BLOCK,
	DOCUMENT_ICON_BLOCK,
	POST_TITLE_BLOCK,
	DOCUMENT_PROPERTIES_BLOCK,
] );
const CANVAS_READY_IMAGE_TIMEOUT = 8000;

// Some post types add an owner block to the reserved header/body prefix.
function getHeaderBlockNames( postType ) {
	const ownerName = getCanvasOwnerBlockName( postType );
	if ( ! ownerName ) {
		return DEFAULT_HEADER_BLOCK_NAMES;
	}
	return new Set( [ ...DEFAULT_HEADER_BLOCK_NAMES, ownerName ] );
}

function isHeaderBlock( block, postType ) {
	return getHeaderBlockNames( postType ).has( block?.name );
}

function isHeaderChromeBlock( block, postType ) {
	return isHeaderBlock( block, postType );
}

function syncHeaderBoundaryMoveUpClass() {
	document.body.classList.toggle(
		DISABLE_HEADER_BOUNDARY_MOVE_UP_CLASS,
		activeHeaderBoundaryMoveUpGuards.size > 0
	);
}

function getHeaderBoundaryMoveUpScopes( root ) {
	if ( ! root ) {
		return [];
	}

	const scopes = [
		...( root.matches?.( HEADER_BOUNDARY_MOVE_UP_SCOPE_SELECTOR )
			? [ root ]
			: [] ),
		...root.querySelectorAll( HEADER_BOUNDARY_MOVE_UP_SCOPE_SELECTOR ),
	];
	return scopes.length > 0 ? scopes : [ root ];
}

function syncHeaderBoundaryMoveUpButtons( root, shouldDisable ) {
	// tech-debt.md#56: Gutenberg does not expose boundary-aware mover state.
	const ownerWindow = root?.ownerDocument?.defaultView ?? window;
	getHeaderBoundaryMoveUpScopes( root ).forEach( ( scope ) => {
		scope
			.querySelectorAll( HEADER_BOUNDARY_MOVE_UP_SELECTOR )
			.forEach( ( button ) => {
				if ( ! ( button instanceof ownerWindow.HTMLButtonElement ) ) {
					return;
				}

				if ( shouldDisable ) {
					if (
						! button.hasAttribute(
							DISABLED_BY_HEADER_BOUNDARY_ATTR
						)
					) {
						button.setAttribute(
							DISABLED_BY_HEADER_BOUNDARY_ATTR,
							'true'
						);
						button.dataset.cortextPreviousDisabled = button.disabled
							? 'true'
							: 'false';
						const previousAriaDisabled =
							button.getAttribute( 'aria-disabled' );
						if ( previousAriaDisabled !== null ) {
							button.dataset.cortextPreviousAriaDisabled =
								previousAriaDisabled;
						} else {
							delete button.dataset.cortextPreviousAriaDisabled;
						}
					}

					button.disabled = true;
					button.setAttribute( 'aria-disabled', 'true' );
					return;
				}

				if (
					! button.hasAttribute( DISABLED_BY_HEADER_BOUNDARY_ATTR )
				) {
					return;
				}

				button.disabled =
					button.dataset.cortextPreviousDisabled === 'true';
				if (
					Object.prototype.hasOwnProperty.call(
						button.dataset,
						'cortextPreviousAriaDisabled'
					)
				) {
					button.setAttribute(
						'aria-disabled',
						button.dataset.cortextPreviousAriaDisabled
					);
				} else {
					button.removeAttribute( 'aria-disabled' );
				}
				button.removeAttribute( DISABLED_BY_HEADER_BOUNDARY_ATTR );
				delete button.dataset.cortextPreviousDisabled;
				delete button.dataset.cortextPreviousAriaDisabled;
			} );
	} );
}

function syncHeaderBoundaryMoveUpState( root, shouldDisable ) {
	syncHeaderBoundaryMoveUpClass();
	syncHeaderBoundaryMoveUpButtons( root, shouldDisable );
}

function HeaderPrefixToolbarGuard( {
	isActive = true,
	postType,
	toolbarRootRef,
} ) {
	const guardId = useRef( Symbol( DISABLE_HEADER_BOUNDARY_MOVE_UP_CLASS ) );
	const shouldDisableMoveUp = useSelect(
		( select ) => {
			if ( ! isActive ) {
				return false;
			}
			const store = select( blockEditorStore );
			const blocks = store.getBlocks();
			const selectedClientIds = store.getSelectedBlockClientIds();
			const titleIndex = blocks.findIndex(
				( block ) => block.name === POST_TITLE_BLOCK
			);
			if ( titleIndex < 0 || selectedClientIds.length === 0 ) {
				return false;
			}

			const firstBodyIndex = blocks.findIndex(
				( block, index ) =>
					index > titleIndex && ! isHeaderBlock( block, postType )
			);
			if ( firstBodyIndex < 0 ) {
				return false;
			}

			const rootBlockIndexes = new Map(
				blocks.map( ( block, index ) => [ block.clientId, index ] )
			);
			const selectedRootIndexes = selectedClientIds
				.map( ( clientId ) => rootBlockIndexes.get( clientId ) )
				.filter( ( index ) => typeof index === 'number' );
			if ( selectedRootIndexes.length === 0 ) {
				return false;
			}

			return Math.min( ...selectedRootIndexes ) === firstBodyIndex;
		},
		[ isActive, postType ]
	);

	useEffect( () => {
		const currentGuardId = guardId.current;
		const toolbarRoot = toolbarRootRef?.current;
		if ( shouldDisableMoveUp ) {
			activeHeaderBoundaryMoveUpGuards.add( currentGuardId );
		} else {
			activeHeaderBoundaryMoveUpGuards.delete( currentGuardId );
		}
		syncHeaderBoundaryMoveUpState( toolbarRoot, shouldDisableMoveUp );
		const observer = new window.MutationObserver( () =>
			syncHeaderBoundaryMoveUpButtons( toolbarRoot, shouldDisableMoveUp )
		);
		if ( shouldDisableMoveUp && toolbarRoot ) {
			observer.observe( toolbarRoot, {
				childList: true,
				subtree: true,
			} );
		}
		return () => {
			observer.disconnect();
			activeHeaderBoundaryMoveUpGuards.delete( currentGuardId );
			syncHeaderBoundaryMoveUpState( toolbarRoot, false );
		};
	}, [ shouldDisableMoveUp, toolbarRootRef ] );

	return null;
}

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
	const propertiesCtx = useDocumentPropertiesContext();
	// During a Canvas document switch, the provider can move to the next row
	// before the editor does. Treat that moment as "schema unknown" so the
	// header sync does not edit the outgoing post.
	const propertiesContextStable = ! propertiesCtx?.isResolving;
	const hasSchema =
		propertiesContextStable &&
		Array.isArray( propertiesCtx?.fields ) &&
		propertiesCtx.fields.length > 0;
	const ownerBlockName = getCanvasOwnerBlockName( postType );
	const {
		coverIndex,
		titleIndex,
		hasCover,
		hasIcon,
		hasTitle,
		hasProperties,
		hasOwner,
		propertiesClientId,
		headerEndIndex,
		bodyBlockBeforeTitleId,
		shouldHideHeaderInsertionPoint,
		duplicateHeaderIds,
		isTrashed,
	} = useSelect(
		( select ) => {
			const store = select( blockEditorStore );
			const blocks = store.getBlocks();
			const names = blocks.map( ( block ) => block.name );
			const currentTitleIndex = names.indexOf( POST_TITLE_BLOCK );
			const currentPropertiesIndex = names.indexOf(
				DOCUMENT_PROPERTIES_BLOCK
			);
			const currentOwnerIndex = ownerBlockName
				? names.indexOf( ownerBlockName )
				: -1;
			// The protected prefix ends at the last installed header block:
			// cover, icon, title, properties, or the owner block. max() keeps
			// strange legacy order from shrinking that boundary.
			const currentHeaderEndIndex = Math.max(
				currentTitleIndex,
				currentPropertiesIndex,
				currentOwnerIndex
			);
			let currentBodyBlockBeforeTitleId = null;
			if ( currentHeaderEndIndex > -1 ) {
				for (
					let index = currentHeaderEndIndex - 1;
					index >= 0;
					index--
				) {
					const block = blocks[ index ];
					if ( isHeaderBlock( block, postType ) ) {
						continue;
					}
					currentBodyBlockBeforeTitleId = block.clientId;
					break;
				}
			}
			const insertionPoint = store.getBlockInsertionPoint();
			const insertionPointRootClientId =
				insertionPoint?.rootClientId ?? ROOT_BLOCK_LIST;
			const insertionPointIndex =
				insertionPoint?.index ?? Number.POSITIVE_INFINITY;
			const seenSingletons = new Set();
			const duplicateIds = [];
			blocks.forEach( ( block ) => {
				if (
					block.name !== DOCUMENT_COVER_BLOCK &&
					block.name !== DOCUMENT_ICON_BLOCK &&
					block.name !== POST_TITLE_BLOCK &&
					block.name !== DOCUMENT_PROPERTIES_BLOCK
				) {
					return;
				}
				if ( seenSingletons.has( block.name ) ) {
					duplicateIds.push( block.clientId );
					return;
				}
				seenSingletons.add( block.name );
			} );
			// The owner block is keyed on attribute match, not just name, so
			// a foreign data-view (pointing at another collection) isn't a
			// duplicate of the self-referencing owner. If we name-deduped
			// here, the dedup pass would drop the owner whenever a foreign
			// data-view came first and the insertion pass would re-add it
			// on the next render, leaving the document dirty forever.
			if ( ownerBlockName ) {
				let ownerSeen = false;
				blocks.forEach( ( block ) => {
					if ( block.name !== ownerBlockName ) {
						return;
					}
					const attrId = Number( block.attributes?.collectionId );
					if ( attrId !== Number( postId ) ) {
						return;
					}
					if ( ownerSeen ) {
						duplicateIds.push( block.clientId );
						return;
					}
					ownerSeen = true;
				} );
			}
			const propertiesBlock = blocks.find(
				( block ) => block.name === DOCUMENT_PROPERTIES_BLOCK
			);
			return {
				coverIndex: names.indexOf( DOCUMENT_COVER_BLOCK ),
				titleIndex: currentTitleIndex,
				hasCover: names.includes( DOCUMENT_COVER_BLOCK ),
				hasIcon: names.includes( DOCUMENT_ICON_BLOCK ),
				hasTitle: names.includes( POST_TITLE_BLOCK ),
				hasProperties: !! propertiesBlock,
				hasOwner: ownerBlockName
					? !! findCanvasOwnerBlock( blocks, postType, postId )
					: true,
				propertiesClientId: propertiesBlock?.clientId ?? null,
				headerEndIndex: currentHeaderEndIndex,
				bodyBlockBeforeTitleId: currentBodyBlockBeforeTitleId,
				shouldHideHeaderInsertionPoint:
					store.isBlockInsertionPointVisible() &&
					currentHeaderEndIndex > -1 &&
					insertionPointRootClientId === ROOT_BLOCK_LIST &&
					insertionPointIndex <= currentHeaderEndIndex,
				duplicateHeaderIds: duplicateIds,
				isTrashed:
					select( editorStore ).getCurrentPostAttribute(
						'status'
					) === 'trash',
			};
		},
		[ ownerBlockName, postId, postType ]
	);
	const {
		insertBlocks,
		moveBlocksToPosition,
		removeBlock,
		hideInsertionPoint,
		updateBlockAttributes,
		startTyping,
		stopTyping,
	} = useDispatch( blockEditorStore );

	useLayoutEffect( () => {
		if ( isTrashed ) {
			return;
		}

		duplicateHeaderIds.forEach( ( clientId ) => {
			updateBlockAttributes( clientId, { lock: {} } );
			removeBlock( clientId, false );
		} );

		// Keep the properties block only on rows whose collection has fields.
		// If schema disappears, remove the block so post_content does not keep
		// an empty marker. Skip this while the provider is switching rows.
		if (
			propertiesContextStable &&
			hasProperties &&
			! hasSchema &&
			propertiesClientId
		) {
			updateBlockAttributes( propertiesClientId, { lock: {} } );
			removeBlock( propertiesClientId, false );
		}
	}, [
		duplicateHeaderIds,
		hasProperties,
		hasSchema,
		isTrashed,
		propertiesClientId,
		propertiesContextStable,
		removeBlock,
		updateBlockAttributes,
	] );

	useLayoutEffect( () => {
		if ( isTrashed || ! shouldHideHeaderInsertionPoint ) {
			return;
		}
		hideInsertionPoint();
	}, [ hideInsertionPoint, isTrashed, shouldHideHeaderInsertionPoint ] );

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
		const needsProperties = hasSchema && ! hasProperties;
		const needsOwner = !! ownerBlockName && ! hasOwner;
		if (
			! needsCover &&
			! needsIcon &&
			! needsTitle &&
			! needsProperties &&
			! needsOwner
		) {
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
		const computedTitleIndex =
			( featuredId > 0 ? 1 : 0 ) + ( iconMeta ? 1 : 0 );
		if ( needsTitle ) {
			insertBlocks(
				createBlock( POST_TITLE_BLOCK, {
					lock: { move: true, remove: true },
				} ),
				computedTitleIndex,
				undefined,
				false
			);
		}
		if ( needsProperties ) {
			// The properties block sits directly after the title. Legacy rows
			// can still have body blocks before the title, so the canonical
			// index would put properties before that misplaced title. Anchor on
			// the snapshot `titleIndex`, shifted by any cover/icon inserted
			// above it. If this pass also inserts the title, the snapshot cannot
			// help yet, so use the canonical index.
			const anchorTitleIndex = needsTitle
				? computedTitleIndex
				: titleIndex + ( needsCover ? 1 : 0 ) + ( needsIcon ? 1 : 0 );
			insertBlocks(
				createBlock( DOCUMENT_PROPERTIES_BLOCK, {
					lock: { move: true, remove: true },
				} ),
				anchorTitleIndex + 1,
				undefined,
				false
			);
		}
		if ( needsOwner ) {
			// The owner block is the body. Add it last so it follows any
			// header repairs made in this pass.
			const ownerAttributes = getCanvasOwnerInitialAttributes(
				postType,
				postId
			);
			insertBlocks(
				createBlock( ownerBlockName, ownerAttributes ?? {} ),
				undefined,
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
		hasOwner,
		hasProperties,
		hasSchema,
		hasTitle,
		iconMeta,
		insertBlocks,
		isTrashed,
		ownerBlockName,
		postId,
		postType,
		startTyping,
		stopTyping,
		titleIndex,
	] );

	useLayoutEffect( () => {
		if (
			isTrashed ||
			! bodyBlockBeforeTitleId ||
			headerEndIndex < 0 ||
			duplicateHeaderIds.length > 0 ||
			( featuredId > 0 && ! hasCover ) ||
			( iconMeta && ! hasIcon ) ||
			! hasTitle ||
			( hasSchema && ! hasProperties )
		) {
			return;
		}

		startTyping();
		moveBlocksToPosition(
			[ bodyBlockBeforeTitleId ],
			ROOT_BLOCK_LIST,
			ROOT_BLOCK_LIST,
			headerEndIndex
		);

		const handle = window.requestAnimationFrame( () => stopTyping() );
		return () => window.cancelAnimationFrame( handle );
	}, [
		bodyBlockBeforeTitleId,
		duplicateHeaderIds.length,
		featuredId,
		hasCover,
		hasIcon,
		hasProperties,
		hasSchema,
		hasTitle,
		headerEndIndex,
		iconMeta,
		isTrashed,
		moveBlocksToPosition,
		startTyping,
		stopTyping,
	] );

	return null;
}

// Hide core's block settings menu while a locked header block is selected.
// Those menu items do not fit fixed singleton blocks, and core does not expose
// a per-block filter. The toolbar and iframe live in separate documents, so a
// body class is the simplest hook for CSS. Mounting this here keeps Canvas and
// RowEditor on the same path.
function HideHeaderBlockKebab( { postType } ) {
	const ownerBlockName = getCanvasOwnerBlockName( postType );
	const selectedName = useSelect( ( select ) => {
		const store = select( blockEditorStore );
		const clientId = store.getSelectedBlockClientId();
		return clientId ? store.getBlockName( clientId ) : null;
	}, [] );

	useEffect( () => {
		const isHeader =
			selectedName === DOCUMENT_COVER_BLOCK ||
			selectedName === DOCUMENT_ICON_BLOCK ||
			selectedName === DOCUMENT_PROPERTIES_BLOCK ||
			( !! ownerBlockName && selectedName === ownerBlockName );
		document.body.classList.toggle(
			'cortext-hide-block-settings-menu',
			isHeader
		);
		return () => {
			document.body.classList.remove(
				'cortext-hide-block-settings-menu'
			);
		};
	}, [ ownerBlockName, selectedName ] );

	return null;
}

function HeaderAwareRootAppender( { postType } ) {
	// tech-debt.md#56: Gutenberg's root appender only treats a fully empty
	// root list as empty. Cortext's locked header blocks are chrome, so the
	// body still needs a first-block prompt after them.
	const { bodyEmpty, insertionIndex } = useSelect(
		( select ) => {
			const blocks = select( blockEditorStore ).getBlocks();
			const headerEndIndex = blocks.reduce(
				( lastIndex, block, index ) =>
					isHeaderChromeBlock( block, postType ) ? index : lastIndex,
				-1
			);
			return {
				bodyEmpty:
					blocks.length > 0 &&
					blocks.every( ( block ) =>
						isHeaderChromeBlock( block, postType )
					),
				insertionIndex: headerEndIndex + 1,
			};
		},
		[ postType ]
	);
	const { insertDefaultBlock, startTyping } = useDispatch( blockEditorStore );

	if ( ! bodyEmpty ) {
		return null;
	}

	const onAppend = () => {
		insertDefaultBlock( undefined, ROOT_BLOCK_LIST, insertionIndex );
		startTyping();
	};

	return (
		<div className="block-editor-default-block-appender has-visible-prompt">
			<p
				tabIndex="0"
				// Match core's default appender semantics so focusing the
				// prompt immediately creates the first editable body block.
				// eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
				role="button"
				aria-label={ __( 'Add default block', 'cortext' ) }
				className="block-editor-default-block-appender__content"
				onKeyDown={ ( event ) => {
					if ( ENTER === event.keyCode || SPACE === event.keyCode ) {
						onAppend();
					}
				} }
				onClick={ onAppend }
				onFocus={ onAppend }
			>
				{ __( 'Type / to choose a block', 'cortext' ) }
			</p>
			<Inserter
				rootClientId={ ROOT_BLOCK_LIST }
				position="bottom right"
				isAppender
				__experimentalIsQuick
			/>
		</div>
	);
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

function coverSource( media ) {
	return (
		media?.media_details?.sizes?.large?.source_url ??
		media?.source_url ??
		null
	);
}

function waitForImageReady( image ) {
	const ownerWindow = image.ownerDocument?.defaultView ?? window;
	const isLoaded = image.complete && image.naturalWidth > 0;
	const waitForLoad = isLoaded
		? Promise.resolve()
		: new Promise( ( resolve ) => {
				const cleanup = () => {
					ownerWindow.clearTimeout( timeoutId );
					image.removeEventListener( 'load', cleanup );
					image.removeEventListener( 'error', cleanup );
					resolve();
				};
				const timeoutId = ownerWindow.setTimeout(
					cleanup,
					CANVAS_READY_IMAGE_TIMEOUT
				);
				image.addEventListener( 'load', cleanup, { once: true } );
				image.addEventListener( 'error', cleanup, { once: true } );
		  } );

	return waitForLoad.then( () => image.decode?.().catch( () => {} ) );
}

function imageMatchesSource( image, expectedSource ) {
	if ( ! expectedSource ) {
		return true;
	}
	return (
		image.currentSrc === expectedSource ||
		image.src === expectedSource ||
		image.getAttribute( 'src' ) === expectedSource
	);
}

function findCoverImage( ownerDocument, expectedSource ) {
	const images = [
		...ownerDocument.querySelectorAll(
			'.cortext-document-cover-block__image'
		),
	];
	if ( expectedSource ) {
		return (
			images.find( ( image ) =>
				imageMatchesSource( image, expectedSource )
			) ?? null
		);
	}
	return images[ 0 ] ?? null;
}

function waitForCoverImageNode( ownerDocument, expectedSource ) {
	const existing = findCoverImage( ownerDocument, expectedSource );
	if ( existing ) {
		return Promise.resolve( existing );
	}
	const ownerWindow = ownerDocument.defaultView ?? window;
	const MutationObserver = ownerWindow.MutationObserver;
	if ( ! MutationObserver ) {
		return Promise.resolve( null );
	}
	return new Promise( ( resolve ) => {
		const cleanup = ( image = null ) => {
			ownerWindow.clearTimeout( timeoutId );
			observer.disconnect();
			resolve( image );
		};
		const observer = new MutationObserver( () => {
			const image = findCoverImage( ownerDocument, expectedSource );
			if ( image ) {
				cleanup( image );
			}
		} );
		const timeoutId = ownerWindow.setTimeout(
			() => cleanup(),
			CANVAS_READY_IMAGE_TIMEOUT
		);
		observer.observe( ownerDocument.documentElement, {
			attributeFilter: [ 'src' ],
			attributes: true,
			childList: true,
			subtree: true,
		} );
	} );
}

async function waitForCriticalImages( canvasRoot, expectedCoverSource ) {
	const iframe = canvasRoot?.querySelector( 'iframe' );
	const ownerDocument = iframe?.contentDocument ?? canvasRoot?.ownerDocument;
	if ( ! ownerDocument ) {
		return;
	}
	const coverImage = await waitForCoverImageNode(
		ownerDocument,
		expectedCoverSource
	);
	if ( coverImage ) {
		await waitForImageReady( coverImage );
	}
}

function CanvasReadyEffect( {
	featuredMedia,
	postId,
	postType,
	canvasRootRef,
	onReady,
} ) {
	const [ featuredId ] = useEntityProp(
		'postType',
		postType,
		'featured_media',
		postId
	);
	const [ meta ] = useEntityProp( 'postType', postType, 'meta', postId );
	const numericFeaturedId = Number( featuredId ?? featuredMedia ) || 0;
	const needsCover = numericFeaturedId > 0;
	const needsIcon = Boolean( meta?.cortext_document_icon );
	const {
		record: coverMedia,
		isResolving: isResolvingCoverMedia,
		hasResolved: hasResolvedCoverMedia,
	} = useEntityRecord( 'root', 'media', numericFeaturedId, {
		enabled: needsCover,
	} );
	const src = coverSource( coverMedia );
	const { hasCover, hasIcon, hasTitle } = useSelect( ( select ) => {
		const blocks = select( blockEditorStore ).getBlocks();
		return {
			hasCover: blocks.some(
				( block ) => block.name === DOCUMENT_COVER_BLOCK
			),
			hasIcon: blocks.some(
				( block ) => block.name === DOCUMENT_ICON_BLOCK
			),
			hasTitle: blocks.some(
				( block ) => block.name === POST_TITLE_BLOCK
			),
		};
	}, [] );
	const isCoverRecordReady =
		! needsCover ||
		Boolean( src ) ||
		( ! isResolvingCoverMedia && hasResolvedCoverMedia );
	const areHeaderBlocksReady =
		hasTitle &&
		( ! needsCover || hasCover ) &&
		( ! needsIcon || hasIcon ) &&
		isCoverRecordReady;

	useLayoutEffect( () => {
		if ( ! areHeaderBlocksReady ) {
			return undefined;
		}

		let cancelled = false;
		async function signalReady() {
			if ( needsCover && src ) {
				await waitForCriticalImages( canvasRootRef.current, src );
			}
			await afterNextPaint(
				canvasRootRef.current?.ownerDocument?.defaultView
			);
			if ( ! cancelled ) {
				onReady?.( postId, postType );
			}
		}
		signalReady();
		return () => {
			cancelled = true;
		};
	}, [
		areHeaderBlocksReady,
		canvasRootRef,
		featuredMedia,
		needsCover,
		onReady,
		postId,
		postType,
		src,
	] );

	return null;
}

export default function EditorBody( {
	featuredMedia,
	isActive = true,
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
	const { themeSupportsLayout, hasRootPaddingAwareAlignments } = useSelect(
		( select ) => {
			const settings = select( blockEditorStore ).getSettings();
			return {
				themeSupportsLayout: settings.supportsLayout,
				hasRootPaddingAwareAlignments:
					settings.__experimentalFeatures
						?.useRootPaddingAwareAlignments,
			};
		},
		[]
	);
	const [ globalLayoutSettings ] = useSettings( 'layout' );
	// Match @wordpress/editor's visual-editor fallback. Themes with layout
	// support get the constrained post-content canvas; classic themes keep the
	// default flow layout.
	const canvasLayout = themeSupportsLayout
		? { type: 'constrained', ...globalLayoutSettings }
		: { type: 'default' };
	const canvasClassName = [
		'wp-block-post-content',
		themeSupportsLayout ? 'is-layout-constrained' : 'is-layout-flow',
		hasRootPaddingAwareAlignments ? 'has-global-padding' : '',
	]
		.filter( Boolean )
		.join( ' ' );
	const blockCanvasRef = useRef( null );
	const isTrashed = useSelect(
		( select ) =>
			select( editorStore ).getCurrentPostAttribute( 'status' ) ===
			'trash',
		[]
	);
	const shouldUseHeaderAwareAppender = useSelect(
		( select ) => {
			if ( getCanvasOwnerBlockName( postType ) ) {
				return false;
			}
			const blocks = select( blockEditorStore ).getBlocks();
			return (
				blocks.length > 0 &&
				blocks.every( ( block ) =>
					isHeaderChromeBlock( block, postType )
				)
			);
		},
		[ postType ]
	);
	const renderAppender = shouldUseHeaderAwareAppender
		? () => <HeaderAwareRootAppender postType={ postType } />
		: undefined;

	const blockCanvas = (
		<div className="cortext-canvas__block-canvas" ref={ blockCanvasRef }>
			<BlockCanvas height="100%" styles={ styles }>
				<DocumentIdentityActions
					postId={ postId }
					postType={ postType }
				/>
				<EnsureHeaderBlocks postId={ postId } postType={ postType } />
				<HideHeaderBlockKebab postType={ postType } />
				<HeaderPrefixToolbarGuard
					isActive={ isActive }
					postType={ postType }
					toolbarRootRef={ blockCanvasRef }
				/>
				<div
					className={ [
						'cortext-canvas__editor',
						getCanvasOwnerBlockName( postType )
							? 'cortext-canvas__editor--owner'
							: '',
					]
						.filter( Boolean )
						.join( ' ' ) }
				>
					<BlockList
						className={ canvasClassName }
						layout={ canvasLayout }
						renderAppender={ renderAppender }
					/>
				</div>
				<CanvasReadyEffect
					featuredMedia={ featuredMedia }
					postId={ postId }
					postType={ postType }
					canvasRootRef={ blockCanvasRef }
					onReady={ onReady }
				/>
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
