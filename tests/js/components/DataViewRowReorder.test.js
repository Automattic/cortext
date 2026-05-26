import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';

const mockApiFetch = jest.fn();
jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: ( ...args ) => mockApiFetch( ...args ),
} ) );

jest.mock( '@wordpress/components', () => {
	const { createElement } = require( '@wordpress/element' );

	const ConfirmDialog = ( {
		children,
		onConfirm,
		onCancel,
		confirmButtonText,
	} ) =>
		createElement( 'div', { role: 'dialog' }, [
			children,
			createElement(
				'button',
				{ key: 'confirm', type: 'button', onClick: onConfirm },
				confirmButtonText
			),
			createElement(
				'button',
				{ key: 'cancel', type: 'button', onClick: onCancel },
				'Cancel'
			),
		] );

	return {
		__esModule: true,
		__experimentalConfirmDialog: ConfirmDialog,
	};
} );

const mockCreateErrorNotice = jest.fn();
jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => ( { createErrorNotice: mockCreateErrorNotice } ),
} ) );

jest.mock( '@wordpress/notices', () => ( {
	__esModule: true,
	store: {},
} ) );

let mockDndProps;
let mockDraggableListeners;
let mockDraggableRefs;
let mockResizeObserverInstances;
jest.mock( '@dnd-kit/core', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		DndContext: ( props ) => {
			mockDndProps = props;
			return createElement(
				'div',
				{ 'data-testid': 'dnd-context' },
				props.children
			);
		},
		DragOverlay: ( { children, zIndex } ) =>
			createElement(
				'div',
				{ 'data-testid': 'drag-overlay', style: { zIndex } },
				children
			),
		KeyboardSensor: jest.fn(),
		PointerSensor: jest.fn(),
		closestCenter: jest.fn(),
		pointerWithin: jest.fn(),
		useSensor: jest.fn( () => ( {} ) ),
		useSensors: jest.fn( ( ...sensors ) => sensors ),
		useDraggable: jest.fn( ( options ) => {
			const refs = {
				setActivatorNodeRef: jest.fn(),
				setNodeRef: jest.fn(),
			};
			mockDraggableRefs[ options.id ] = refs;
			return {
				attributes: {},
				listeners: mockDraggableListeners,
				setActivatorNodeRef: refs.setActivatorNodeRef,
				setNodeRef: refs.setNodeRef,
				isDragging: false,
			};
		} ),
		useDroppable: jest.fn( () => ( {
			setNodeRef: jest.fn(),
			isOver: false,
		} ) ),
	};
} );

import { useDraggable } from '@dnd-kit/core';

import DataViewRowReorder from '../../../src/components/DataViewRowReorder';

const rows = [
	{ id: 1, title: { raw: 'One' } },
	{ id: 2, title: { raw: 'Two' } },
	{ id: 3, title: { raw: 'Three' } },
];

beforeEach( () => {
	mockApiFetch.mockReset();
	mockApiFetch.mockResolvedValue( { reseeded: false } );
	mockCreateErrorNotice.mockClear();
	useDraggable.mockClear();
	mockDndProps = null;
	mockDraggableListeners = {};
	mockDraggableRefs = {};
	mockResizeObserverInstances = [];
	window.ResizeObserver = class {
		constructor( callback ) {
			this.callback = callback;
			this.observe = jest.fn();
			this.disconnect = jest.fn();
			mockResizeObserverInstances.push( this );
		}
	};
	window.requestAnimationFrame = ( callback ) => {
		callback();
		return 1;
	};
	window.cancelAnimationFrame = jest.fn();
} );

afterEach( () => {
	document.body.innerHTML = '';
	document.body.classList.remove(
		'cortext-row-dragging',
		'cortext-row-reorder-suppress-hover',
		'cortext-row-reorder-no-transition'
	);
} );

function createWrapper( heights = [ 40, 40, 40 ] ) {
	const wrapper = document.createElement( 'div' );
	wrapper.innerHTML = `
		<table class="dataviews-view-table">
			<tbody>
				<tr><td>One</td></tr>
				<tr><td>Two</td></tr>
				<tr><td>Three</td></tr>
			</tbody>
		</table>
	`;
	let top = 0;
	Array.from( wrapper.querySelectorAll( 'tr' ) ).forEach( ( row, index ) => {
		const height = heights[ index ] ?? 40;
		const rowTop = top;
		top += height;
		row.getClientRects = () => [ {} ];
		row.getBoundingClientRect = () => ( {
			top: rowTop,
			left: 10,
			width: 320,
			height,
			right: 330,
			bottom: rowTop + height,
		} );
	} );
	document.body.appendChild( wrapper );
	return wrapper;
}

function draggableDataFor( rowId ) {
	return (
		[ ...useDraggable.mock.calls ]
			.reverse()
			.find( ( [ options ] ) => options?.id === `row:${ rowId }` )?.[ 0 ]
			?.data ?? { rowId, label: `Row ${ rowId }` }
	);
}

async function renderReorder( props = {}, options = {} ) {
	const wrapperRef = { current: createWrapper( options.rowHeights ) };
	const onChangeView = jest.fn();
	const onReordered = jest.fn();
	const mutateRows = jest.fn();
	const componentProps = {
		wrapperRef,
		view: {
			type: 'table',
			sort: null,
		},
		onChangeView,
		collectionId: 7,
		rows,
		data: rows,
		mutateRows,
		onReordered,
		...props,
	};
	const renderResult = render( <DataViewRowReorder { ...componentProps } /> );
	await waitFor( () =>
		expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument()
	);
	return {
		onChangeView,
		onReordered,
		mutateRows,
		wrapperRef,
		rerender: ( nextProps = {} ) =>
			renderResult.rerender(
				<DataViewRowReorder { ...componentProps } { ...nextProps } />
			),
	};
}

async function renderReorderInParent( parentProps = {} ) {
	const wrapperRef = { current: createWrapper() };
	render(
		<div { ...parentProps }>
			<DataViewRowReorder
				wrapperRef={ wrapperRef }
				view={ {
					type: 'table',
					sort: null,
				} }
				onChangeView={ jest.fn() }
				collectionId={ 7 }
				rows={ rows }
				onReordered={ jest.fn() }
			/>
		</div>
	);
	await waitFor( () =>
		expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument()
	);
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );
	return { promise, resolve, reject };
}

function gapDrop( insertionIndex, beforeId, afterId ) {
	return {
		type: 'gap',
		insertionIndex,
		beforeId,
		afterId,
	};
}

function dragEnd( draggedId, drop ) {
	act( () => {
		mockDndProps.onDragStart( {
			active: {
				data: {
					current: { rowId: draggedId, label: `Row ${ draggedId }` },
				},
			},
		} );
	} );
	act( () => {
		mockDndProps.onDragEnd( {
			active: {
				data: {
					current: { rowId: draggedId, label: `Row ${ draggedId }` },
				},
			},
			over: {
				data: {
					current: drop,
				},
			},
		} );
	} );
}

function dragStart( draggedId ) {
	act( () => {
		mockDndProps.onDragStart( {
			active: {
				data: {
					current: { rowId: draggedId, label: `Row ${ draggedId }` },
				},
			},
		} );
	} );
}

function dragOver( drop ) {
	act( () => {
		mockDndProps.onDragOver( {
			over: {
				data: {
					current: drop,
				},
			},
		} );
	} );
}

describe( 'DataViewRowReorder', () => {
	it( 'shows a row preview while dragging', async () => {
		await renderReorder();

		const titleSource = document.createElement( 'td' );
		titleSource.className = 'dataviews-view-table__cell';
		titleSource.textContent = 'Two';
		const statusSource = document.createElement( 'td' );
		statusSource.className = 'status-cell';
		statusSource.innerHTML =
			'<span class="cortext-test-status-chip">Published</span>';

		act( () => {
			mockDndProps.onDragStart( {
				active: {
					data: {
						current: {
							rowId: 2,
							label: 'Two',
							previewCells: [
								{ source: titleSource, text: 'Two' },
								{ source: statusSource, text: 'Published' },
							],
							previewDensity: 'comfortable',
							rect: { width: 480 },
						},
					},
				},
			} );
		} );

		const overlay = screen.getByTestId( 'drag-overlay' );
		expect( overlay ).toHaveStyle( {
			zIndex: '100002',
		} );
		expect(
			overlay.querySelector( '.cortext-row-drag-preview' )
		).toHaveClass( 'cortext-row-drag-preview--comfortable' );
		expect(
			overlay.querySelector( '.cortext-row-drag-preview__table' )
		).not.toBeInTheDocument();
		expect(
			within( overlay )
				.getByText( 'Two' )
				.closest( '.cortext-row-drag-preview__cell' )
		).toHaveClass( 'cortext-row-drag-preview__cell--primary' );
		expect( within( overlay ).getByText( 'Published' ) ).toHaveClass(
			'cortext-test-status-chip'
		);
		expect(
			within( overlay )
				.getByText( 'Published' )
				.closest( '.cortext-row-drag-preview__cell' )
		).toBeInTheDocument();
	} );

	it( 'builds the table preview from visible row cells and blank chrome', async () => {
		// Mirrors the real DataViews DOM: a checkbox column, visible fields,
		// off-screen cells that still exist in the table, and a sticky actions
		// cell at the right edge. The preview should clone checkbox + field
		// content, but keep sticky chrome as blank width so the row underneath
		// never shows through.
		const wrapper = document.createElement( 'div' );
		wrapper.innerHTML = `
			<div class="dataviews-wrapper">
				<table class="dataviews-view-table">
					<tbody>
						<tr>
							<td class="dataviews-view-table__checkbox-column"><input type="checkbox" /></td>
							<td><span>Title</span></td>
							<td><span>Status</span></td>
							<td><span>Owner</span></td>
							<td><span>Updated</span></td>
							<td><span>Notes</span></td>
							<td><span>Rock</span></td>
							<td>0</td>
							<td>Hidden description</td>
							<td class="dataviews-view-table__actions-column dataviews-view-table__actions-column--sticky"><button type="button">0</button></td>
						</tr>
					</tbody>
				</table>
			</div>
		`;
		const dataviewsWrapper = wrapper.querySelector( '.dataviews-wrapper' );
		// The dataviews-wrapper owns the scroll; cells past its right edge
		// are scrolled out of view and should not appear in the preview.
		dataviewsWrapper.getBoundingClientRect = () => ( {
			top: 0,
			left: 10,
			width: 712,
			height: 40,
			right: 722,
			bottom: 40,
		} );
		const rowElement = wrapper.querySelector( 'tr' );
		rowElement.getClientRects = () => [ {} ];
		rowElement.getBoundingClientRect = () => ( {
			top: 0,
			left: 10,
			width: 1200,
			height: 40,
			right: 1210,
			bottom: 40,
		} );
		const rects = [
			[ 10, 32 ],
			[ 42, 118 ],
			[ 160, 122 ],
			[ 282, 126 ],
			[ 408, 130 ],
			[ 538, 134 ],
			[ 672, 90 ],
			[ 760, 100 ],
			[ 860, 200 ],
			[ 682, 41 ],
		];
		rects.forEach( ( [ left, width ], index ) => {
			const cell = rowElement.children[ index ];
			cell.getBoundingClientRect = () => ( {
				top: 0,
				left,
				width,
				height: 40,
				right: left + width,
				bottom: 40,
			} );
		} );
		document.body.appendChild( wrapper );

		render(
			<DataViewRowReorder
				wrapperRef={ { current: wrapper } }
				view={ {
					type: 'table',
					sort: null,
					fields: [
						'title',
						'status',
						'owner',
						'updated',
						'notes',
						'genre',
						'length',
					],
				} }
				onChangeView={ jest.fn() }
				collectionId={ 7 }
				rows={ [ rows[ 0 ] ] }
				onReordered={ jest.fn() }
			/>
		);
		await waitFor( () =>
			expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument()
		);

		act( () => {
			mockDndProps.onDragStart( {
				active: {
					data: { current: draggableDataFor( 1 ) },
				},
			} );
		} );

		const preview = screen
			.getByTestId( 'drag-overlay' )
			.querySelector( '.cortext-row-drag-preview' );
		const previewCells = preview.querySelectorAll(
			'.cortext-row-drag-preview__cell'
		);

		expect( preview ).toHaveStyle( { width: '712px' } );
		expect( previewCells ).toHaveLength( 8 );
		expect( previewCells[ 0 ] ).toHaveClass(
			'cortext-row-drag-preview__cell--checkbox'
		);
		expect( previewCells[ 0 ] ).toHaveStyle( { flex: '0 0 32px' } );
		expect(
			previewCells[ 0 ].querySelector( 'input[type="checkbox"]' )
		).toBeInTheDocument();
		expect( previewCells[ 1 ] ).toHaveClass(
			'cortext-row-drag-preview__cell--primary'
		);
		expect( previewCells[ 1 ] ).toHaveStyle( { flex: '0 0 118px' } );
		expect( previewCells[ 1 ] ).toHaveTextContent( 'Title' );
		expect( previewCells[ 5 ] ).toHaveStyle( { flex: '0 0 134px' } );
		expect( previewCells[ 5 ] ).toHaveTextContent( 'Notes' );
		expect( previewCells[ 6 ] ).toHaveClass(
			'cortext-row-drag-preview__cell--spacer'
		);
		expect( previewCells[ 6 ] ).toHaveStyle( { flex: '0 0 10px' } );
		expect( previewCells[ 7 ] ).toHaveClass(
			'cortext-row-drag-preview__cell--actions'
		);
		expect( previewCells[ 7 ] ).toHaveStyle( { flex: '0 0 40px' } );
		expect( previewCells[ 7 ] ).toBeEmptyDOMElement();
		expect( preview.querySelector( 'button' ) ).not.toBeInTheDocument();
		expect( preview.textContent ).toContain( 'Notes' );
		expect( preview.textContent ).not.toContain( 'Hidden description' );
		expect( preview.textContent ).not.toContain( 'Rock' );
		expect( preview.textContent ).not.toMatch( /^0|0$/ );
	} );

	it( 'remeasures rows after the embedded block is resized', async () => {
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const frames = [];
		window.requestAnimationFrame = ( callback ) => {
			frames.push( callback );
			return frames.length;
		};
		const wrapper = document.createElement( 'div' );
		wrapper.innerHTML = `
			<div class="dataviews-wrapper">
				<table class="dataviews-view-table">
					<tbody>
						<tr>
							<td><span>Title</span></td>
							<td><span>Author</span></td>
							<td class="dataviews-view-table__actions-column"><button type="button">0</button></td>
						</tr>
					</tbody>
				</table>
			</div>
		`;
		const dataviewsWrapper = wrapper.querySelector( '.dataviews-wrapper' );
		let wrapperWidth = 720;
		dataviewsWrapper.getBoundingClientRect = () => ( {
			top: 0,
			left: 10,
			width: wrapperWidth,
			height: 40,
			right: 10 + wrapperWidth,
			bottom: 40,
		} );
		const rowElement = wrapper.querySelector( 'tr' );
		rowElement.getClientRects = () => [ {} ];
		rowElement.getBoundingClientRect = () => ( {
			top: 0,
			left: 10,
			width: 1200,
			height: 40,
			right: 1210,
			bottom: 40,
		} );
		[
			[ 10, 280 ],
			[ 290, 220 ],
			[ 650, 80 ],
		].forEach( ( [ left, width ], index ) => {
			const cell = rowElement.children[ index ];
			cell.getBoundingClientRect = () => ( {
				top: 0,
				left,
				width,
				height: 40,
				right: left + width,
				bottom: 40,
			} );
		} );
		document.body.appendChild( wrapper );

		render(
			<DataViewRowReorder
				wrapperRef={ { current: wrapper } }
				view={ {
					type: 'table',
					sort: null,
					fields: [ 'title', 'author' ],
				} }
				onChangeView={ jest.fn() }
				collectionId={ 7 }
				rows={ [ rows[ 0 ] ] }
				onReordered={ jest.fn() }
			/>
		);
		act( () => {
			frames.splice( 0 ).forEach( ( callback ) => callback() );
		} );
		await waitFor( () =>
			expect( draggableDataFor( 1 ).previewWidth ).toBe( 720 )
		);

		act( () => {
			wrapperWidth = 420;
			for ( const observer of mockResizeObserverInstances ) {
				observer.callback();
			}
		} );
		act( () => {
			frames.splice( 0 ).forEach( ( callback ) => callback() );
		} );

		await waitFor( () =>
			expect( draggableDataFor( 1 ).previewWidth ).toBe( 420 )
		);
		expect( draggableDataFor( 1 ).rect ).toEqual(
			expect.objectContaining( {
				left: 10,
				width: 420,
			} )
		);
		window.requestAnimationFrame = originalRequestAnimationFrame;
	} );

	it( 'mounts row drag handles inside the row cell', async () => {
		await renderReorder();

		const handle = screen.getByRole( 'button', {
			name: 'Reorder row: One',
		} );

		expect( handle.parentElement?.tagName ).toBe( 'TD' );
		expect( handle.parentElement ).toHaveClass(
			'cortext-row-reorder-cell'
		);
	} );

	it( 'uses the row as the draggable node and the handle as the activator', async () => {
		await renderReorder();

		const handle = screen.getByRole( 'button', {
			name: 'Reorder row: One',
		} );
		const renderedTableRows = document.querySelectorAll( 'tr' );

		expect( mockDraggableRefs[ 'row:1' ].setNodeRef ).toHaveBeenCalledWith(
			renderedTableRows[ 0 ]
		);
		expect(
			mockDraggableRefs[ 'row:1' ].setActivatorNodeRef
		).toHaveBeenCalledWith( handle );
	} );

	it( 'uses linear gap drop zones for table rows', async () => {
		await renderReorder();

		expect(
			document.querySelectorAll( '.cortext-row-drop-indicator--gap' )
		).toHaveLength( 4 );
		expect(
			document.querySelectorAll( '.cortext-row-drop-indicator--before' )
		).toHaveLength( 0 );

		dragStart( 2 );

		await waitFor( () =>
			expect(
				document.querySelectorAll( '.cortext-row-drop-indicator--gap' )
			).toHaveLength( 2 )
		);
	} );

	it( 'caps gap hitboxes next to tall rows', async () => {
		await renderReorder( {}, { rowHeights: [ 40, 160, 40 ] } );

		const gapBetweenShortAndTall = document.querySelectorAll(
			'.cortext-row-drop-indicator--gap'
		)[ 1 ];

		expect( gapBetweenShortAndTall ).toHaveStyle( {
			top: '20px',
			height: '60px',
		} );
		expect(
			gapBetweenShortAndTall.style.getPropertyValue(
				'--cortext-row-drop-line-top'
			)
		).toBe( '20px' );
	} );

	it( 'extends edge gap hitboxes beyond the first and last rows', async () => {
		await renderReorder( {}, { rowHeights: [ 40, 40, 40 ] } );

		const gaps = document.querySelectorAll(
			'.cortext-row-drop-indicator--gap'
		);

		expect( gaps[ 0 ] ).toHaveStyle( {
			top: '-40px',
			height: '60px',
		} );
		expect( gaps[ 3 ] ).toHaveStyle( {
			top: '100px',
			height: '60px',
		} );
	} );

	it( 'covers balanced row gaps without leaving a dead band', async () => {
		await renderReorder( {}, { rowHeights: [ 64, 64, 64 ] } );

		const gapBetweenBalancedRows = document.querySelectorAll(
			'.cortext-row-drop-indicator--gap'
		)[ 1 ];

		expect( gapBetweenBalancedRows ).toHaveStyle( {
			top: '32px',
			height: '64px',
		} );
		expect(
			gapBetweenBalancedRows.style.getPropertyValue(
				'--cortext-row-drop-line-top'
			)
		).toBe( '32px' );
	} );

	it( 'uses the visible table wrapper width for gap hitboxes', async () => {
		const wrapper = document.createElement( 'div' );
		wrapper.className = 'dataviews-wrapper';
		wrapper.innerHTML = `
			<table class="dataviews-view-table">
				<tbody>
					<tr><td>One</td></tr>
					<tr><td>Two</td></tr>
					<tr><td>Three</td></tr>
				</tbody>
			</table>
		`;
		wrapper.getBoundingClientRect = () => ( {
			top: 0,
			left: 0,
			width: 500,
			height: 120,
			right: 500,
			bottom: 120,
		} );
		Array.from( wrapper.querySelectorAll( 'tr' ) ).forEach(
			( row, index ) => {
				const top = index * 40;
				row.getClientRects = () => [ {} ];
				row.getBoundingClientRect = () => ( {
					top,
					left: 44,
					width: 320,
					height: 40,
					right: 364,
					bottom: top + 40,
				} );
			}
		);
		document.body.appendChild( wrapper );

		render(
			<DataViewRowReorder
				wrapperRef={ { current: wrapper } }
				view={ { type: 'table', sort: null } }
				onChangeView={ jest.fn() }
				collectionId={ 7 }
				rows={ rows }
				onReordered={ jest.fn() }
			/>
		);
		await waitFor( () =>
			expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument()
		);

		const gapBetweenRows = document.querySelectorAll(
			'.cortext-row-drop-indicator--gap'
		)[ 1 ];

		expect( gapBetweenRows ).toHaveStyle( {
			left: '0px',
			width: '500px',
		} );
	} );

	it( 'displaces rows to open a gap while dragging upward', async () => {
		await renderReorder();
		const renderedTableRows = document.querySelectorAll( 'tr' );
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const frames = [];
		window.requestAnimationFrame = ( callback ) => {
			frames.push( callback );
			return frames.length;
		};

		try {
			dragStart( 3 );
			dragOver( gapDrop( 0, 1, null ) );

			expect( renderedTableRows[ 0 ] ).toHaveStyle( {
				transform: 'translate3d(0, 0, 0)',
			} );

			act( () => {
				frames.splice( 0 ).forEach( ( callback ) => callback() );
			} );

			await waitFor( () =>
				expect( renderedTableRows[ 0 ] ).toHaveStyle( {
					transform: 'translate3d(0, 40px, 0)',
				} )
			);
		} finally {
			window.requestAnimationFrame = originalRequestAnimationFrame;
		}

		expect( renderedTableRows[ 1 ] ).toHaveStyle( {
			transform: 'translate3d(0, 40px, 0)',
		} );
		expect( renderedTableRows[ 2 ] ).toHaveClass(
			'cortext-row-reorder-target--active'
		);

		act( () => {
			mockDndProps.onDragCancel();
		} );

		await waitFor( () =>
			expect( renderedTableRows[ 0 ].style.transform ).toBe( '' )
		);
		expect( renderedTableRows[ 0 ] ).not.toHaveClass(
			'cortext-row-reorder-target--displaced'
		);
		expect( renderedTableRows[ 2 ] ).not.toHaveClass(
			'cortext-row-reorder-target--active'
		);
	} );

	it( 'displaces rows to open a gap while dragging downward', async () => {
		await renderReorder();
		const renderedTableRows = document.querySelectorAll( 'tr' );

		dragStart( 1 );
		dragOver( gapDrop( 3, null, 3 ) );

		await waitFor( () =>
			expect( renderedTableRows[ 1 ] ).toHaveStyle( {
				transform: 'translate3d(0, -40px, 0)',
			} )
		);
		expect( renderedTableRows[ 2 ] ).toHaveStyle( {
			transform: 'translate3d(0, -40px, 0)',
		} );
		expect( renderedTableRows[ 0 ] ).toHaveClass(
			'cortext-row-reorder-target--active'
		);
	} );

	it( 'uses the dragged row height when displacing taller rows', async () => {
		await renderReorder( {}, { rowHeights: [ 40, 100, 40 ] } );
		const renderedTableRows = document.querySelectorAll( 'tr' );

		dragStart( 3 );
		dragOver( gapDrop( 0, 1, null ) );

		await waitFor( () =>
			expect( renderedTableRows[ 0 ] ).toHaveStyle( {
				transform: 'translate3d(0, 40px, 0)',
			} )
		);
		expect( renderedTableRows[ 1 ] ).toHaveStyle( {
			transform: 'translate3d(0, 40px, 0)',
		} );
	} );

	it( 'applies an optimistic reorder so the new order is visible immediately', async () => {
		// `mutateRows` reorders `data` synchronously before the API responds.
		// The component no longer freezes transforms; the DOM reorder via the
		// parent's new `rows` prop is what the user sees.
		let resolveRequest;
		mockApiFetch.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				resolveRequest = resolve;
			} )
		);
		const { onReordered, mutateRows } = await renderReorder();

		dragEnd( 1, gapDrop( 3, null, 3 ) );

		expect( mutateRows ).toHaveBeenCalledTimes( 1 );
		const nextData = mutateRows.mock.calls[ 0 ][ 0 ];
		expect( nextData.map( ( r ) => r.id ) ).toEqual( [ 2, 3, 1 ] );
		expect( document.body ).not.toHaveClass( 'cortext-row-dragging' );
		expect( onReordered ).not.toHaveBeenCalled();

		await act( async () => {
			resolveRequest( { reseeded: false } );
			await Promise.resolve();
		} );
		expect( onReordered ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'reverts the optimistic mutation when the API rejects', async () => {
		mockApiFetch.mockRejectedValueOnce( new Error( 'Nope' ) );
		const { mutateRows, onReordered } = await renderReorder();

		dragEnd( 1, gapDrop( 3, null, 3 ) );

		await waitFor( () =>
			expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
				"Couldn't move the row.",
				{
					id: 'cortext-row-reorder-failed',
					type: 'snackbar',
				}
			)
		);
		// First call applies the optimistic reorder, second call rolls back to
		// the snapshot we took before the mutation.
		expect( mutateRows ).toHaveBeenCalledTimes( 2 );
		expect( mutateRows.mock.calls[ 1 ][ 0 ] ).toBe( rows );
		expect( onReordered ).not.toHaveBeenCalled();
	} );

	it( 'does not mount row reorder for grid layout yet', () => {
		const wrapper = createWrapper();
		render(
			<DataViewRowReorder
				wrapperRef={ { current: wrapper } }
				view={ {
					type: 'grid',
					sort: null,
				} }
				onChangeView={ jest.fn() }
				collectionId={ 7 }
				rows={ rows }
				onReordered={ jest.fn() }
			/>
		);
		expect( screen.queryByTestId( 'dnd-context' ) ).not.toBeInTheDocument();
	} );

	it( 'posts immediately when there is no explicit sort', async () => {
		const { onChangeView, onReordered } = await renderReorder();

		dragEnd( 1, gapDrop( 3, null, 3 ) );

		await waitFor( () =>
			expect( mockApiFetch ).toHaveBeenCalledTimes( 1 )
		);
		expect( mockApiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/7/rows/1/reorder',
			method: 'POST',
			data: {
				before_id: null,
				after_id: 3,
				current_sort: null,
			},
		} );
		expect( onChangeView ).not.toHaveBeenCalled();
		expect( onReordered ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'confirms before committing a reorder under an explicit sort', async () => {
		const request = deferred();
		mockApiFetch.mockReturnValueOnce( request.promise );
		const view = {
			type: 'table',
			sort: { field: 'title', direction: 'asc' },
		};
		const { onChangeView, mutateRows } = await renderReorder( { view } );

		dragEnd( 3, gapDrop( 0, 1, null ) );

		expect(
			screen.getByText(
				'Rows will stay where you dropped them, and the current sort will be cleared.'
			)
		).toBeInTheDocument();
		expect( mockApiFetch ).not.toHaveBeenCalled();
		expect( mutateRows ).not.toHaveBeenCalled();
		expect( onChangeView ).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Keep this order' } )
		);

		// Confirming clears the sort, runs the optimistic reorder, and posts.
		await waitFor( () =>
			expect( mockApiFetch ).toHaveBeenCalledTimes( 1 )
		);
		expect( onChangeView ).toHaveBeenCalledWith( {
			type: 'table',
			sort: null,
		} );
		expect( mutateRows ).toHaveBeenCalledTimes( 1 );
		expect( mutateRows.mock.calls[ 0 ][ 0 ].map( ( r ) => r.id ) ).toEqual(
			[ 3, 1, 2 ]
		);
		expect( mockApiFetch.mock.calls[ 0 ][ 0 ].data ).toEqual( {
			before_id: 1,
			after_id: null,
			current_sort: { field: 'title', direction: 'asc' },
		} );

		await act( async () => {
			request.resolve( { reseeded: false } );
			await request.promise;
		} );
		// Server confirms; we don't need a second `onChangeView` because the
		// sort was already cleared at commit time.
		expect( onChangeView ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'skips confirmation when there is no current sort', async () => {
		const view = {
			type: 'table',
			sort: null,
		};
		const { onChangeView } = await renderReorder( { view } );

		dragEnd( 3, gapDrop( 0, 1, null ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect( mockApiFetch ).toHaveBeenCalledTimes( 1 )
		);
		expect( onChangeView ).not.toHaveBeenCalled();
		expect( mockApiFetch.mock.calls[ 0 ][ 0 ].data ).toEqual( {
			before_id: 1,
			after_id: null,
			current_sort: null,
		} );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'does nothing when clearing a field sort is cancelled', async () => {
		const view = {
			type: 'table',
			sort: { field: 'title', direction: 'asc' },
		};
		const { onChangeView } = await renderReorder( { view } );
		const renderedTableRows = document.querySelectorAll( 'tr' );

		dragEnd( 3, gapDrop( 0, 1, null ) );
		expect( renderedTableRows[ 0 ].style.transform ).toBe( '' );
		expect( renderedTableRows[ 1 ].style.transform ).toBe( '' );
		expect( renderedTableRows[ 2 ].style.transform ).toBe( '' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( onChangeView ).not.toHaveBeenCalled();
		expect( mockApiFetch ).not.toHaveBeenCalled();
		await waitFor( () =>
			expect( renderedTableRows[ 2 ].style.transform ).toBe( '' )
		);
		expect( renderedTableRows[ 2 ] ).not.toHaveClass(
			'cortext-row-reorder-target--displaced'
		);
	} );

	it( 'creates an error notice when the reorder request fails', async () => {
		mockApiFetch.mockRejectedValueOnce( new Error( 'Nope' ) );
		const { onReordered } = await renderReorder();

		dragEnd( 1, gapDrop( 3, null, 3 ) );

		await waitFor( () =>
			expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
				"Couldn't move the row.",
				{
					id: 'cortext-row-reorder-failed',
					type: 'snackbar',
				}
			)
		);
		expect( onReordered ).not.toHaveBeenCalled();
	} );

	it( 'restores the sort when a confirmed reorder request fails', async () => {
		mockApiFetch.mockRejectedValueOnce( new Error( 'Nope' ) );
		const sort = { field: 'title', direction: 'asc' };
		const view = { type: 'table', sort };
		const { onChangeView, onReordered, mutateRows } = await renderReorder( {
			view,
		} );

		dragEnd( 3, gapDrop( 0, 1, null ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Keep this order' } )
		);

		await waitFor( () =>
			expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
				"Couldn't move the row.",
				{
					id: 'cortext-row-reorder-failed',
					type: 'snackbar',
				}
			)
		);
		// onChangeView fires twice: first to clear the sort optimistically,
		// then to restore the original sort when the request rejects.
		expect( onChangeView ).toHaveBeenCalledTimes( 2 );
		expect( onChangeView.mock.calls[ 0 ][ 0 ].sort ).toBeNull();
		expect( onChangeView.mock.calls[ 1 ][ 0 ].sort ).toEqual( sort );
		// The reorder is rolled back too: first mutation applies the move,
		// second mutation restores the snapshot we took before it.
		expect( mutateRows ).toHaveBeenCalledTimes( 2 );
		expect( mutateRows.mock.calls[ 1 ][ 0 ] ).toBe( rows );
		expect( onReordered ).not.toHaveBeenCalled();
	} );

	it( 'does not bubble drag-handle pointer events to the block surface', async () => {
		const onPointerDown = jest.fn();
		const onParentPointerDown = jest.fn();
		mockDraggableListeners = { onPointerDown };

		await renderReorderInParent( { onPointerDown: onParentPointerDown } );

		fireEvent.pointerDown(
			screen.getByRole( 'button', { name: 'Reorder row: One' } )
		);

		expect( onPointerDown ).toHaveBeenCalledTimes( 1 );
		expect( onParentPointerDown ).not.toHaveBeenCalled();
	} );

	it( 'suppresses row hover before dnd-kit starts dragging', async () => {
		mockDraggableListeners = { onPointerDown: jest.fn() };

		await renderReorder();

		fireEvent.pointerDown(
			screen.getByRole( 'button', { name: 'Reorder row: One' } )
		);

		expect( document.body ).toHaveClass(
			'cortext-row-reorder-suppress-hover'
		);
		expect( document.body ).not.toHaveClass( 'cortext-row-dragging' );
	} );
} );
