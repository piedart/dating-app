import { useCallback, useEffect, useRef, useState } from 'react'
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

export default function DevChat() {
  const bridge = window.bridge
  const [lines, setLines] = useState([])
  const [status, setStatus] = useState('0 peers connected')
  const [draft, setDraft] = useState('')
  const logRef = useRef(null)

  useEffect(() => {
    const offMsg = bridge.onChatMessage((msg) => {
      const label = msg.self ? 'You' : `Peer ${msg.from}`
      setLines((prev) => [...prev, { label, text: msg.text }])
    })
    const offPeers = bridge.onChatPeers((p) => {
      setStatus(`${p.count} peer(s) connected · your id: ${p.id}`)
    })
    return () => {
      offMsg()
      offPeers()
    }
  }, [bridge])

  useEffect(() => {
    const el = logRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [lines])

  const send = useCallback(async () => {
    const t = draft.trim()
    if (!t) return
    setDraft('')
    await bridge.chatSend(t)
  }, [bridge, draft])

  return (
    <Card size='sm' className='mt-8 w-full max-w-lg text-left'>
      <CardHeader className='border-b border-border pb-4'>
        <CardTitle>Dev chat</CardTitle>
        <CardDescription>Hyperswarm · same topic as other HelloPear dev instances</CardDescription>
      </CardHeader>
      <CardContent className='pt-4'>
        <p className='mb-3 text-xs text-muted-foreground'>{status}</p>
        <div
          ref={logRef}
          className='max-h-44 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm'
        >
          {lines.map((line, i) => (
            <div key={i} className='break-words py-0.5'>
              <span className='font-medium text-foreground'>{line.label}:</span> {line.text}
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className='flex flex-row gap-2 border-t border-border pt-4'>
        <Input
          className='flex-1 border-x-0 border-t-0 px-1'
          type='text'
          placeholder='Message…'
          autoComplete='off'
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
        />
        <Button type='button' size='sm' onClick={send}>
          Send
        </Button>
      </CardFooter>
    </Card>
  )
}
