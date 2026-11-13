import { useRef, useState } from "react";
import { api } from "./api";
import { useToast } from "./Toast";

const EMOJIS = ["🦉", "🦊", "🐻", "🐱", "🌻", "🌊", "🚲", "🎸", "🏔️", "☕", "📚", "🧘", "🍕", "🌙", "⚡", "🐶", "🦋", "🌵", "🎨", "🏀", "🍉", "🐢", "🌈", "🎯"];

/** The avatar in the rail: a photo when one is set, else the emoji. */
export function Avatar({ emoji, url, size = 36, radius = 8, className = "" }: { emoji?: string | null; url?: string | null; size?: number; radius?: number; className?: string }) {
  return (
    <span className={"inline-flex items-center justify-center overflow-hidden shrink-0 " + className} style={{ width: size, height: size, borderRadius: radius, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.25)", fontSize: size * 0.5 }}>
      {url ? <img src={url} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "cover" }} /> : emoji ?? "🙂"}
    </span>
  );
}

/** Choose an emoji or upload a photo (square-cropped and shrunk in the browser before it is saved). */
export function ProfilePicker({ me, onClose }: { me: { name: string; avatarEmoji?: string; avatarUrl?: string | null }; onClose: () => void }) {
  const [emoji, setEmoji] = useState<string>(me.avatarEmoji ?? "🙂");
  const [url, setUrl] = useState<string | null>(me.avatarUrl ?? null);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function pickFile(f: File) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) return toast("Choose a JPG or PNG");
    if (f.size > 2 * 1024 * 1024) return toast("That photo is over 2 MB");
    const bmp = await createImageBitmap(f).catch(() => null);
    if (!bmp) return toast("Couldn't read that image");
    const side = Math.min(bmp.width, bmp.height), out = 128;
    const canvas = document.createElement("canvas"); canvas.width = out; canvas.height = out;
    canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
    setUrl(canvas.toDataURL("image/jpeg", 0.85));
  }
  async function save() {
    setBusy(true);
    try { await api("/me", { method: "PUT", json: { avatarEmoji: emoji, avatarUrl: url } }); dispatchEvent(new Event("me-changed")); toast("Profile picture updated"); onClose(); }
    catch (e) { toast(`Not saved: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  const first = me.name.split(" ")[0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20,28,40,0.55)" }} onClick={onClose}>
      <div role="dialog" aria-label="Profile picture" onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5" style={{ background: "var(--card)", color: "var(--text)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Profile picture</h2>
          <button aria-label="Close" onClick={onClose} className="w-9 h-9 rounded-full inline-flex items-center justify-center text-lg" style={{ background: "var(--group)" }}>✕</button>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center justify-center overflow-hidden rounded-xl" style={{ width: 64, height: 64, background: "var(--group)", border: "1px solid var(--border)", fontSize: 32 }}>{url ? <img src={url} alt="" style={{ width: 64, height: 64, objectFit: "cover" }} /> : emoji}</span>
          <div><div className="font-bold">{first}</div><div className="text-sm" style={{ color: "var(--muted)" }}>Shown next to your name and on money moves</div></div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Pick an emoji</div>
          <div className="grid grid-cols-8 gap-1.5">
            {EMOJIS.slice(0, 15).map((e) => (
              <button key={e} onClick={() => { setEmoji(e); setUrl(null); setCustom(false); }} aria-pressed={!url && emoji === e} className="h-12 rounded-lg text-2xl inline-flex items-center justify-center tb-btn" style={{ border: `2px solid ${!url && emoji === e ? "var(--navy)" : "var(--border)"}`, background: !url && emoji === e ? "var(--selected)" : "var(--card)" }}>{e}</button>
            ))}
            {custom ? (
              <input autoFocus aria-label="Any emoji" value={EMOJIS.includes(emoji) ? "" : emoji} onChange={(e) => { const v = [...e.target.value].slice(-2).join(""); if (v) { setEmoji(v); setUrl(null); } }} placeholder="…" className="h-12 rounded-lg text-2xl text-center outline-none" style={{ border: "2px solid var(--navy)", background: "var(--card)", color: "var(--text)" }} />
            ) : (
              <button onClick={() => setCustom(true)} title="Type any emoji" className="h-12 rounded-lg text-xl inline-flex items-center justify-center tb-btn" style={{ border: `2px solid ${!EMOJIS.includes(emoji) && !url ? "var(--navy)" : "var(--border)"}`, color: "var(--muted)" }}>{!EMOJIS.includes(emoji) && !url ? emoji : "…"}</button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm" style={{ color: "var(--muted)" }}><span className="flex-1 h-px" style={{ background: "var(--border)" }} />or<span className="flex-1 h-px" style={{ background: "var(--border)" }} /></div>
        <div className="flex flex-col gap-2">
          <button onClick={() => file.current?.click()} className="rounded-xl py-4 text-[15px] font-semibold inline-flex items-center justify-center gap-2 tb-btn" style={{ border: "1.5px dashed var(--field)", color: "var(--accent-text)", background: "var(--card-alt)" }}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><polyline points="6 10 12 4 18 10" /><path d="M4 20h16" /></svg>
            {url ? "Choose a different photo" : "Upload a photo"}
          </button>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <div className="text-center text-xs" style={{ color: "var(--muted)" }}>Square crop, shown at 36 px — JPG or PNG up to 2 MB</div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-5 h-11 text-[15px] font-semibold" style={{ border: "1px solid var(--field)", background: "var(--card)" }}>Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-xl px-6 h-11 text-[15px] font-semibold disabled:opacity-60" style={{ background: "var(--navy)", color: "var(--navy-text)" }}>Save</button>
        </div>
      </div>
    </div>
  );
}
