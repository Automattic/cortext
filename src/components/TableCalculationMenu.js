import { Icon, Popover } from '@wordpress/components';
import { useMemo, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { check, chevronRight } from '@wordpress/icons';

import './TableCalculationMenu.scss';

import { useSubmenuPlacement } from '../hooks/useSubmenuPlacement';
import {
	CALCULATION_LABELS,
	CALCULATION_NONE,
	calculationGroupsForField,
	isCalculationAvailable,
} from './tableCalculations';

function focusRelativeButton( container, activeElement, direction ) {
	const buttons = Array.from(
		container?.querySelectorAll( 'button:not(:disabled)' ) ?? []
	).filter(
		( element ) => element.getAttribute( 'aria-disabled' ) !== 'true'
	);
	if ( ! buttons.length ) {
		return;
	}
	const currentIndex = buttons.includes( activeElement )
		? buttons.indexOf( activeElement )
		: -1;
	let nextIndex;
	if ( currentIndex === -1 ) {
		nextIndex = direction > 0 ? 0 : buttons.length - 1;
	} else {
		nextIndex =
			( currentIndex + direction + buttons.length ) % buttons.length;
	}
	buttons[ nextIndex ]?.focus();
}

function focusEdgeButton( container, edge ) {
	const buttons = Array.from(
		container?.querySelectorAll( 'button:not(:disabled)' ) ?? []
	).filter(
		( element ) => element.getAttribute( 'aria-disabled' ) !== 'true'
	);
	const next = edge === 'last' ? buttons[ buttons.length - 1 ] : buttons[ 0 ];
	next?.focus();
}

function CalculationChoiceList( {
	options,
	selected,
	onPick,
	onClose,
	returnFocusRef,
} ) {
	const closeAndReturnFocus = () => {
		onClose();
		window.requestAnimationFrame( () => returnFocusRef.current?.focus() );
	};
	const onKeyDown = ( event ) => {
		if ( event.key === 'Escape' || event.key === 'ArrowLeft' ) {
			event.preventDefault();
			event.stopPropagation();
			closeAndReturnFocus();
			return;
		}
		if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
			event.preventDefault();
			event.stopPropagation();
			focusRelativeButton(
				event.currentTarget,
				event.currentTarget.ownerDocument.activeElement,
				event.key === 'ArrowDown' ? 1 : -1
			);
			return;
		}
		if ( event.key === 'Home' || event.key === 'End' ) {
			event.preventDefault();
			event.stopPropagation();
			focusEdgeButton(
				event.currentTarget,
				event.key === 'End' ? 'last' : 'first'
			);
		}
	};

	return (
		<ul
			className="cortext-format-submenu__list"
			role="menu"
			onKeyDown={ onKeyDown }
		>
			{ options.map( ( option ) => {
				const isSelected = selected === option;
				return (
					<li key={ option } role="none">
						<button
							type="button"
							role="menuitemradio"
							aria-checked={ isSelected }
							className={
								'cortext-format-submenu__row' +
								( isSelected ? ' is-selected' : '' )
							}
							onClick={ () => onPick( option ) }
						>
							<span className="cortext-format-submenu__row-label">
								{ CALCULATION_LABELS[ option ] }
							</span>
							<span className="cortext-table-calculation-menu__row-check">
								{ isSelected ? <Icon icon={ check } /> : null }
							</span>
						</button>
					</li>
				);
			} ) }
		</ul>
	);
}

function CalculationGroupRow( { group, isOpen, onOpen, rowRef } ) {
	const onKeyDown = ( event ) => {
		if ( event.key !== 'ArrowRight' ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onOpen();
	};

	return (
		<button
			ref={ rowRef }
			type="button"
			role="menuitem"
			className={
				'cortext-format-submenu__row' + ( isOpen ? ' is-open' : '' )
			}
			onClick={ onOpen }
			onKeyDown={ onKeyDown }
			onMouseEnter={ onOpen }
			aria-haspopup="menu"
			aria-expanded={ isOpen }
		>
			<span className="cortext-format-submenu__row-label">
				{ group.label }
			</span>
			<Icon
				icon={ chevronRight }
				className="cortext-format-submenu__row-chevron"
			/>
		</button>
	);
}

export default function TableCalculationMenu( {
	field,
	selected,
	onPick,
	onClose,
	onMouseEnter,
	onMouseLeave,
	anchor,
} ) {
	const validSelected = isCalculationAvailable( field, selected )
		? selected
		: null;
	const groups = useMemo(
		() => calculationGroupsForField( field ),
		[ field ]
	);
	const groupRefs = useRef( {} );
	const panelRef = useRef( null );
	const noneSelected = ! validSelected;
	const {
		submenuRef,
		placement: submenuPlacement,
		openKey: openGroup,
		open: openGroupAt,
	} = useSubmenuPlacement( anchor, panelRef );

	const pick = ( calculation ) => {
		onPick( calculation === CALCULATION_NONE ? null : calculation );
		onClose?.();
	};
	const onPanelKeyDown = ( event ) => {
		if ( event.key === 'Escape' || event.key === 'ArrowLeft' ) {
			event.preventDefault();
			event.stopPropagation();
			onClose?.();
			return;
		}
		if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
			event.preventDefault();
			event.stopPropagation();
			focusRelativeButton(
				event.currentTarget,
				event.currentTarget.ownerDocument.activeElement,
				event.key === 'ArrowDown' ? 1 : -1
			);
			return;
		}
		if ( event.key === 'Home' || event.key === 'End' ) {
			event.preventDefault();
			event.stopPropagation();
			focusEdgeButton(
				event.currentTarget,
				event.key === 'End' ? 'last' : 'first'
			);
		}
	};

	return (
		<div
			ref={ panelRef }
			className="cortext-format-submenu__panel cortext-table-calculation-menu"
			role="menu"
			tabIndex={ -1 }
			onKeyDown={ onPanelKeyDown }
			onMouseEnter={ onMouseEnter }
			onMouseLeave={ onMouseLeave }
		>
			<button
				type="button"
				role="menuitemradio"
				aria-checked={ noneSelected }
				className={
					'cortext-format-submenu__row' +
					( noneSelected ? ' is-selected' : '' )
				}
				onClick={ () => pick( CALCULATION_NONE ) }
			>
				<span className="cortext-format-submenu__row-label">
					{ __( 'None', 'cortext' ) }
				</span>
				<span className="cortext-table-calculation-menu__row-check">
					{ noneSelected ? <Icon icon={ check } /> : null }
				</span>
			</button>
			{ groups.map( ( group ) => {
				const isOpen = openGroup === group.id;
				return (
					<div key={ group.id }>
						<CalculationGroupRow
							group={ group }
							isOpen={ isOpen }
							onOpen={ () => openGroupAt( group.id ) }
							rowRef={ ( element ) => {
								groupRefs.current[ group.id ] = element;
							} }
						/>
						{ isOpen ? (
							<Popover
								anchor={ groupRefs.current[ group.id ] }
								placement={ submenuPlacement }
								offset={ 8 }
								shift
								resize={ false }
								onClose={ () => openGroupAt( null ) }
								className="cortext-format-submenu__flyout cortext-table-calculation-submenu__flyout"
							>
								{ /* This submenu is portaled out of the
								     panel, so the panel's mouseLeave fires
								     as soon as the cursor crosses into here.
								     Re-bind the hover-grace handlers so the
								     parent's close timer keeps pausing. */ }
								<div
									ref={ submenuRef }
									onMouseEnter={ onMouseEnter }
									onMouseLeave={ onMouseLeave }
								>
									<CalculationChoiceList
										options={ group.options }
										selected={ validSelected }
										onPick={ pick }
										onClose={ () => openGroupAt( null ) }
										returnFocusRef={ {
											current:
												groupRefs.current[ group.id ],
										} }
									/>
								</div>
							</Popover>
						) : null }
					</div>
				);
			} ) }
		</div>
	);
}

export function TableCalculationPopover( {
	anchor,
	field,
	selected,
	onPick,
	onClose,
	focusOnMount = false,
	onMouseEnter,
	onMouseLeave,
} ) {
	return (
		<Popover
			anchor={ anchor }
			placement="right-start"
			offset={ 8 }
			shift
			resize={ false }
			onClose={ onClose }
			focusOnMount={ focusOnMount }
			className="cortext-format-submenu cortext-table-calculation-submenu"
		>
			<TableCalculationMenu
				field={ field }
				selected={ selected }
				onPick={ onPick }
				onClose={ onClose }
				onMouseEnter={ onMouseEnter }
				onMouseLeave={ onMouseLeave }
				anchor={ anchor }
			/>
		</Popover>
	);
}
