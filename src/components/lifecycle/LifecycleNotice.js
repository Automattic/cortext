import { _n, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';
import { useNavigate, useParams } from '@tanstack/react-router';

import './LifecycleNotice.scss';

import useLifecycleDetails from './useLifecycleDetails';
import { DocumentsProvider, useDocumentActions } from '../../documents';

function LifecycleNoticeContent( { state, postId, postType, onRestored } ) {
	const [ isBusy, setIsBusy ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ isConfirming, setIsConfirming ] = useState( false );
	const navigate = useNavigate();
	const params = useParams( { strict: false } );
	const details = useLifecycleDetails( state, postId );
	const actions = useDocumentActions();
	const copy = state.copy();
	const record = details?.record ?? { id: postId };

	const run = async ( action, fallbackMessage ) => {
		setError( null );
		setIsBusy( true );
		try {
			await action();
		} catch ( err ) {
			setError( err?.message ?? fallbackMessage );
		} finally {
			setIsBusy( false );
		}
	};

	const restore = () =>
		run( async () => {
			const response = await state.restore( actions )( record );
			onRestored?.( postId, postType, response );
		}, copy.restoreError );

	// Opened from its view, go back to the list so it selects the next item.
	// Opened from anywhere else, stay unless the document is gone.
	const runSecondary = () => {
		setIsConfirming( false );
		return run( async () => {
			await state.secondary( actions )( record );
			if ( state.isUri( params._splat ?? '' ) ) {
				navigate( {
					to: '/$',
					params: { _splat: state.uri() },
					replace: true,
				} );
				return;
			}
			if ( state.secondaryRemovesDocument ) {
				navigate( { to: '/' } );
			}
		}, copy.secondaryError );
	};

	const facts = details
		? [
				state.statusLabel( details.record, details.byName ),
				details.nestedCount > 0
					? sprintf(
							/* translators: %d: number of nested documents restored with this one */
							_n(
								'%d nested document comes back with it',
								'%d nested documents come back with it',
								details.nestedCount,
								'cortext'
							),
							details.nestedCount
					  )
					: '',
		  ].filter( Boolean )
		: [];
	const restoreLabel = copy.restoreLabel(
		details?.path.length ? details.path[ details.path.length - 1 ] : ''
	);
	const { SecondaryConfirmDialog } = state;

	return (
		<>
			<Notice
				className={ `cortext-canvas__notice cortext-lifecycle-notice is-${ state.name }` }
				status={ state.noticeStatus }
				isDismissible={ false }
				actions={ [
					{
						label: restoreLabel,
						onClick: restore,
						disabled: isBusy,
						variant: 'primary',
					},
					{
						label: copy.secondaryLabel,
						onClick: () => setIsConfirming( true ),
						disabled: isBusy || ! details,
						variant: 'tertiary',
						className: 'cortext-lifecycle-notice__secondary',
					},
				] }
			>
				<p className="cortext-lifecycle-notice__title">
					{ error ?? copy.noticeTitle }
				</p>
				{ facts.length > 0 && (
					<p className="cortext-lifecycle-notice__facts">
						{ facts.join( ' · ' ) }
					</p>
				) }
			</Notice>
			{ isConfirming && details && (
				<SecondaryConfirmDialog
					record={ details.record }
					counts={ { total: details.nestedCount } }
					onConfirm={ runSecondary }
					onCancel={ () => setIsConfirming( false ) }
				/>
			) }
		</>
	);
}

/**
 * The banner over a trashed or archived document: when it got there and who
 * sent it, what comes back with it, and the actions to restore it or take the
 * next step (delete it for good, or move it to Trash). It shows whether the
 * document was opened from its view or from a link.
 *
 * @param {Object}   props
 * @param {Object}   props.state      Lifecycle state from `lifecycleStates`.
 * @param {number}   props.postId     Document id.
 * @param {string}   props.postType   Its post type.
 * @param {Function} props.onRestored Called after a restore.
 */
export default function LifecycleNotice( props ) {
	return (
		<DocumentsProvider>
			<LifecycleNoticeContent { ...props } />
		</DocumentsProvider>
	);
}
