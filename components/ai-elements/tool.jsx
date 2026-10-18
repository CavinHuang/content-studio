"use client";

/**
 * AI Elements Tool（源：vercel/ai-elements，MIT）
 * 适配：import 改为仓内相对路径；移除 TS 类型；CodeBlock 以本仓样式的 pre 替代
 * （不引入 shiki 级联）；移除 tw-animate 动画类。状态文案/图标沿用原组件语义。
 */

import { Badge } from "../ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../../lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { isValidElement } from "react";

export const Tool = ({ className, ...props }) => (
  <Collapsible
    className={cn("group mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

const statusLabels = {
  "approval-requested": "等待确认",
  "approval-responded": "已响应",
  "input-available": "运行中",
  "input-streaming": "排队",
  "output-available": "已完成",
  "output-denied": "已拒绝",
  "output-error": "出错",
};

const statusIcons = {
  "approval-requested": <ClockIcon className="size-4 text-(--muted-ink)" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-(--muted-ink)" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-(--writing-green)" />,
  "output-denied": <XCircleIcon className="size-4 text-(--muted-ink)" />,
  "output-error": <XCircleIcon className="size-4 text-(--destructive)" />,
};

export const getStatusBadge = (state) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[state]}
    {statusLabels[state]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export const ToolContent = ({ className, ...props }) => (
  <CollapsibleContent
    className={cn("space-y-4 p-4 text-popover-foreground outline-none", className)}
    {...props}
  />
);

export const ToolInput = ({ className, input, ...props }) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      参数
    </h4>
    <div className="rounded-md bg-muted">
      <pre className="overflow-x-auto p-3 font-mono text-xs text-foreground">
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  </div>
);

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}) => {
  if (!(output || errorText)) {
    return null;
  }

  let rendered = <div>{output}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    rendered = (
      <pre className="overflow-x-auto p-3 font-mono text-xs text-foreground">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  } else if (typeof output === "string") {
    rendered = (
      <pre className="overflow-x-auto p-3 font-mono text-xs text-foreground">
        {output}
      </pre>
    );
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "错误" : "结果"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {rendered}
      </div>
    </div>
  );
};
