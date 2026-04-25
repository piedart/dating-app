import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

/**
 * @param {{
 *   peers: { publicId: string; displayName: string; username: string }[]
 *   blockedPublicIds: string[]
 *   onBack: () => void
 *   onChatWith: (peer: { publicId: string; displayName: string; username: string }) => void
 *   onBlock: (peer: { publicId: string; displayName: string; username: string }) => void
 *   onUnblock: (publicId: string) => void
 * }} props
 */
export default function MatchesScreen({
  peers,
  blockedPublicIds,
  onBack,
  onChatWith,
  onBlock,
  onUnblock
}) {
  const blockedSet = new Set(blockedPublicIds)
  const visiblePeers = peers.filter((p) => !blockedSet.has(p.publicId))

  return (
    <div className='flex min-h-svh flex-col items-center p-6'>
      <Card className='w-full max-w-lg'>
        <CardHeader className='space-y-1'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <CardTitle className='font-heading text-xl'>Your matches</CardTitle>
              <CardDescription>
                Everyone else online on this dev network. Chat is peer-to-peer; block someone to
                drop them from your list and ignore their DMs.
              </CardDescription>
            </div>
            <Button type='button' variant='outline' size='sm' onClick={onBack}>
              Home
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className='space-y-8 pt-6'>
          <div>
            <p className='mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              Online
            </p>
            {visiblePeers.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No one else online yet. Open a second instance (e.g.{' '}
                <code className='rounded bg-muted px-1 py-0.5 text-xs'>
                  npm start -- --storage /tmp/other
                </code>
                ) and finish the character flow there too.
              </p>
            ) : (
              <ul className='flex flex-col gap-3'>
                {visiblePeers.map((p) => (
                  <li
                    key={p.publicId}
                    className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3'
                  >
                    <div>
                      <p className='font-medium text-foreground'>{p.displayName || p.username}</p>
                      <p className='text-xs text-muted-foreground'>@{p.username}</p>
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      <Button type='button' size='sm' onClick={() => onChatWith(p)}>
                        Chat
                      </Button>
                      <Button type='button' size='sm' variant='outline' onClick={() => onBlock(p)}>
                        Block
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {blockedPublicIds.length > 0 ? (
            <div>
              <p className='mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                Blocked
              </p>
              <ul className='flex flex-col gap-2'>
                {blockedPublicIds.map((id) => {
                  const fromPeers = peers.find((p) => p.publicId === id)
                  const label = fromPeers
                    ? `${fromPeers.displayName || fromPeers.username} (@${fromPeers.username})`
                    : `Blocked peer · ${id.slice(0, 8)}…`
                  return (
                    <li
                      key={id}
                      className='flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm'
                    >
                      <span className='text-muted-foreground'>{label}</span>
                      <Button type='button' variant='outline' size='sm' onClick={() => onUnblock(id)}>
                        Unblock
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className='border-t border-border pt-4'>
          <p className='text-xs text-muted-foreground'>
            Matching is broad for now — later, scores from your character answers can rank this list.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
