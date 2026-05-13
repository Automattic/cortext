import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button, Dropdown, Spinner } from '@wordpress/components';
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { Icon, closeSmall, plus } from '@wordpress/icons';

import useCollectionRows from '../../hooks/useCollectionRows';
import { useRecents } from '../../hooks/useRecents';
import { relationIds, relationTitle } from './relationUtils';

const RELATION_PICKER_VIEW = {
	type: 'table',
	fields: [],
	sort: null,
	filters: [],
	perPage: 25,
	page: 1,
	search: '',
	layout: {},
};

export default function RelationEditor( {
	value,
	relation,
	onSave,
	onCancel,
	label,
} ) {
	const [ search, setSearch ] = useState( '' );
	const [ isCreating, setIsCreating ] = useState( false );
	const [ createError, setCreateError ] = useState( '' );
	const searchRef = useRef( null );
	const { touchRecent } = useRecents();
	const selectedIds = useMemo( () => relationIds( value ), [ value ] );
	const targetCollectionId = Number( relation?.targetCollectionId );
	const isMultiple = relation?.multiple !== false;
	const {
		data,
		isLoading,
		refresh: refreshTargetRows,
	} = useCollectionRows(
		targetCollectionId || null,
		RELATION_PICKER_VIEW,
		[],
		{ forceClient: true }
	);
	const createTitle = search.trim();

	const rows = useMemo( () => {
		const term = search.trim().toLowerCase();
		if ( ! term ) {
			return data;
		}
		return data.filter( ( row ) =>
			( row.title?.raw || row.title?.rendered || '' )
				.toLowerCase()
				.includes( term )
		);
	}, [ data, search ] );
	const selectedRefs = useMemo( () => {
		const currentRefs = Array.isArray( value ) ? value : [ value ];
		return selectedIds.map(
			( id ) =>
				data.find( ( row ) => row.id === id ) ||
				currentRefs.find( ( ref ) => Number( ref?.id ) === id ) || {
					id,
				}
		);
	}, [ data, selectedIds, value ] );
	const unselectedRows = rows.filter(
		( row ) => ! selectedIds.includes( row.id )
	);
	const hasExactMatch =
		createTitle.length > 0 &&
		data.some(
			( row ) =>
				relationTitle( row ).trim().toLowerCase() ===
				createTitle.toLowerCase()
		);
	const canCreate =
		targetCollectionId > 0 &&
		createTitle.length > 0 &&
		! isLoading &&
		! hasExactMatch;

	const commit = async ( nextIds ) => {
		await onSave( nextIds );
	};

	const toggle = async ( rowId ) => {
		if ( isMultiple ) {
			const next = selectedIds.includes( rowId )
				? selectedIds.filter( ( id ) => id !== rowId )
				: [ ...selectedIds, rowId ];
			await commit( next );
			return false;
		}
		await commit( selectedIds.includes( rowId ) ? [] : [ rowId ] );
		return true;
	};
	const remove = async ( rowId ) => {
		const targetId = Number( rowId );
		await commit( selectedIds.filter( ( id ) => id !== targetId ) );
	};
	const keepSearchFocused = ( event ) => {
		event.preventDefault();
	};
	const createRelatedRow = async ( onClose ) => {
		if ( ! canCreate || isCreating ) {
			return;
		}
		setIsCreating( true );
		setCreateError( '' );
		try {
			const created = await apiFetch( {
				path: `/cortext/v1/collections/${ targetCollectionId }/rows`,
				method: 'POST',
				data: { title: createTitle },
			} );
			const createdId = Number( created?.id );
			if ( ! createdId ) {
				throw new Error(
					__( 'Related row could not be created.', 'cortext' )
				);
			}
			touchRecent( {
				kind: 'row',
				id: createdId,
				collectionId: targetCollectionId,
			} );
			const nextIds = isMultiple
				? [
						...selectedIds.filter( ( id ) => id !== createdId ),
						createdId,
				  ]
				: [ createdId ];
			await commit( nextIds );
			refreshTargetRows?.();
			setSearch( '' );
			if ( ! isMultiple ) {
				onClose();
			}
		} catch ( error ) {
			setCreateError(
				error?.message ||
					__( 'Related row could not be created.', 'cortext' )
			);
		} finally {
			setIsCreating( false );
		}
	};
	useEffect( () => {
		searchRef.current?.focus();
	}, [] );

	return (
		<Dropdown
			defaultOpen
			onClose={ onCancel }
			popoverProps={ {
				placement: 'bottom-start',
				className: 'cortext-relation-edit-popover',
			} }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					variant="tertiary"
					className="cortext-relation-edit__toggle"
					onClick={ onToggle }
					aria-expanded={ isOpen }
					aria-label={ label }
				>
					{ selectedRefs.length ? (
						<span className="cortext-relation-edit__toggle-refs">
							{ selectedRefs.map( ( ref ) => (
								<span
									key={ ref.id }
									className="cortext-relation-edit__toggle-ref"
								>
									{ relationTitle( ref ) }
								</span>
							) ) }
						</span>
					) : (
						__( 'Select rows…', 'cortext' )
					) }
				</Button>
			) }
			renderContent={ ( { onClose } ) => (
				<div className="cortext-relation-edit">
					<div className="cortext-relation-edit__searchbar">
						<input
							ref={ searchRef }
							className="cortext-relation-edit__search"
							type="search"
							value={ search }
							onChange={ ( event ) =>
								setSearch( event.target.value )
							}
							placeholder={ __(
								'Search or create a row…',
								'cortext'
							) }
							aria-label={ __( 'Search rows', 'cortext' ) }
						/>
					</div>
					{ selectedIds.length > 0 ? (
						<div className="cortext-relation-edit__section">
							<div className="cortext-relation-edit__section-label">
								{ __( 'Selected', 'cortext' ) }
							</div>
							<div className="cortext-relation-edit__selected-list">
								{ selectedRefs.map( ( ref ) => (
									<span
										key={ ref.id }
										className="cortext-relation-edit__selected-pill"
									>
										<span className="cortext-relation-edit__selected-title">
											{ relationTitle( ref ) }
										</span>
										<Button
											className="cortext-relation-edit__remove"
											icon={ closeSmall }
											label={ __(
												'Remove relation',
												'cortext'
											) }
											onMouseDown={ keepSearchFocused }
											onClick={ () => remove( ref.id ) }
										/>
									</span>
								) ) }
							</div>
						</div>
					) : null }
					<div className="cortext-relation-edit__section cortext-relation-edit__section--more">
						<div className="cortext-relation-edit__section-label">
							{ __( 'Rows', 'cortext' ) }
						</div>
						{ isLoading ? (
							<div className="cortext-relation-edit__loading">
								<Spinner />
							</div>
						) : null }
						{ ! isLoading && unselectedRows.length === 0 ? (
							<div className="cortext-relation-edit__empty">
								{ createTitle
									? __( 'No results', 'cortext' )
									: __( 'No rows', 'cortext' ) }
							</div>
						) : null }
						{ ! isLoading &&
							unselectedRows.map( ( row ) => (
								<button
									key={ row.id }
									type="button"
									className="cortext-relation-edit__row"
									onMouseDown={ keepSearchFocused }
									onClick={ async () => {
										const shouldClose = await toggle(
											row.id
										);
										if ( shouldClose ) {
											onClose();
										}
									} }
								>
									<span className="cortext-relation-edit__row-title">
										{ relationTitle( row ) }
									</span>
								</button>
							) ) }
						{ canCreate ? (
							<button
								type="button"
								className="cortext-relation-edit__row cortext-relation-edit__row--create"
								onMouseDown={ keepSearchFocused }
								onClick={ () => createRelatedRow( onClose ) }
								disabled={ isCreating }
							>
								<Icon
									icon={ plus }
									className="cortext-relation-edit__row-icon"
								/>
								<span className="cortext-relation-edit__row-title">
									{ sprintf(
										/* translators: %s: row title */
										__( 'Create row "%s"', 'cortext' ),
										createTitle
									) }
								</span>
							</button>
						) : null }
						{ createError ? (
							<div className="cortext-relation-edit__error">
								{ createError }
							</div>
						) : null }
					</div>
				</div>
			) }
		/>
	);
}
