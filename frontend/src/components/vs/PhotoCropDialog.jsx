import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

const BOX = 260;
const OUT = 512;

export function PhotoCropDialog({ file, open, onOpenChange, onCropped }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);
  const base = useRef(1);

  useEffect(() => {
    if (!file) { setImg(null); return undefined; }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const b = Math.max(BOX / im.naturalWidth, BOX / im.naturalHeight);
      base.current = b;
      setZoom(1);
      setOff({ x: (BOX - im.naturalWidth * b) / 2, y: (BOX - im.naturalHeight * b) / 2 });
      setImg(im);
    };
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const eff = base.current * zoom;
  const dW = img ? img.naturalWidth * eff : 0;
  const dH = img ? img.naturalHeight * eff : 0;

  const clamp = useCallback((x, y, w = dW, h = dH) => ({
    x: Math.min(0, Math.max(BOX - w, x)),
    y: Math.min(0, Math.max(BOX - h, y)),
  }), [dW, dH]);

  const onPointerDown = (e) => { if (!img) return; drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setOff(clamp(drag.current.ox + (e.clientX - drag.current.x), drag.current.oy + (e.clientY - drag.current.y)));
  };
  const onPointerUp = () => { drag.current = null; };

  const onZoom = (v) => {
    if (!img) return;
    const nz = v[0];
    const oldEff = base.current * zoom;
    const newEff = base.current * nz;
    const cx = (BOX / 2 - off.x) / oldEff;
    const cy = (BOX / 2 - off.y) / oldEff;
    setZoom(nz);
    setOff(clamp(BOX / 2 - cx * newEff, BOX / 2 - cy * newEff, img.naturalWidth * newEff, img.naturalHeight * newEff));
  };

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const k = OUT / BOX;
      const canvas = document.createElement("canvas");
      canvas.width = OUT; canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, OUT, OUT);
      ctx.drawImage(img, off.x * k, off.y * k, dW * k, dH * k);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      await onCropped(blob);
      onOpenChange(false);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="bg-white" data-testid="photo-crop-dialog">
        <DialogHeader>
          <DialogTitle className="text-navy">Position the photo</DialogTitle>
          <DialogDescription>Drag to move and use the slider to zoom. The circle shows how the face appears on the ballot.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-5 py-2">
          <div className="relative touch-none overflow-hidden rounded-lg bg-slate-100 select-none" style={{ width: BOX, height: BOX }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} data-testid="photo-crop-area">
            {img && <img src={img.src} alt="" draggable={false} style={{ position: "absolute", left: off.x, top: off.y, width: dW, height: dH, maxWidth: "none", cursor: "grab" }} />}
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90"
              style={{ width: BOX - 10, height: BOX - 10, boxShadow: "0 0 0 9999px rgba(10,31,68,0.35)" }} aria-hidden />
          </div>
          <div className="flex w-full items-center gap-3">
            <span className="text-xs font-medium text-slate-500">Zoom</span>
            <Slider min={1} max={3} step={0.01} value={[zoom]} onValueChange={onZoom} className="flex-1" data-testid="photo-crop-zoom" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} data-testid="photo-crop-cancel">Cancel</Button>
          <Button onClick={confirm} disabled={busy || !img} data-testid="photo-crop-confirm">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Use photo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
