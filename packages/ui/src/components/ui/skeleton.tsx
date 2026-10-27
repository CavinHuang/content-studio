// Source: shadcn/ui (MIT), new-york-v4 registry, 2026-10-25.
import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />
  )
}

export { Skeleton }
