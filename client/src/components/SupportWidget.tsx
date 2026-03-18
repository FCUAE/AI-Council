import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircleQuestion, X, Send, CheckCircle, ImagePlus } from "lucide-react";

interface AttachedImage {
  file: File;
  preview: string;
}

const MAX_IMAGES = 5;
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export default function SupportWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-support-widget', handler);
    return () => window.removeEventListener('open-support-widget', handler);
  }, []);

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit = email.trim() !== "" && emailValid && message.trim() !== "" && !sending;

  function handleClose() {
    setOpen(false);
    if (sent) {
      setSent(false);
      setEmail("");
      setMessage("");
      setError(null);
      images.forEach(img => URL.revokeObjectURL(img.preview));
      setImages([]);
    }
  }

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles: AttachedImage[] = [];

    for (const file of fileArray) {
      if (images.length + validFiles.length >= MAX_IMAGES) break;
      if (!ALLOWED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_SIZE) continue;
      validFiles.push({
        file,
        preview: URL.createObjectURL(file),
      });
    }

    if (validFiles.length > 0) {
      setImages(prev => [...prev, ...validFiles].slice(0, MAX_IMAGES));
    }
  }, [images.length]);

  function removeImage(index: number) {
    setImages(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  async function uploadImage(img: AttachedImage): Promise<string> {
    const formData = new FormData();
    formData.append("file", img.file);

    const res = await fetch("/api/support/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || "Upload failed");
    }

    const data = await res.json();
    return data.objectPath;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSending(true);
    setError(null);

    try {
      const imageUrls: string[] = [];
      for (const img of images) {
        const url = await uploadImage(img);
        imageUrls.push(url);
      }

      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message, imageUrls: imageUrls.length > 0 ? imageUrls : undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to send message");
      }

      setSent(true);
      images.forEach(img => URL.revokeObjectURL(img.preview));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-[9998] transition-opacity"
          onClick={handleClose}
          data-testid="overlay-support"
        />
      )}

      {open && (
        <div
          className="fixed bottom-20 right-4 sm:right-6 z-[9999] w-[calc(100vw-2rem)] sm:w-[400px] bg-white rounded-2xl shadow-[0px_8px_40px_rgba(0,0,0,0.16)] border border-[#eaeaea] overflow-hidden"
          data-testid="popup-support"
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-0">
            <div>
              <h2 className="text-[17px] font-semibold text-[#1a1a1a]" data-testid="text-support-title">
                Send us a note
              </h2>
              <p className="text-[13px] text-[#888] mt-0.5" data-testid="text-support-subtitle">
                Bug, question, feature request — anything goes.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-[#999] hover:text-[#333] transition-colors p-1 -mr-1"
              data-testid="button-close-support"
            >
              <X size={18} />
            </button>
          </div>

          {sent ? (
            <div className="px-5 py-8 text-center" data-testid="text-support-success">
              <CheckCircle className="mx-auto mb-3 text-green-500" size={32} />
              <p className="text-[15px] text-[#1a1a1a] leading-relaxed">
                Your message has been sent to the team. Thank you! Please allow up to 48 hours, and we will get back to you at your provided email address if needed.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-5 pt-4 pb-5 space-y-3">
              <div>
                <label htmlFor="support-email" className="block text-[13px] font-medium text-[#555] mb-1">
                  Your email
                </label>
                <input
                  id="support-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-3 py-2 text-[14px] border border-[#ddd] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a1a1a]/10 focus:border-[#999] transition-colors placeholder:text-[#bbb]"
                  data-testid="input-support-email"
                />
              </div>

              <div>
                <label htmlFor="support-message" className="block text-[13px] font-medium text-[#555] mb-1">
                  What's on your mind?
                </label>
                <textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you're thinking..."
                  required
                  rows={4}
                  className="w-full px-3 py-2 text-[14px] border border-[#ddd] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a1a1a]/10 focus:border-[#999] transition-colors placeholder:text-[#bbb] resize-none"
                  data-testid="input-support-message"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                />
              </div>

              <div
                className={`border-2 border-dashed rounded-lg p-3 transition-colors cursor-pointer ${
                  dragOver
                    ? "border-[#1a1a1a] bg-[#f5f5f5]"
                    : "border-[#ddd] hover:border-[#bbb]"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-testid="dropzone-support-images"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                  data-testid="input-support-file"
                />
                <div className="flex items-center justify-center gap-2 text-[#999]">
                  <ImagePlus size={16} />
                  <span className="text-[12px]">
                    {images.length >= MAX_IMAGES
                      ? `Max ${MAX_IMAGES} images reached`
                      : "Drop images here or click to attach (max 5MB each)"}
                  </span>
                </div>
              </div>

              {images.length > 0 && (
                <div className="flex flex-wrap gap-2" data-testid="preview-support-images">
                  {images.map((img, i) => (
                    <div key={i} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-[#eaeaea]">
                      <img
                        src={img.preview}
                        alt={`Attachment ${i + 1}`}
                        className="w-full h-full object-cover"
                        data-testid={`img-support-preview-${i}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-remove-image-${i}`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <p className="text-[13px] text-red-600" data-testid="text-support-error">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1a1a1a] text-white text-[14px] font-medium rounded-lg hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                data-testid="button-submit-support"
              >
                {sending ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Send size={14} />
                    Send
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      )}

      <button
        onClick={() => { if (!open) { setOpen(true); } else { handleClose(); } }}
        className="fixed bottom-6 right-4 sm:right-6 z-[9999] text-[#1a1a1a] hover:text-[#555] transition-colors"
        data-testid="button-open-support"
        aria-label="Contact support"
      >
        {open ? <X size={20} /> : <MessageCircleQuestion size={20} />}
      </button>
    </>
  );
}
