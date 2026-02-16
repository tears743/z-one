import React, { useState, useRef, useEffect } from "react";
import { Send, Image as ImageIcon, ChevronDown, X } from "lucide-react";
import { ModelConfig } from "../types/settings";
import { t } from "../utils/translations";

interface ChatInputProps {
  models: ModelConfig[];
  activeModelId: string;
  onModelChange: (modelId: string) => void;
  onSend: (text: string, images: string[]) => void;
  loading: boolean;
  language: "en" | "zh";
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  models,
  activeModelId,
  onModelChange,
  onSend,
  loading,
  language,
  disabled,
  placeholder,
}) => {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]); // Base64 strings
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trans = t(language);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if ((!text.trim() && images.length === 0) || loading) return;
    onSend(text, images);
    setText("");
    setImages([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              setImages((prev) => [...prev, event.target!.result as string]);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImages((prev) => [...prev, event.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const activeModel = models.find((m) => m.id === activeModelId) || models[0];

  return (
    <div className="chat-input-container">
      {/* Toolbar: Model Selector & Tools */}
      <div className="input-toolbar">
        <div style={{ position: "relative" }}>
          <select
            value={activeModelId}
            onChange={(e) => onModelChange(e.target.value)}
            className="model-selector"
            style={{ appearance: "none", paddingRight: "24px" }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              color: "var(--text-secondary)",
            }}
          />
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          title={trans.uploadImage}
          className="icon-btn"
        >
          <ImageIcon size={20} />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          accept="image/*"
          onChange={handleFileSelect}
        />
      </div>

      {/* Image Previews */}
      {images.length > 0 && (
        <div className="image-preview-area">
          {images.map((img, idx) => (
            <div key={idx} className="image-preview-item">
              <img
                src={img}
                alt={`preview-${idx}`}
                className="image-preview-img"
              />
              <button
                onClick={() => removeImage(idx)}
                className="image-remove-btn"
                title={trans.removeImage || "Remove"}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="input-wrapper">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            placeholder ||
            trans.messagePlaceholder.replace(
              "{model}",
              activeModel?.name || "Model",
            )
          }
          rows={1}
          className="chat-textarea"
          disabled={loading || disabled}
        />
        <div className="input-actions" style={{ justifyContent: "flex-end" }}>
          <button
            onClick={handleSend}
            disabled={
              loading || disabled || (!text.trim() && images.length === 0)
            }
            className="send-btn"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
