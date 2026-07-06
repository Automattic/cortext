import { Button, Spinner } from '@wordpress/components';
import { dateI18n, getDate, getSettings, humanTimeDiff } from '@wordpress/date';
import { useSelect } from '@wordpress/data';
import { useEffect } from '@wordpress/element';
import {
	ComplementaryArea,
	store as interfaceStore,
} from '@wordpress/interface';
import { __, sprintf } from '@wordpress/i18n';

import {
	INSPECTOR_SCOPE,
	REVISION_HISTORY_PANEL,
} from './editorPanelConstants';
import {
	useRevisionAuthor,
	useRevisionControls,
	useRevisions,
} from '../hooks/useRevisions';

export { REVISION_HISTORY_PANEL } from './editorPanelConstants';

const DAY_IN_MILLISECONDS = 86400000;

function revisionId( revision, revisionKey ) {
	return revision?.[ revisionKey ] ?? revision?.id;
}

function formatRevisionTime( dateValue ) {
	if ( ! dateValue ) {
		return '';
	}
	const date = getDate( dateValue );
	const now = getDate( null );
	if ( now.getTime() - date.getTime() > DAY_IN_MILLISECONDS ) {
		return dateI18n( getSettings().formats.datetimeAbbreviated, date );
	}
	return humanTimeDiff( date );
}

function fullRevisionTime( dateValue ) {
	return dateValue
		? dateI18n( getSettings().formats.datetime, getDate( dateValue ) )
		: '';
}

function RevisionAuthor( { authorId } ) {
	const { user } = useRevisionAuthor( authorId );
	return (
		<span className="cortext-revision-history__author">
			{ user?.name || __( 'Unknown author', 'cortext' ) }
		</span>
	);
}

function RevisionRow( {
	isCurrent,
	isSelected,
	onSelect,
	revision,
	revisionKey,
} ) {
	const id = revisionId( revision, revisionKey );
	const date = revision?.date ?? revision?.modified;
	const label = fullRevisionTime( date );

	return (
		<li
			className={ [
				'cortext-revision-history__item',
				isSelected ? 'is-selected' : '',
			]
				.filter( Boolean )
				.join( ' ' ) }
			role="option"
			aria-selected={ isSelected }
		>
			<Button
				className="cortext-revision-history__button"
				variant="tertiary"
				onClick={ () => onSelect( id ) }
			>
				<span className="cortext-revision-history__main">
					<time
						className="cortext-revision-history__date"
						dateTime={ date }
						title={ label }
					>
						{ formatRevisionTime( date ) }
					</time>
					{ isCurrent ? (
						<span className="cortext-revision-history__badge">
							{ __( 'Current', 'cortext' ) }
						</span>
					) : null }
				</span>
				<RevisionAuthor authorId={ revision?.author } />
			</Button>
		</li>
	);
}

export default function RevisionHistoryPanel( { postId, postType } ) {
	const { data, isLoading, hasResolved, error, revisionKey } = useRevisions(
		postType,
		postId
	);
	const { isAvailable, currentRevisionId, exitRevisions, selectRevision } =
		useRevisionControls( { postId, postType } );
	const activeArea = useSelect(
		( select ) =>
			select( interfaceStore ).getActiveComplementaryArea(
				INSPECTOR_SCOPE
			),
		[]
	);

	useEffect( () => {
		if (
			isAvailable &&
			currentRevisionId &&
			activeArea !== REVISION_HISTORY_PANEL
		) {
			exitRevisions();
		}
	}, [ activeArea, currentRevisionId, exitRevisions, isAvailable ] );

	if ( ! isAvailable ) {
		return null;
	}

	const latestRevisionId = revisionId( data[ 0 ], revisionKey );

	return (
		<ComplementaryArea
			scope={ INSPECTOR_SCOPE }
			identifier={ REVISION_HISTORY_PANEL }
			title={ __( 'History', 'cortext' ) }
			closeLabel={ __( 'Close history', 'cortext' ) }
			isPinnable={ false }
			className="editor-sidebar__panel cortext-revision-history"
			headerClassName="cortext-revision-history__header"
			header={
				<div className="cortext-revision-history__header-row">
					<strong>{ __( 'History', 'cortext' ) }</strong>
				</div>
			}
		>
			{ isLoading && ! hasResolved ? (
				<div className="cortext-revision-history__loading">
					<Spinner />
				</div>
			) : null }
			{ error ? (
				<p className="cortext-revision-history__empty" role="alert">
					{ error?.message ??
						__( 'Could not load revisions.', 'cortext' ) }
				</p>
			) : null }
			{ hasResolved && ! error && data.length === 0 ? (
				<p className="cortext-revision-history__empty">
					{ __( 'No revisions yet.', 'cortext' ) }
				</p>
			) : null }
			{ data.length > 0 ? (
				<ul
					className="cortext-revision-history__list"
					role="listbox"
					aria-label={ sprintf(
						/* translators: %d: document id. */
						__( 'Revisions for document %d', 'cortext' ),
						postId
					) }
				>
					{ data.map( ( revision ) => {
						const id = revisionId( revision, revisionKey );
						return (
							<RevisionRow
								key={ id }
								revision={ revision }
								revisionKey={ revisionKey }
								isCurrent={ id === latestRevisionId }
								isSelected={ id === currentRevisionId }
								onSelect={ selectRevision }
							/>
						);
					} ) }
				</ul>
			) : null }
		</ComplementaryArea>
	);
}
