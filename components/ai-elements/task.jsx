"use client";

/**
 * AI Elements Task（源：vercel/ai-elements，MIT）
 * 适配：import 改为仓内相对路径；移除 TS 类型与 tw-animate 动画类（JSX 工程无该插件）。
 */

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../../lib/utils";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

export const TaskItem = ({ children, className, ...props }) => (
  <div className={cn("text-muted-foreground text-sm", className)} {...props}>
    {children}
  </div>
);

export const Task = ({
  defaultOpen = true,
  className,
  ...props
}) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

export const TaskTrigger = ({
  children,
  className,
  title,
  ...props
}) => (
  <CollapsibleTrigger asChild className={cn("group", className)} {...props}>
    {children ?? (
      <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
        <SearchIcon className="size-4" />
        <p className="text-sm">{title}</p>
        <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsibleTrigger>
);

export const TaskContent = ({
  children,
  className,
  ...props
}) => (
  <CollapsibleContent
    className={cn(
      "text-popover-foreground outline-none",
      className,
    )}
    {...props}
  >
    <div className="mt-4 space-y-2 border-muted border-l-2 pl-4">{children}</div>
  </CollapsibleContent>
);
