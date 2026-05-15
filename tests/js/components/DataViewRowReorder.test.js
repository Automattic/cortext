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
		useDraggable: jest.fn( () => ( {
			attributes: {},
			listeners: mockDraggableListeners,
			setActivatorNodeRef: jest.fn(),
			setNodeRef: jest.fn(),
			isDragging: false,
		} ) ),
		useDroppable: jest.fn( () => ( {
			setNodeRef: jest.fn(),
			isOver: false,
		} ) ),
	};
} );

import DataViewRowReorder from '../../../src/components/DataViewRowReorder';
import { ROW_DROP_AFTER } from '../../../src/components/row-reorder';

const rows = [
	{ id: 1, title: { raw: 'One' } },
	{ id: 2, title: { raw: 'Two' } },
	{ id: 3, title: { raw: 'Three' } },
];

beforeEach( () => {
	mockApiFetch.mockReset();
	mockApiFetch.mockResolvedValue( { reseeded: false } );
	mockCreateErrorNotice.mockClear();
	mockDndProps = null;
	mockDraggableListeners = {};
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

function createWrapper() {
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
	Array.from( wrapper.querySelectorAll( 'tr' ) ).forEach( ( row, index ) => {
		row.getClientRects = () => [ {} ];
		row.getBoundingClientRect = () => ( {
			top: 40 * index,
			left: 10,
			width: 320,
			height: 40,
			right: 330,
			bottom: 40 * ( index + 1 ),
		} );
	} );
	document.body.appendChild( wrapper );
	return wrapper;
}

async function renderReorder( props = {} ) {
	const wrapperRef = { current: createWrapper() };
	const onChangeView = jest.fn();
	const onReordered = jest.fn();
	const componentProps = {
		wrapperRef,
		view: {
			type: 'table',
			sort: null,
		},
		onChangeView,
		collectionId: 7,
		rows,
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

	it( 'freezes the dropped position until refreshed row order renders', async () => {
		let resolveRequest;
		mockApiFetch.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				resolveRequest = resolve;
			} )
		);
		const { onReordered, rerender } = await renderReorder();
		const renderedTableRows = document.querySelectorAll( 'tr' );

		dragStart( 1 );
		dragOver( gapDrop( 3, null, 3 ) );

		await waitFor( () =>
			expect( renderedTableRows[ 1 ] ).toHaveStyle( {
				transform: 'translate3d(0, -40px, 0)',
			} )
		);

		act( () => {
			mockDndProps.onDragEnd( {
				active: {
					data: {
						current: { rowId: 1, label: 'Row 1' },
					},
				},
				over: {
					data: {
						current: gapDrop( 3, null, 3 ),
					},
				},
			} );
		} );

		expect( renderedTableRows[ 1 ] ).toHaveStyle( {
			transform: 'translate3d(0, -40px, 0)',
		} );
		expect( renderedTableRows[ 2 ] ).toHaveStyle( {
			transform: 'translate3d(0, -40px, 0)',
		} );
		expect( renderedTableRows[ 0 ] ).toHaveStyle( {
			transform: 'translate3d(0, 80px, 0)',
		} );
		expect( renderedTableRows[ 0 ] ).toHaveClass(
			'cortext-row-reorder-target--displaced'
		);
		expect( renderedTableRows[ 1 ] ).not.toHaveClass(
			'cortext-row-reorder-target--active'
		);
		expect( document.body ).not.toHaveClass( 'cortext-row-dragging' );
		expect( onReordered ).not.toHaveBeenCalled();

		await act( async () => {
			resolveRequest( { reseeded: false } );
			await Promise.resolve();
		} );
		expect( onReordered ).toHaveBeenCalledTimes( 1 );

		act( () => {
			rerender( { rows: [ rows[ 1 ], rows[ 2 ], rows[ 0 ] ] } );
		} );

		await waitFor( () =>
			expect( renderedTableRows[ 0 ].style.transform ).toBe( '' )
		);
		expect( renderedTableRows[ 0 ] ).not.toHaveClass(
			'cortext-row-reorder-target--displaced'
		);
	} );

	it( 'animates rows to their next grid position', async () => {
		const wrapper = createWrapper();
		wrapper.innerHTML = `
			<ul class="dataviews-view-grid">
				<li>One</li>
				<li>Two</li>
				<li>Three</li>
			</ul>
		`;
		Array.from( wrapper.querySelectorAll( 'li' ) ).forEach(
			( item, index ) => {
				item.getClientRects = () => [ {} ];
				item.getBoundingClientRect = () => ( {
					top: index > 1 ? 50 : 0,
					left: index % 2 === 0 ? 10 : 170,
					width: 140,
					height: 40,
					right: index % 2 === 0 ? 150 : 310,
					bottom: index > 1 ? 90 : 40,
				} );
			}
		);
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
		await waitFor( () =>
			expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument()
		);
		const renderedGridRows = wrapper.querySelectorAll( 'li' );

		dragStart( 1 );
		dragOver( { rowId: 3, zone: ROW_DROP_AFTER } );

		await waitFor( () =>
			expect( renderedGridRows[ 1 ] ).toHaveStyle( {
				transform: 'translate3d(-160px, 0, 0)',
			} )
		);
		expect( renderedGridRows[ 2 ] ).toHaveStyle( {
			transform: 'translate3d(160px, -50px, 0)',
		} );
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

	it( 'keeps sorted rows in place until the sort is cleared', async () => {
		const request = deferred();
		mockApiFetch.mockReturnValueOnce( request.promise );
		const view = {
			type: 'table',
			sort: { field: 'title', direction: 'asc' },
		};
		const { onChangeView } = await renderReorder( { view } );
		const renderedTableRows = document.querySelectorAll( 'tr' );

		dragEnd( 3, gapDrop( 0, 1, null ) );

		expect(
			screen.getByText(
				'This will clear the current sort and keep rows where you drop them.'
			)
		).toBeInTheDocument();
		expect( mockApiFetch ).not.toHaveBeenCalled();
		expect( renderedTableRows[ 0 ].style.transform ).toBe( '' );
		expect( renderedTableRows[ 1 ].style.transform ).toBe( '' );
		expect( renderedTableRows[ 2 ].style.transform ).toBe( '' );
		expect( renderedTableRows[ 0 ] ).not.toHaveClass(
			'cortext-row-reorder-target--displaced'
		);
		expect( renderedTableRows[ 2 ] ).not.toHaveClass(
			'cortext-row-reorder-target--active'
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Keep this order' } )
		);

		await waitFor( () =>
			expect( mockApiFetch ).toHaveBeenCalledTimes( 1 )
		);
		expect( onChangeView ).not.toHaveBeenCalled();
		expect( mockApiFetch.mock.calls[ 0 ][ 0 ].data ).toEqual( {
			before_id: 1,
			after_id: null,
			current_sort: { field: 'title', direction: 'asc' },
		} );
		expect( renderedTableRows[ 0 ] ).toHaveStyle( {
			transform: 'translate3d(0, 40px, 0)',
		} );
		expect( renderedTableRows[ 1 ] ).toHaveStyle( {
			transform: 'translate3d(0, 40px, 0)',
		} );
		expect( renderedTableRows[ 2 ] ).toHaveStyle( {
			transform: 'translate3d(0, -80px, 0)',
		} );
		expect( renderedTableRows[ 2 ] ).not.toHaveClass(
			'cortext-row-reorder-target--active'
		);
		expect( renderedTableRows[ 2 ] ).toHaveClass(
			'cortext-row-reorder-target--displaced'
		);
		await act( async () => {
			request.resolve( { reseeded: false } );
			await request.promise;
		} );
		await waitFor( () =>
			expect( onChangeView ).toHaveBeenCalledWith( {
				type: 'table',
				sort: null,
			} )
		);
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

	it( 'keeps the current sort when a confirmed reorder request fails', async () => {
		mockApiFetch.mockRejectedValueOnce( new Error( 'Nope' ) );
		const view = {
			type: 'table',
			sort: { field: 'title', direction: 'asc' },
		};
		const { onChangeView, onReordered } = await renderReorder( { view } );

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
		expect( onChangeView ).not.toHaveBeenCalled();
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
