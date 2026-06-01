import { __ } from '@wordpress/i18n';
import { Button, Dropdown, Spinner } from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import {
	lazy,
	Suspense,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
// Custom MediaPicker bridges to `window.parent.wp.media` so the modal
// always opens in the host document where media-views' CSS and scripts
// live. `MediaUpload` from @wordpress/{media-utils, block-editor} both
// dereference `window.wp.media`, which is undefined inside the
// BlockCanvas iframe.

import './DocumentIdentityControls.scss';

import MediaPicker, { MediaUploadCheck } from './MediaPicker';

import DocumentIcon from './DocumentIcon';

// The picker carries ~150KB of emoji data, so defer it until the popover
// actually opens. The first interaction pays the load cost; subsequent
// opens are instant.
const EmojiPicker = lazy( async () => {
	const [ pickerModule, dataModule ] = await Promise.all( [
		import(
			/* webpackChunkName: "emoji-mart-react" */ '@emoji-mart/react'
		),
		import( /* webpackChunkName: "emoji-mart-data" */ '@emoji-mart/data' ),
	] );

	const Picker = pickerModule.default;
	const data = dataModule.default;
	const emojis = Object.values( data.emojis ?? {} );
	const emojiForNative = ( native ) =>
		emojis.find( ( emoji ) =>
			emoji.skins?.some( ( skin ) => skin.native === native )
		);
	const nativeForSkin = ( native, skin ) => {
		const emoji = emojiForNative( native );
		return emoji?.skins?.[ skin - 1 ]?.native ?? null;
	};
	const readStoredSkin = () => {
		try {
			const stored = window.localStorage.getItem( 'emoji-mart.skin' );
			const skin = stored ? Number( JSON.parse( stored ) ) : 1;
			return skin >= 1 && skin <= 6 ? skin : 1;
		} catch {
			return 1;
		}
	};
	const skinFromEvent = ( event ) => {
		const path = event.composedPath?.() ?? [];
		const isSkinSelection = path.some(
			( target ) =>
				target?.name === 'skin-tone' ||
				target?.classList?.contains( 'option' )
		);
		if ( ! isSkinSelection ) {
			return null;
		}
		for ( const target of path ) {
			if ( target?.name === 'skin-tone' && target.value ) {
				return Number( target.value );
			}
			if ( ! target?.classList ) {
				continue;
			}
			for ( const className of target.classList ) {
				const match = /^skin-tone-([1-6])$/.exec( className );
				if ( match ) {
					return Number( match[ 1 ] );
				}
			}
		}
		return null;
	};
	const isSkinToneEvent = ( event ) =>
		( event.composedPath?.() ?? [] ).some(
			( target ) =>
				target?.name === 'skin-tone' ||
				target?.classList?.contains( 'skin-tone-button' ) ||
				target?.classList?.contains( 'skin-tone' ) ||
				target?.classList?.contains( 'option' )
		);

	return {
		default: function LoadedEmojiPicker( {
			currentEmoji,
			onSelect,
			onSkinToneInteraction,
		} ) {
			const wrapperRef = useRef( null );
			const currentEmojiRef = useRef( currentEmoji );
			const storedSkinRef = useRef( readStoredSkin() );
			useEffect( () => {
				currentEmojiRef.current = currentEmoji;
			}, [ currentEmoji ] );
			const stopSkinTonePropagation = ( event ) => {
				if ( isSkinToneEvent( event ) ) {
					onSkinToneInteraction?.();
					event.stopPropagation();
				}
			};
			const updateCurrentEmojiSkin = ( event ) => {
				const skin = skinFromEvent( event );
				const selectedEmoji = currentEmojiRef.current;
				if ( skin && selectedEmoji ) {
					const native = nativeForSkin( selectedEmoji, skin );
					if ( native ) {
						window.setTimeout( () => onSelect( native ), 0 );
					}
				}
				stopSkinTonePropagation( event );
			};
			useEffect( () => {
				const node = wrapperRef.current;
				if ( ! node ) {
					return undefined;
				}
				node.addEventListener( 'pointerdown', stopSkinTonePropagation );
				node.addEventListener( 'click', updateCurrentEmojiSkin );
				return () => {
					node.removeEventListener(
						'pointerdown',
						stopSkinTonePropagation
					);
					node.removeEventListener( 'click', updateCurrentEmojiSkin );
				};
			} );
			useEffect( () => {
				const timer = window.setInterval( () => {
					const skin = readStoredSkin();
					if ( skin === storedSkinRef.current ) {
						return;
					}
					storedSkinRef.current = skin;
					const selectedEmoji = currentEmojiRef.current;
					if ( ! selectedEmoji ) {
						return;
					}
					const native = nativeForSkin( selectedEmoji, skin );
					if ( native ) {
						onSkinToneInteraction?.();
						onSelect( native );
					}
				}, 100 );
				return () => window.clearInterval( timer );
			}, [ onSelect, onSkinToneInteraction ] );
			return (
				<div ref={ wrapperRef }>
					<Picker
						data={ data }
						onEmojiSelect={ ( emoji ) => {
							currentEmojiRef.current = emoji.native;
							onSelect( emoji.native );
						} }
						theme="light"
						previewPosition="none"
						skinTonePosition="search"
					/>
				</div>
			);
		},
	};
} );

// `@wordpress/icons` is also lazy-loaded; it ships a few hundred glyphs
// and the picker doesn't need them until the user clicks the Icons tab.
const IconLibraryPicker = lazy( () =>
	import(
		/* webpackChunkName: "icon-library-picker" */ './IconLibraryPicker'
	)
);

function encodeEmoji( value ) {
	return JSON.stringify( { type: 'emoji', value } );
}

function encodeImage( id ) {
	return JSON.stringify( { type: 'image', id } );
}

function encodeWpIcon( name, color ) {
	const payload = { type: 'wp', name };
	if ( color && color !== 'default' ) {
		payload.color = color;
	}
	return JSON.stringify( payload );
}

function decodeWpIcon( value ) {
	try {
		const decoded = value ? JSON.parse( value ) : null;
		if (
			decoded?.type === 'wp' &&
			typeof decoded.name === 'string' &&
			decoded.name !== ''
		) {
			return {
				name: decoded.name,
				color:
					typeof decoded.color === 'string' && decoded.color !== ''
						? decoded.color
						: 'default',
			};
		}
	} catch {
		// ignore malformed meta
	}
	return null;
}

function decodeEmoji( value ) {
	try {
		const decoded = value ? JSON.parse( value ) : null;
		if (
			decoded?.type === 'emoji' &&
			typeof decoded.value === 'string' &&
			decoded.value !== ''
		) {
			return decoded.value;
		}
	} catch {
		// ignore malformed meta
	}
	return null;
}

function isInsideIdentityPopover( node ) {
	if ( ! node || typeof node !== 'object' ) {
		return false;
	}
	if ( typeof node.closest === 'function' ) {
		if (
			node.closest(
				'.cortext-document-identity-popover-content, .cortext-document-identity-popover, em-emoji-picker'
			)
		) {
			return true;
		}
	}
	const root =
		typeof node.getRootNode === 'function' ? node.getRootNode() : null;
	if ( root?.host ) {
		return isInsideIdentityPopover( root.host );
	}
	return false;
}

function isIdentityControlPointer( event, controlNode ) {
	const path = event.composedPath?.() ?? [];
	if ( controlNode && path.includes( controlNode ) ) {
		return true;
	}
	if ( path.some( isInsideIdentityPopover ) ) {
		return true;
	}
	const target = event.target;
	return (
		!! controlNode &&
		target &&
		typeof controlNode.contains === 'function' &&
		controlNode.contains( target )
	);
}

function PickerBody( {
	postId,
	postType,
	currentIcon,
	allowRemove,
	onAfterSave,
	onSkinToneInteraction,
} ) {
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );

	// Pull the current icon's color (if any) so the IconLibraryPicker
	// opens with the previously-saved color highlighted instead of
	// snapping back to "default" on every popover open.
	const currentWpIcon = decodeWpIcon( currentIcon );
	const initialIconColor = currentWpIcon?.color ?? 'default';
	const currentEmoji = decodeEmoji( currentIcon );

	// editEntityRecord updates the local data store synchronously so
	// every subscriber (icon block, sidebar tree) sees the new value
	// immediately. The actual server save is debounced; without it,
	// rapid picks (browsing emojis, switching colors) fire a save per
	// click, and each server round-trip re-renders the whole post
	// graph (including the trash sidebar's resolution state), which
	// reads as a flash on screen.
	const saveTimer = useRef( null );
	useEffect( () => {
		return () => {
			if ( saveTimer.current ) {
				clearTimeout( saveTimer.current );
				saveEditedEntityRecord( 'postType', postType, postId );
			}
		};
	}, [ postId, postType, saveEditedEntityRecord ] );

	const persist = ( nextMetaValue ) => {
		editEntityRecord( 'postType', postType, postId, {
			meta: { cortext_document_icon: nextMetaValue },
		} );
		onAfterSave?.( nextMetaValue );

		if ( saveTimer.current ) {
			clearTimeout( saveTimer.current );
		}
		saveTimer.current = setTimeout( () => {
			saveTimer.current = null;
			saveEditedEntityRecord( 'postType', postType, postId );
		}, 600 );
	};

	const tabs = [
		{ name: 'emoji', title: __( 'Emoji', 'cortext' ) },
		{ name: 'icons', title: __( 'Icons', 'cortext' ) },
		{ name: 'upload', title: __( 'Upload', 'cortext' ) },
	];
	const [ activeTab, setActiveTab ] = useState( 'emoji' );

	const renderActive = () => {
		if ( activeTab === 'emoji' ) {
			return (
				<Suspense
					fallback={
						<div className="cortext-document-identity-popover__loading">
							<Spinner />
						</div>
					}
				>
					<EmojiPicker
						currentEmoji={ currentEmoji }
						onSkinToneInteraction={ onSkinToneInteraction }
						onSelect={ ( native ) =>
							persist( encodeEmoji( native ) )
						}
					/>
				</Suspense>
			);
		}
		if ( activeTab === 'icons' ) {
			return (
				<Suspense
					fallback={
						<div className="cortext-document-identity-popover__loading">
							<Spinner />
						</div>
					}
				>
					<IconLibraryPicker
						initialColor={ initialIconColor }
						onColorSelect={ ( color ) => {
							if ( currentWpIcon ) {
								persist(
									encodeWpIcon( currentWpIcon.name, color )
								);
							}
						} }
						onSelect={ ( name, color ) =>
							persist( encodeWpIcon( name, color ) )
						}
					/>
				</Suspense>
			);
		}
		return (
			<MediaUploadCheck>
				<MediaPicker
					allowedTypes={ [ 'image' ] }
					postId={ postId }
					onSelect={ ( media ) => persist( encodeImage( media.id ) ) }
					render={ ( { open } ) => (
						<div className="cortext-document-identity-popover__upload">
							<Button
								variant="primary"
								onClick={ open }
								__next40pxDefaultSize
							>
								{ __( 'Open media library', 'cortext' ) }
							</Button>
							<p className="cortext-document-identity-popover__hint">
								{ __(
									'Pick or upload an image to use as this document’s icon.',
									'cortext'
								) }
							</p>
						</div>
					) }
				/>
			</MediaUploadCheck>
		);
	};

	return (
		<div className="cortext-document-identity-popover">
			<div
				className="cortext-document-identity-popover__tabs"
				role="tablist"
			>
				{ tabs.map( ( tab ) => (
					<button
						key={ tab.name }
						type="button"
						role="tab"
						aria-selected={ activeTab === tab.name }
						className={
							'cortext-document-identity-popover__tab' +
							( activeTab === tab.name ? ' is-active' : '' )
						}
						onClick={ () => setActiveTab( tab.name ) }
					>
						{ tab.title }
					</button>
				) ) }
				{ allowRemove && (
					<button
						type="button"
						className="cortext-document-identity-popover__remove"
						onClick={ () => persist( '' ) }
					>
						{ __( 'Remove', 'cortext' ) }
					</button>
				) }
			</div>
			<div
				className="cortext-document-identity-popover__panel"
				role="tabpanel"
			>
				{ renderActive() }
			</div>
		</div>
	);
}

// Render-prop API: caller controls the trigger element so the picker can
// open from a sidebar row, the document header, or a toolbar button without
// each surface duplicating Dropdown plumbing.
export default function DocumentIdentityControls( {
	postId,
	postType,
	currentIcon,
	renderToggle,
	popoverPlacement = 'bottom-start',
	onAfterSave,
} ) {
	const hasIcon = !! currentIcon;
	const controlRef = useRef( null );
	const [ dropdownOpen, setDropdownOpen ] = useState( false );
	const ignoreNextCloseRef = useRef( false );
	const ignoreNextCloseTimerRef = useRef( null );

	useEffect( () => {
		return () => {
			if ( ignoreNextCloseTimerRef.current ) {
				clearTimeout( ignoreNextCloseTimerRef.current );
			}
		};
	}, [] );

	useEffect( () => {
		if ( ! dropdownOpen ) {
			return undefined;
		}
		const ownerDocument = controlRef.current?.ownerDocument ?? document;
		const closeOnOutsidePointer = ( event ) => {
			if ( isIdentityControlPointer( event, controlRef.current ) ) {
				return;
			}
			setDropdownOpen( false );
		};
		ownerDocument.addEventListener(
			'pointerdown',
			closeOnOutsidePointer,
			true
		);
		return () =>
			ownerDocument.removeEventListener(
				'pointerdown',
				closeOnOutsidePointer,
				true
			);
	}, [ dropdownOpen ] );

	const keepOpenForSkinToneInteraction = () => {
		ignoreNextCloseRef.current = true;
		if ( ignoreNextCloseTimerRef.current ) {
			clearTimeout( ignoreNextCloseTimerRef.current );
		}
		ignoreNextCloseTimerRef.current = setTimeout( () => {
			ignoreNextCloseRef.current = false;
			ignoreNextCloseTimerRef.current = null;
		}, 250 );
	};

	const handleOpenChange = ( nextOpen ) => {
		if ( ! nextOpen && ignoreNextCloseRef.current ) {
			ignoreNextCloseRef.current = false;
			setDropdownOpen( true );
			return;
		}
		setDropdownOpen( nextOpen );
	};
	const handlePopoverFocusOutside = ( event ) => {
		const nextTarget =
			event.relatedTarget ?? event.nativeEvent?.relatedTarget;
		if (
			isInsideIdentityPopover( nextTarget ) ||
			( ! nextTarget && isInsideIdentityPopover( event.target ) ) ||
			ignoreNextCloseRef.current
		) {
			return;
		}
		setDropdownOpen( false );
	};

	return (
		<Dropdown
			ref={ controlRef }
			className="cortext-document-identity-control"
			open={ dropdownOpen }
			onToggle={ handleOpenChange }
			popoverProps={ {
				placement: popoverPlacement,
				onFocusOutside: handlePopoverFocusOutside,
			} }
			contentClassName="cortext-document-identity-popover-content"
			renderToggle={ ( { isOpen, onToggle } ) =>
				renderToggle( {
					isOpen,
					onToggle,
					currentIconNode: (
						<DocumentIcon icon={ currentIcon } size={ 16 } />
					),
				} )
			}
			renderContent={ () => (
				<PickerBody
					postId={ postId }
					postType={ postType }
					currentIcon={ currentIcon }
					allowRemove={ hasIcon }
					onAfterSave={ onAfterSave }
					onSkinToneInteraction={ keepOpenForSkinToneInteraction }
				/>
			) }
		/>
	);
}
