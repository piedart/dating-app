import { useEffect, useRef, useState } from 'react'
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

/**
 * @param {{
 *   characters: { id: string; name: string; tagline: string; emoji: string; questions: string[] }[]
 *   onBack: () => void
 *   onComplete: () => void
 * }} props
 */
export default function CharacterConversation({ characters: roster, onBack, onComplete }) {
  const [charIdx, setCharIdx] = useState(0)
  const [qIdx, setQIdx] = useState(0)
  const [messages, setMessages] = useState(
    /** @type {{ id: string; role: 'them' | 'you'; text: string; name?: string }[]} */ ([])
  )
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState('chat')
  const bottomRef = useRef(null)

  const current = roster[charIdx]
  const isLastChar = charIdx >= roster.length - 1
  const isLastQ = current && qIdx >= current.questions.length - 1
  const finished = phase === 'done'

  useEffect(() => {
    if (!current || phase !== 'chat') return
    const intro = `${current.name} says: “${current.questions[qIdx]}”`
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'them' && last.text === intro) return prev
      return [
        ...prev,
        {
          id: `q-${current.id}-${qIdx}-${Date.now()}`,
          role: 'them',
          name: current.name,
          text: intro
        }
      ]
    })
  }, [current, qIdx, phase])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, phase])

  function sendReply() {
    const t = draft.trim()
    if (!t || !current || finished) return
    setDraft('')
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'you', text: t }])

    if (!isLastQ) {
      setQIdx((i) => i + 1)
      return
    }

    if (!isLastChar) {
      const next = roster[charIdx + 1]
      setMessages((prev) => [
        ...prev,
        {
          id: `handoff-${Date.now()}`,
          role: 'them',
          name: '…',
          text: `— ${next.name} slides into the chat —`
        }
      ])
      setCharIdx((i) => i + 1)
      setQIdx(0)
      return
    }

    setPhase('done')
    setMessages((prev) => [
      ...prev,
      {
        id: `bye-${Date.now()}`,
        role: 'them',
        name: '…',
        text: "That's everyone for now. Nice meeting you."
      }
    ])
  }

  if (!current && !finished) {
    return null
  }

  return (
    <div className='flex min-h-svh flex-col items-center p-6'>
      <Card className='flex w-full max-w-lg flex-col'>
        <CardHeader className='space-y-1'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <CardTitle className='font-heading text-xl'>Conversation</CardTitle>
              <CardDescription>
                Three characters, one question each—answer however you like.
              </CardDescription>
            </div>
            <Button type='button' variant='outline' size='sm' onClick={onBack}>
              Back
            </Button>
          </div>
          {!finished && current ? (
            <div className='flex items-center gap-3 pt-2'>
              <Avatar className='h-11 w-11'>
                <AvatarFallback className='text-lg'>{current.emoji}</AvatarFallback>
              </Avatar>
              <div>
                <p className='font-medium text-foreground'>{current.name}</p>
                <p className='text-xs text-muted-foreground'>{current.tagline}</p>
                <p className='text-[10px] text-muted-foreground'>
                  Character {charIdx + 1} of {roster.length}
                </p>
              </div>
            </div>
          ) : null}
        </CardHeader>
        <Separator />
        <CardContent className='p-0'>
          <ScrollArea className='h-[min(50vh,420px)]'>
            <div className='flex flex-col gap-3 px-4 py-4'>
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn('flex', m.role === 'you' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed',
                      m.role === 'you'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {m.role === 'them' && m.name && m.name !== '…' ? (
                      <span className='mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                        {m.name}
                      </span>
                    ) : null}
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} aria-hidden />
            </div>
          </ScrollArea>
        </CardContent>
        <Separator />
        <CardFooter className='flex-col gap-3 pt-4'>
          {finished ? (
            <Button type='button' className='w-full' onClick={onComplete}>
              See matches
            </Button>
          ) : (
            <>
              <div className='flex w-full gap-2'>
                <Input
                  className='flex-1'
                  placeholder='Type your answer…'
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendReply()
                    }
                  }}
                />
                <Button type='button' onClick={sendReply}>
                  Send
                </Button>
              </div>
              <p className='w-full text-center text-xs text-muted-foreground'>
                Tip: short answers are fine—this is just for vibes.
              </p>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
