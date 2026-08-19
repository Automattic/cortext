import { Button, Spinner } from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
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
	DOCUMENT_INSPECTOR,
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
	badgeLabel,
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
		>
			<Button
				className="cortext-revision-history__button"
				variant="tertiary"
				isPressed={ isSelected }
				aria-current={ isCurrent ? 'true' : undefined }
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
					{ badgeLabel ? (
						<span className="cortext-revision-history__badge">
							{ badgeLabel }
						</span>
					) : null }
				</span>
				{ revision?.author ? (
					<RevisionAuthor authorId={ revision.author } />
				) : null }
			</Button>
		</li>
	);
}

export default function RevisionHistoryPanel( { postId, postType } ) {
	const { record: currentRecord } = useEntityRecord(
		'postType',
		postType,
		postId
	);
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
			activeArea !== REVISION_HISTORY_PANEL &&
			activeArea !== DOCUMENT_INSPECTOR
		) {
			exitRevisions();
		}
	}, [ activeArea, currentRevisionId, exitRevisions, isAvailable ] );

	if ( ! isAvailable ) {
		return null;
	}

	const currentRow = {
		id: `current-${ postId }`,
		author: currentRecord?.author,
		modified: currentRecord?.modified,
	};
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
			<ul
				className="cortext-revision-history__list"
				aria-label={ sprintf(
					/* translators: %d: document id. */
					__( 'Versions for document %d', 'cortext' ),
					postId
				) }
			>
				<RevisionRow
					badgeLabel={ __( 'Current', 'cortext' ) }
					isCurrent
					isSelected={ ! currentRevisionId }
					onSelect={ exitRevisions }
					revision={ currentRow }
					revisionKey="id"
				/>
				{ data.length > 0
					? data.map( ( revision ) => {
							const id = revisionId( revision, revisionKey );
							return (
								<RevisionRow
									key={ id }
									badgeLabel={
										id === latestRevisionId
											? __( 'Latest revision', 'cortext' )
											: null
									}
									revision={ revision }
									revisionKey={ revisionKey }
									isSelected={ id === currentRevisionId }
									onSelect={ selectRevision }
								/>
							);
					  } )
					: null }
			</ul>
		</ComplementaryArea>
	);
}
