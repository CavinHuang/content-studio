"use client";

/**
 * AI Elements PromptInput（源：vercel/ai-elements prompt-input，MIT）
 * 精简核心：仅保留 textarea 的交互本质——IME 安全的 Enter 提交、
 * Shift+Enter 换行、field-sizing 自动伸缩；form/submit 及附件/命令面板/模型
 * 选择级联未引入。
 */

import { cn } from "../../lib/utils";
import { useCallback, useState } from "react";

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
