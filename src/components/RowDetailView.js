import { Button, Modal, Notice, Spinner } from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
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

// The editor surface (EditorProvider + EditorBody + autosave + block
// registration) lives in the `editor` chunk, shared with Canvas, so it
// stays off the initial admin entry. The peek's chrome (toolbar, modal,
// navigation) renders synchronously; only the inner pane stack suspends.
// First open per session pays the chunk-fetch cost; subsequent opens are
// instant. src/index.js warms the chunk on idle after first paint, so
// most opens skip the fallback. See the longer note in EntityRoute.js for
// why this does not also drop the WP editor script handles.
const RowEditor = lazy( () =>
	import( /* webpackChunkName: "editor" */ './RowEditor' )
);
import { getRowDetailMode, titleFromDetail } from './rowDetailUtils';

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
					<Suspense
						fallback={
							<div className="cortext-row-detail__pane cortext-row-detail__pane--loading">
								<Spinner />
							</div>
						}
					>
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
								cortext_hydrated_meta:
									pane.detail.record.cortext_hydrated_meta ??
									pane.detail.row?.cortext_hydrated_meta,
							};

							return (
								<div
									key={ pane.key }
									className="cortext-row-detail__pane"
									data-state={ pane.state }
									data-interactive={
										isApiActive ? 'true' : 'false'
									}
									aria-hidden={
										isHiddenPane ? true : undefined
									}
									{ ...( isHiddenPane ? { inert: '' } : {} ) }
									onAnimationEnd={ onPaneAnimationEnd }
								>
									<RowEditor
										collectionId={ collectionId }
										detailKey={ pane.key }
										fields={ propertyFields }
										isActive={ isApiActive }
										isHidden={ isHiddenPane }
										isTitleActive={ isTitleActive }
										onApi={ onApi }
										onPaneReady={ onPaneReady }
										onRestored={ onRestored }
										onSaved={ onSaved }
										onTitle={ setDisplayTitle }
										post={ pane.detail.record }
										postType={ pane.detail.postType }
										propertiesVisible={
											arePropertiesVisible
										}
										row={ paneRow }
										rowId={ pane.detail.rowId }
									/>
								</div>
							);
						} ) }
					</Suspense>
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
