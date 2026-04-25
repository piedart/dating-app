import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

function initials(displayName, username) {
  const s = (displayName || username || '?').trim()
  return s.slice(0, 2).toUpperCase()
}

/**
 * @param {{
 *   peer: { publicId: string; displayName: string; username: string }
 *   onClose: () => void
 *   onBlock: () => void | Promise<void>
 * }} props
 */
export default function MatchChat({ peer, onClose, onBlock }) {
  const bridge = window.bridge
  const [messages, setMessages] = useState(
    /** @type {{ id: string; self?: boolean; text: string; name?: string; publicId?: string }[]} */ (
      []
    )
  )
  const [draft, setDraft] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bridge.dmSetUiState(peer.publicId)
    return () => {
      bridge.dmSetUiState(null)
    }
  }, [bridge, peer.publicId])

  useEffect(() => {
    const off = bridge.onDmMessage((msg) => {
      if (!msg.self) {
        if (msg.publicId && msg.publicId !== peer.publicId) return
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          self: Boolean(msg.self),
          text: msg.text,
          name: typeof msg.name === 'string' ? msg.name : undefined,
          publicId: typeof msg.publicId === 'string' ? msg.publicId : undefined
        }
      ])
    })
    const offClosed = bridge.onDmClosed(() => {
      onClose()
    })
    return () => {
      off()
      offClosed()
    }
  }, [bridge, onClose, peer.publicId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const send = useCallback(async () => {
    const t = draft.trim()
    if (!t) return
    setDraft('')
    await bridge.dmSend(t)
  }, [bridge, draft])

  return (
    <div className='flex min-h-svh flex-col items-center p-6'>
      <Card className='flex w-full max-w-lg flex-col'>
        <CardHeader className='space-y-1 pb-2'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex items-center gap-3'>
              <Avatar className='h-10 w-10'>
                <AvatarFallback>{initials(peer.displayName, peer.username)}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className='text-lg'>{peer.displayName || peer.username}</CardTitle>
                <CardDescription>@{peer.username} · P2P direct chat</CardDescription>
              </div>
            </div>
            <div className='flex flex-wrap justify-end gap-2'>
              <Button type='button' variant='outline' size='sm' onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-8 w-fit px-2 text-xs text-muted-foreground hover:text-destructive'
            onClick={() => void onBlock()}
          >
            Block user
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className='p-0'>
          <ScrollArea className='h-[min(50vh,380px)]'>
            <div className='flex flex-col gap-3 px-4 py-4'>
              {messages.length === 0 ? (
                <p className='text-center text-sm text-muted-foreground'>
                  Say hi — messages go peer-to-peer when both of you are online. You can close this
                  window and you’ll still receive messages (desktop notification when this chat
                  isn’t open).
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={cn('flex', m.self ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[min(100%,18rem)] rounded-lg px-3 py-2 text-sm leading-relaxed',
                        m.self ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                      )}
                    >
                      {!m.self && m.name ? (
                        <span className='mb-0.5 block text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>
                          {m.name}
                        </span>
                      ) : null}
                      {m.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} aria-hidden />
            </div>
          </ScrollArea>
        </CardContent>
        <Separator />
        <CardFooter className='gap-2 pt-4'>
          <Input
            className='flex-1'
            placeholder='Message…'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <Button type='button' onClick={() => void send()}>
            Send
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
