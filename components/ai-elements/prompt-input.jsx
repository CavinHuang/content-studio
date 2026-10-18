"use client";

/**
 * AI Elements PromptInput（源：vercel/ai-elements prompt-input，MIT）
 * 精简核心：仅保留 form/textarea/submit 的交互本质——IME 安全的 Enter 提交、
 * Shift+Enter 换行、field-sizing 自动伸缩；附件/命令面板/模型选择级联未引入。
 */

import { cn } from "../../lib/utils";
import { CornerDownLeftIcon, Loader2Icon } from "lucide-react";
import { useCallback, useState } from "react";

export const PromptInput = ({ className, onSubmit, ...props }) => (
  <form className={cn("w-full", className)} onSubmit={onSubmit} {...props} />
);

export const PromptInputTextarea = ({
  className,
  onKeyDown,
  onEnterSubmit,
  submitDisabled,
  ...props
}) => {
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown = useCallback(
    (e) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "Enter") {
        if (isComposing || e.nativeEvent.isComposing) return;
        if (e.shiftKey) return;
        if (submitDisabled || !onEnterSubmit) return;
        e.preventDefault();
        onEnterSubmit();
      }
    },
    [onKeyDown, onEnterSubmit, submitDisabled, isComposing],
  );

  return (
    <textarea
      className={cn(
        "field-sizing-content max-h-48 min-h-16 w-full resize-none rounded-md border border-border bg-popover px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export const PromptInputSubmit = ({
  className,
  generating,
  onStop,
  children,
  ...props
}) => {
  const isGenerating = Boolean(generating && onStop);
  const icon = isGenerating ? (
    <Loader2Icon className="size-4 animate-spin" />
  ) : (
    <CornerDownLeftIcon className="size-4" />
  );
  return (
    <button
      type="button"
      aria-label={isGenerating ? "停止" : "提交"}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground",
        className,
      )}
      onClick={() => {
        if (isGenerating) onStop?.();
      }}
      {...props}
    >
      {children ?? icon}
    </button>
  );
};
