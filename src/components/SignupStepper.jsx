import { cn } from '@/lib/utils'

/**
 * @param {{ current: number; steps: { id: string; label: string }[]; ariaLabel?: string }} props
 */
export default function SignupStepper({ current, steps, ariaLabel = 'Question progress' }) {
  return (
    <nav aria-label={ariaLabel} className='w-full'>
      <ol className='flex w-full items-start gap-1 sm:gap-2'>
        {steps.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={step.id} className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <div
                className={cn(
                  'h-1.5 w-full rounded-full transition-colors',
                  done || active ? 'bg-primary' : 'bg-muted'
                )}
              />
              <span
                className={cn(
                  'truncate text-[10px] font-medium leading-tight sm:text-xs',
                  active ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>
      <p className='mt-2 text-xs text-muted-foreground'>
        Step {current + 1} of {steps.length}
      </p>
    </nav>
  )
}
