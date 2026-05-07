import { Button, Modal, Notice, Spinner } from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	chevronDown,
	chevronUp,
	closeSmall,
	drawerRight,
	fullscreen,
	seen,
	square,
	unseen,
} from '@wordpress/icons';

import useAutosave from '../hooks/useAutosave';
import EditorBody from './EditorBody';
import RowProperties from './RowProperties';
import { getRowDetailMode } from './rowDetailUtils';

export const ROW_DETAIL_MODE_ICONS = {
	side: drawerRight,
	modal: square,
	full: fullscreen,
};

export const ROW_DETAIL_MODE_LABELS = {
	side: __( 'Side peek', 'cortext' ),
	modal: __( 'Center modal', 'cortext' ),
	full: __( 'Full page', 'cortext' ),
};
const ROW_DETAIL_MODAL_CLOSE_MS = 240;
const ROW_DETAIL_SWITCH_MS = 180;
const ROW_DETAIL_SWITCH_FALLBACK_MS = ROW_DETAIL_SWITCH_MS + 100;

function delay( duration ) {
	return new Promise( ( resolve ) => {
		setTimeout( resolve, duration );
	} );
}

function detailKeyFor( detail ) {
	if ( ! detail ) {
		return null;
	}
	return `${ detail.postType }:${ detail.rowId }`;
}

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function settleDetailPanes( panes ) {
	const enteringPane = panes.find( ( pane ) => pane.state === 'entering' );
	if ( enteringPane ) {
		return panes
			.filter(
				( pane ) =>
					pane.key === enteringPane.key || pane.state === 'preparing'
			)
			.map( ( pane ) =>
				pane.key === enteringPane.key
					? { ...pane, state: 'active' }
					: pane
			);
	}
	return panes.filter( ( pane ) => pane.state !== 'covered' );
}

function DetailReadySignal( { detailKey, onReady } ) {
	useEffect( () => {
		onReady( detailKey );
	}, [ detailKey, onReady ] );

	return null;
}

const ROW_DETAIL_EDITOR_CSS = `
	body {
		background: #fff;
	}

	.editor-styles-wrapper {
		box-sizing: border-box;
		min-height: 100%;
		padding: 24px 32px 48px;
	}

	.editor-styles-wrapper .wp-block-post-content {
		margin-block-start: 0;
	}

	.editor-styles-wrapper > .block-editor-block-list__layout,
	.editor-styles-wrapper .block-editor-block-list__layout.is-root-container {
		min-height: 180px;
	}

	.editor-styles-wrapper .block-list-appender {
		margin-top: 12px;
	}
`;

const ROW_DETAIL_EXTRA_STYLES = [ { css: ROW_DETAIL_EDITOR_CSS } ];

function RowTitleBridge( { isActive, fallback, onTitle } ) {
	const editedTitle = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'title' ),
		[]
	);
	useEffect( () => {
		if ( ! isActive || ! onTitle ) {
			return;
		}
		const next =
			typeof editedTitle === 'string' && editedTitle !== ''
				? editedTitle
				: fallback;
		onTitle( next );
	}, [ editedTitle, fallback, isActive, onTitle ] );
	return null;
}

function titleFromRow( row ) {
	const title = row?.title;
	if ( typeof title === 'string' ) {
		return title;
	}
	return title?.raw ?? title?.rendered ?? '';
}

function titleFromDetail( detail ) {
	if ( ! detail ) {
		return '';
	}
	return titleFromRow( detail.record ) || titleFromRow( detail.row );
}

function RowAutosaveBridge( {
	isActive = true,
	onApi,
	onSaved,
	recentTarget,
} ) {
	const { status, lastSavedAt, flushNow, isDirty, isSaving } = useAutosave( {
		debounceMs: 0,
		minSaveIntervalMs: 0,
		recentTarget,
	} );
	const { resetPost } = useDispatch( editorStore );
	const discard = useCallback( () => resetPost(), [ resetPost ] );
	const lastNotifiedSaveRef = useRef( null );
	const autosaveStateRef = useRef( { isDirty, isSaving } );
	autosaveStateRef.current = { isDirty, isSaving };
	const hasPendingEdits = useCallback(
		() =>
			autosaveStateRef.current.isDirty ||
			autosaveStateRef.current.isSaving,
		[]
	);

	useEffect( () => {
		if ( ! isActive ) {
			return undefined;
		}
		onApi?.( { flushNow, discard, hasPendingEdits } );
		return () => onApi?.( null );
	}, [ discard, flushNow, hasPendingEdits, isActive, onApi ] );

	useEffect( () => {
		if (
			! isActive ||
			status !== 'saved' ||
			! lastSavedAt ||
			lastNotifiedSaveRef.current === lastSavedAt
		) {
			return;
		}
		lastNotifiedSaveRef.current = lastSavedAt;
		onSaved?.();
	}, [ isActive, lastSavedAt, onSaved, status ] );

	return null;
}

export function ModeControl( { mode, onChangeMode } ) {
	const modes = Object.keys( ROW_DETAIL_MODE_LABELS ).filter(
		( nextMode ) => nextMode !== mode
	);

	return (
		<>
			{ modes.map( ( nextMode ) => (
				<Button
					key={ nextMode }
					className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
					icon={ ROW_DETAIL_MODE_ICONS[ nextMode ] }
					label={ ROW_DETAIL_MODE_LABELS[ nextMode ] }
					onClick={ () => {
						if ( mode !== nextMode ) {
							onChangeMode( nextMode );
						}
					} }
				/>
			) ) }
		</>
	);
}

function DetailPaneContent( {
	collectionId,
	fields,
	isActive,
	isHidden,
	isTitleActive,
	onApi,
	onRestored,
	onSaved,
	onTitle,
	postType,
	propertiesVisible,
	row,
	rowId,
} ) {
	const fallbackTitle = useMemo( () => titleFromRow( row ), [ row ] );
	return (
		<>
			<RowAutosaveBridge
				isActive={ isActive }
				onApi={ onApi }
				onSaved={ onSaved }
				recentTarget={
					rowId && collectionId
						? { kind: 'row', id: rowId, collectionId }
						: null
				}
			/>
			<RowTitleBridge
				isActive={ isTitleActive }
				fallback={ fallbackTitle }
				onTitle={ onTitle }
			/>
			{ /* tech-debt.md#41: this is shell-mounted until row
			     properties are a locked document block. */ }
			<RowProperties
				fields={ fields }
				row={ row }
				visible={ propertiesVisible }
			/>
			<EditorBody
				postId={ row?.id }
				postType={ postType }
				extraStyles={ ROW_DETAIL_EXTRA_STYLES }
				onRestored={ onRestored }
			/>
			<div
				aria-hidden={ isHidden ? true : undefined }
				{ ...( isHidden ? { inert: '' } : {} ) }
			/>
		</>
	);
}

function DetailShell( {
	arePropertiesVisible,
	children,
	fields,
	mode,
	onClose,
	onDiscardPending,
	onModeChange,
	onNext,
	onPrevious,
	onRetryPending,
	saveError,
	canGoNext,
	canGoPrevious,
	setArePropertiesVisible,
	title,
} ) {
	const fieldCountLabel = sprintf(
		/* translators: %d: Number of row fields. */
		_n( '%d field', '%d fields', fields.length, 'cortext' ),
		fields.length
	);

	return (
		<div
			className="cortext-row-detail__frame"
			data-properties-visible={ arePropertiesVisible ? 'true' : 'false' }
			aria-label={ fieldCountLabel }
		>
			<div className="cortext-row-detail__header">
				<div
					className="cortext-row-detail__toolbar"
					role="toolbar"
					aria-label={ __( 'Row detail tools', 'cortext' ) }
				>
					<div className="cortext-row-detail__toolbar-group">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ arePropertiesVisible ? unseen : seen }
							label={
								arePropertiesVisible
									? __( 'Hide fields', 'cortext' )
									: __( 'Show fields', 'cortext' )
							}
							onClick={ () =>
								setArePropertiesVisible(
									( current ) => ! current
								)
							}
						/>
					</div>
					<div className="cortext-row-detail__toolbar-group">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ chevronUp }
							label={ __( 'Row above', 'cortext' ) }
							onClick={ onPrevious }
							disabled={ ! canGoPrevious }
						/>
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ chevronDown }
							label={ __( 'Row below', 'cortext' ) }
							onClick={ onNext }
							disabled={ ! canGoNext }
						/>
					</div>
					<div className="cortext-row-detail__toolbar-group">
						<ModeControl
							mode={ mode }
							onChangeMode={ onModeChange }
						/>
					</div>
					<div className="cortext-row-detail__toolbar-group cortext-row-detail__toolbar-group--end">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--close"
							icon={ closeSmall }
							label={ __( 'Close', 'cortext' ) }
							onClick={ onClose }
						/>
					</div>
				</div>
				<div className="cortext-row-detail__identity">
					<h2 className="cortext-row-detail__title">
						{ title || __( 'Untitled', 'cortext' ) }
					</h2>
				</div>
			</div>
			{ saveError ? (
				<Notice
					className="cortext-row-detail__notice"
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Retry', 'cortext' ),
							onClick: onRetryPending,
							variant: 'primary',
						},
						{
							label: __( 'Discard', 'cortext' ),
							onClick: onDiscardPending,
							variant: 'tertiary',
						},
					] }
				>
					{ saveError }
				</Notice>
			) : null }
			<div className="cortext-row-detail__body">{ children }</div>
		</div>
	);
}

function LoadingDetail( { onClose } ) {
	return (
		<div className="cortext-row-detail__frame">
			<div className="cortext-row-detail__header">
				<Spinner />
				<Button
					icon={ closeSmall }
					label={ __( 'Close', 'cortext' ) }
					size="compact"
					onClick={ onClose }
				/>
			</div>
		</div>
	);
}

export default function RowDetailView( {
	canGoNext,
	canGoPrevious,
	collectionId,
	fields,
	mode,
	onApi,
	onClose,
	onDiscardPending,
	onModeChange,
	onNext,
	onPrevious,
	onRestored,
	onRetryPending,
	onSaved,
	postType,
	row,
	rowId,
	saveError,
} ) {
	const { record } = useEntityRecord( 'postType', postType, rowId ?? 0, {
		enabled: Boolean( postType && rowId ),
	} );
	const normalizedMode = getRowDetailMode( { rowDetailMode: mode } );
	const [ isModalClosing, setIsModalClosing ] = useState( false );
	const targetDetail = useMemo( () => {
		if (
			! record ||
			! postType ||
			! rowId ||
			String( record.id ) !== String( rowId )
		) {
			return null;
		}
		return { postType, record, row, rowId };
	}, [ postType, record, row, rowId ] );
	const [ resolvedDetail, setResolvedDetail ] = useState( targetDetail );

	useEffect( () => {
		if ( targetDetail ) {
			setResolvedDetail( targetDetail );
		}
	}, [ targetDetail ] );

	useEffect( () => {
		if ( normalizedMode !== 'modal' ) {
			setIsModalClosing( false );
		}
	}, [ normalizedMode ] );

	const activeDetail =
		targetDetail ??
		( resolvedDetail?.postType === postType ? resolvedDetail : null );
	const activeDetailKey = detailKeyFor( activeDetail );
	const [ arePropertiesVisible, setArePropertiesVisible ] = useState( true );
	const [ displayTitle, setDisplayTitle ] = useState( () =>
		titleFromDetail( activeDetail )
	);
	const [ detailPanes, setDetailPanes ] = useState( () =>
		activeDetail && activeDetailKey
			? [
					{
						key: activeDetailKey,
						detail: activeDetail,
						state: 'active',
					},
			  ]
			: []
	);
	// RowProperties filters out TITLE_FIELD_ID itself (the locked post-title
	// block above renders the title), so pass the full field list through.
	const propertyFields = fields;

	useEffect( () => {
		if ( activeDetail ) {
			setDisplayTitle( titleFromDetail( activeDetail ) );
		}
	}, [ activeDetail ] );

	useEffect( () => {
		if ( ! activeDetail || ! activeDetailKey ) {
			setDetailPanes( [] );
			return;
		}

		setDetailPanes( ( current ) => {
			if ( current.some( ( pane ) => pane.key === activeDetailKey ) ) {
				return current
					.filter(
						( pane ) =>
							pane.key === activeDetailKey ||
							pane.state !== 'preparing'
					)
					.map( ( pane ) => {
						if ( pane.key !== activeDetailKey ) {
							return pane;
						}
						return {
							...pane,
							detail: activeDetail,
							state:
								pane.state === 'covered'
									? 'entering'
									: pane.state,
						};
					} );
			}

			const visiblePanes = current
				.filter(
					( pane ) =>
						pane.state === 'active' || pane.state === 'entering'
				)
				.map( ( pane ) => ( { ...pane, state: 'active' } ) );

			return [
				...visiblePanes,
				{
					key: activeDetailKey,
					detail: activeDetail,
					state: visiblePanes.length ? 'preparing' : 'active',
				},
			];
		} );
	}, [ activeDetail, activeDetailKey ] );

	const onPaneReady = useCallback( ( readyKey ) => {
		setDetailPanes( ( current ) => {
			const readyPane = current.find( ( pane ) => pane.key === readyKey );
			if ( ! readyPane || readyPane.state !== 'preparing' ) {
				return current;
			}

			return current
				.filter(
					( pane ) =>
						pane.key === readyKey || pane.state !== 'preparing'
				)
				.map( ( pane ) => {
					if ( pane.key === readyKey ) {
						return { ...pane, state: 'entering' };
					}
					if (
						pane.state === 'active' ||
						pane.state === 'entering'
					) {
						return { ...pane, state: 'covered' };
					}
					return pane;
				} );
		} );
	}, [] );

	const onPaneAnimationEnd = useCallback( ( event ) => {
		if ( event.target !== event.currentTarget ) {
			return;
		}
		setDetailPanes( settleDetailPanes );
	}, [] );

	useEffect( () => {
		const isTransitioning = detailPanes.some(
			( pane ) => pane.state === 'entering'
		);
		if ( ! isTransitioning ) {
			return undefined;
		}
		if ( prefersReducedMotion() ) {
			setDetailPanes( settleDetailPanes );
			return undefined;
		}

		const timeout = setTimeout( () => {
			setDetailPanes( settleDetailPanes );
		}, ROW_DETAIL_SWITCH_FALLBACK_MS );
		return () => clearTimeout( timeout );
	}, [ detailPanes ] );

	const requestClose = useCallback( async () => {
		if ( normalizedMode !== 'modal' ) {
			return onClose?.();
		}
		if ( isModalClosing ) {
			return false;
		}
		if ( prefersReducedMotion() ) {
			return onClose?.();
		}

		setIsModalClosing( true );
		await delay( ROW_DETAIL_MODAL_CLOSE_MS );
		const didClose = await onClose?.();
		if ( didClose === false ) {
			setIsModalClosing( false );
		}
		return didClose;
	}, [ isModalClosing, normalizedMode, onClose ] );
	const requestNativeModalClose = useCallback(
		() => onClose?.(),
		[ onClose ]
	);
	const activePane = detailPanes.find(
		( pane ) => pane.key === activeDetailKey
	);
	const canUseRowControls = Boolean(
		activeDetail &&
			activePane &&
			activePane.state !== 'preparing' &&
			activePane.state !== 'covered' &&
			String( activeDetail.rowId ) === String( rowId )
	);

	const content =
		! activeDetail && detailPanes.length === 0 ? (
			<LoadingDetail onClose={ requestClose } />
		) : (
			<DetailShell
				arePropertiesVisible={ arePropertiesVisible }
				canGoNext={ canUseRowControls && canGoNext }
				canGoPrevious={ canUseRowControls && canGoPrevious }
				fields={ propertyFields }
				mode={ normalizedMode }
				onClose={ requestClose }
				onDiscardPending={ onDiscardPending }
				onModeChange={ onModeChange }
				onNext={ onNext }
				onPrevious={ onPrevious }
				onRetryPending={ onRetryPending }
				saveError={ canUseRowControls ? saveError : null }
				setArePropertiesVisible={ setArePropertiesVisible }
				title={ displayTitle }
			>
				<div className="cortext-row-detail__pane-stack">
					{ detailPanes.map( ( pane ) => {
						const isCurrentPane =
							pane.key === activeDetailKey &&
							( pane.state === 'active' ||
								pane.state === 'entering' );
						const isHiddenPane =
							pane.state === 'preparing' ||
							pane.state === 'covered';
						const isApiActive = isCurrentPane && ! isHiddenPane;
						const isTitleActive =
							! isHiddenPane &&
							( pane.state === 'active' ||
								pane.state === 'entering' );
						const paneRow = {
							...( pane.detail.row ?? {} ),
							...pane.detail.record,
							title:
								pane.detail.record.title ??
								pane.detail.row?.title,
							meta:
								pane.detail.record.meta ??
								pane.detail.row?.meta,
						};

						return (
							<div
								key={ pane.key }
								className="cortext-row-detail__pane"
								data-state={ pane.state }
								data-interactive={
									isApiActive ? 'true' : 'false'
								}
								aria-hidden={ isHiddenPane ? true : undefined }
								{ ...( isHiddenPane ? { inert: '' } : {} ) }
								onAnimationEnd={ onPaneAnimationEnd }
							>
								<EditorProvider
									post={ pane.detail.record }
									settings={
										window.cortextEditorSettings ?? {}
									}
									useSubRegistry
								>
									<DetailReadySignal
										detailKey={ pane.key }
										onReady={ onPaneReady }
									/>
									<DetailPaneContent
										fields={ propertyFields }
										isActive={ isApiActive }
										isHidden={ isHiddenPane }
										isTitleActive={ isTitleActive }
										onApi={ onApi }
										onRestored={ onRestored }
										onSaved={ onSaved }
										onTitle={ setDisplayTitle }
										postType={ pane.detail.postType }
										propertiesVisible={
											arePropertiesVisible
										}
										collectionId={ collectionId }
										row={ paneRow }
										rowId={ pane.detail.rowId }
									/>
								</EditorProvider>
							</div>
						);
					} ) }
				</div>
			</DetailShell>
		);

	if ( normalizedMode === 'modal' ) {
		return (
			<Modal
				className={
					'cortext-row-detail-modal' +
					( isModalClosing
						? ' cortext-row-detail-modal--closing'
						: '' )
				}
				title={ __( 'Row detail', 'cortext' ) }
				overlayClassName={
					isModalClosing ? 'is-animating-out' : undefined
				}
				onRequestClose={ requestNativeModalClose }
				__experimentalHideHeader
			>
				<div className="cortext-row-detail cortext-row-detail--modal">
					{ content }
				</div>
			</Modal>
		);
	}

	return (
		<div
			className={ `cortext-row-detail cortext-row-detail--${ normalizedMode }` }
			role="dialog"
			aria-label={ __( 'Row detail', 'cortext' ) }
		>
			{ content }
		</div>
	);
}
