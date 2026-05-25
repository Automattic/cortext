import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button, Dropdown, Spinner } from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { Icon, chevronDown, closeSmall, plus } from '@wordpress/icons';

import useCollectionRows from '../../hooks/useCollectionRows';
import useCollectionRowsByIds from '../../hooks/useCollectionRowsByIds';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { useRecents } from '../../hooks/useRecents';
import { relationIds, relationTitle } from './relationUtils';

const RELATION_PICKER_PER_PAGE = 25;
const SCROLL_LOAD_MORE_THRESHOLD_PX = 80;
const SEARCH_DEBOUNCE_MS = 150;

function hasResolvedTitle( entry ) {
	return Boolean( entry?.title?.raw || entry?.title?.rendered );
}

function mergeRowsById( previous, incoming ) {
	const merged = new Map();
	previous.forEach( ( row ) => merged.set( row.id, row ) );
	incoming.forEach( ( row ) => merged.set( row.id, row ) );
	return Array.from( merged.values() );
}

export default function RelationEditor( {
	value,
	relation,
	onSave,
	onCancel,
	label,
	defaultOpen = true,
} ) {
	const [ search, setSearch ] = useState( '' );
	const debouncedSearch = useDebouncedValue( search, SEARCH_DEBOUNCE_MS );
	const [ page, setPage ] = useState( 1 );
	const [ accumulatedRows, setAccumulatedRows ] = useState( [] );
	const [ isCreating, setIsCreating ] = useState( false );
	const [ createError, setCreateError ] = useState( '' );
	const searchRef = useRef( null );
	const { touchRecent } = useRecents();
	const selectedIds = useMemo( () => relationIds( value ), [ value ] );
	const currentRefs = useMemo(
		() => ( Array.isArray( value ) ? value : [ value ] ),
		[ value ]
	);
	const targetCollectionId = Number( relation?.targetCollectionId );
	const isMultiple = relation?.multiple !== false;

	const pickerView = useMemo(
		() => ( {
			type: 'table',
			fields: [],
			sort: null,
			filters: [],
			perPage: RELATION_PICKER_PER_PAGE,
			page,
			search: debouncedSearch,
			layout: {},
		} ),
		[ page, debouncedSearch ]
	);

	const {
		data,
		isLoading,
		paginationInfo,
		refresh: refreshTargetRows,
	} = useCollectionRows( targetCollectionId || null, pickerView, [] );

	// Start over at page 1 when the search or target changes. Keep the old
	// rows visible under the spinner until the new query lands, so the picker
	// does not flash empty while typing.
	useEffect( () => {
		setPage( 1 );
	}, [ debouncedSearch, targetCollectionId ] );

	useEffect( () => {
		// While loading, useCollectionRows still returns the previous query's
		// data. Do not let that stale page replace the accumulated list.
		if ( isLoading ) {
			return;
		}
		if ( page === 1 ) {
			setAccumulatedRows( data );
			return;
		}
		setAccumulatedRows( ( previous ) => mergeRowsById( previous, data ) );
	}, [ data, page, isLoading ] );

	// Some saved relation refs are just IDs. Fetch labels for those only; row
	// CPT responses usually already include titles.
	const unresolvedIds = useMemo(
		() =>
			selectedIds.filter( ( id ) => {
				const ref = currentRefs.find(
					( entry ) => Number( entry?.id ) === id
				);
				return ! hasResolvedTitle( ref );
			} ),
		[ selectedIds, currentRefs ]
	);
	const { rows: byIdRows } = useCollectionRowsByIds(
		targetCollectionId || null,
		unresolvedIds
	);

	const selectedRefs = useMemo( () => {
		return selectedIds.map( ( id ) => {
			const fromValue = currentRefs.find(
				( entry ) => Number( entry?.id ) === id
			);
			if ( hasResolvedTitle( fromValue ) ) {
				return fromValue;
			}
			const fromById = byIdRows.find( ( row ) => row.id === id );
			if ( fromById ) {
				return fromById;
			}
			const fromData = accumulatedRows.find( ( row ) => row.id === id );
			if ( fromData ) {
				return fromData;
			}
			return fromValue || { id };
		} );
	}, [ selectedIds, currentRefs, byIdRows, accumulatedRows ] );

	const unselectedRows = accumulatedRows.filter(
		( row ) => ! selectedIds.includes( row.id )
	);
	const createTitle = search.trim();
	const debouncedCreateTitle = debouncedSearch.trim();
	const isSearchSettled = createTitle === debouncedCreateTitle;
	const hasExactMatch =
		isSearchSettled &&
		createTitle.length > 0 &&
		accumulatedRows.some(
			( row ) =>
				relationTitle( row ).trim().toLowerCase() ===
				createTitle.toLowerCase()
		);
	const canCreate =
		targetCollectionId > 0 &&
		createTitle.length > 0 &&
		isSearchSettled &&
		! isLoading &&
		! hasExactMatch;

	const totalPages = paginationInfo?.totalPages ?? 1;
	const canLoadMore = page < totalPages;

	const handleScroll = useCallback(
		( event ) => {
			if ( isLoading || ! canLoadMore ) {
				return;
			}
			const node = event.currentTarget;
			if (
				node.scrollTop + node.clientHeight >=
				node.scrollHeight - SCROLL_LOAD_MORE_THRESHOLD_PX
			) {
				setPage( ( previous ) => previous + 1 );
			}
		},
		[ isLoading, canLoadMore ]
	);

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
			defaultOpen={ defaultOpen }
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
						<span className="cortext-relation-edit__toggle-placeholder">
							{ __( 'Select rows…', 'cortext' ) }
						</span>
					) }
					<Icon
						icon={ chevronDown }
						size={ 16 }
						className="cortext-relation-edit__toggle-chevron"
					/>
				</Button>
			) }
			renderContent={ ( { onClose } ) => (
				<div
					className="cortext-relation-edit"
					onScroll={ handleScroll }
				>
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
						{ isLoading && accumulatedRows.length === 0 ? (
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
						{ unselectedRows.map( ( row ) => (
							<button
								key={ row.id }
								type="button"
								className="cortext-relation-edit__row"
								onMouseDown={ keepSearchFocused }
								onClick={ async () => {
									const shouldClose = await toggle( row.id );
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
						{ isLoading && accumulatedRows.length > 0 ? (
							<div className="cortext-relation-edit__loading cortext-relation-edit__loading--more">
								<Spinner />
							</div>
						) : null }
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
