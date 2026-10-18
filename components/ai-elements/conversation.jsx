"use client";

/**
 * AI Elements Conversation（源：vercel/ai-elements，main 分支）
 * 适配：import 改为仓内相对路径；ScrollButton 的 Button 以本仓 writing-button
 * 样式替代；空状态组件未启用。
 */

import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "../../lib/utils";
import { ArrowDownIcon } from "lucide-react";

export const Conversation = ({ className, ...props }) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-auto", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export const ConversationContent = ({ className, ...props }) => (
  <div className={cn("max-w-full px-4 py-2", className)} {...props} />
);

export const ConversationScrollButton = ({ className, ...props }) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <button
      type="button"
      className={
        "writing-button absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full " +
        (className || "")
      }
      onClick={() => scrollToBottom()}
      aria-label="滚动到底部"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </button>
  );
};
