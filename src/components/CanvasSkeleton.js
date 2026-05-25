import './CanvasSkeleton.scss';

// Suspense fallback while the editor chunk loads on the first document
// open. Mimics the editor's vertical rhythm (centered title strip + a few
// content lines) so the swap to the real editor doesn't reflow the pane.
export default function CanvasSkeleton() {
	return (
		<div className="cortext-canvas-skeleton" aria-hidden="true">
			<div className="cortext-canvas-skeleton__title" />
			<div className="cortext-canvas-skeleton__body">
				<div className="cortext-canvas-skeleton__line" />
				<div className="cortext-canvas-skeleton__line cortext-canvas-skeleton__line--short" />
				<div className="cortext-canvas-skeleton__line" />
				<div className="cortext-canvas-skeleton__line cortext-canvas-skeleton__line--medium" />
			</div>
		</div>
	);
}
