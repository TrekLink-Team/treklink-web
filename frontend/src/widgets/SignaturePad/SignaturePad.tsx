import React, { useEffect, useRef } from 'react';
import { SECONDARY_BUTTON } from '../../shared/ui/styles';

interface Props {
  id: string;
  // A PNG data URL after each stroke, or null once cleared.
  onChange: (png: string | null) => void;
  invalid?: boolean;
}

const HEIGHT = 160;

// The signature pad of screen 5.4: the Org Manager draws on the Staff member's screen with a mouse,
// pen or finger. The drawing lives only in the canvas and the parent's state, never in storage.
export const SignaturePad: React.FC<Props> = ({ id, onChange, invalid }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  // Whether any stroke has left ink since the last clear: a tap without movement draws nothing and
  // must not count as a signature.
  const inked = useRef(false);

  // The canvas takes its container's width once, at the device pixel ratio, so strokes stay sharp.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = element.clientWidth * ratio;
    element.height = HEIGHT * ratio;
    const context = element.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#0f172a';
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
    inked.current = true;
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    if (inked.current) onChange(event.currentTarget.toDataURL('image/png'));
  };

  const clear = () => {
    const element = canvas.current;
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height);
    inked.current = false;
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        id={id}
        ref={canvas}
        role="img"
        aria-label="Signature area, drawn by the Manager"
        aria-invalid={invalid || undefined}
        style={{ height: HEIGHT }}
        className={`w-full touch-none rounded-lg border bg-white ${
          invalid ? 'border-red-500' : 'border-slate-400'
        }`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <button type="button" onClick={clear} className={`${SECONDARY_BUTTON} self-start`}>
        Clear signature
      </button>
    </div>
  );
};
