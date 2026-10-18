import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#285c45] text-[#f7f6f1]",
        secondary: "border-transparent bg-[#e7efe2] text-[#285c45]",
        destructive: "border-transparent bg-[#b3423a] text-[#f7f6f1]",
        outline: "border-[#dbe2d6] text-[#38523f]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
