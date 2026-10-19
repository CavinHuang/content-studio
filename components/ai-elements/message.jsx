"use client";

/**
 * AI Elements Message（源：vercel/ai-elements，main 分支）
 * 适配：import 改为仓内相对路径；Button/Tooltip/ButtonGroup 级联以原生
 * button（title 提示）替代；保留 MessageResponse = Streamdown 流式 Markdown
 * 渲染器（cjk/code/math 插件，mermaid 未启用）。
 */

import { cn } from "../../lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { Streamdown } from "streamdown";
import { memo } from "react";

export const Message = ({ className, from, ...props }) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export const MessageContent = ({ className, ...props }) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  />
);

const streamdownPlugins = { cjk, code, math };

export const MessageResponse = memo(
  ({ className, ...props }) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children,
);

MessageResponse.displayName = "MessageResponse";
