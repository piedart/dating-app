import { useEffect, useState } from 'react'
import DevChat from '@/components/DevChat.jsx'
import { Button } from '@/components/ui/button'

const WORKER_SPEC = '/workers/main.js'
const decoder = new TextDecoder('utf-8')

export default function App() {
  const bridge = window.bridge
  const [title, setTitle] = useState(() => 'v' + bridge.pkg().version)
  const [showUpdate, setShowUpdate] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const offUpdating = bridge.onPearEvent('updating', () => setTitle('UPDATING...'))
    const offUpdated = bridge.onPearEvent('updated', () => {
      setTitle('Update ready!')
      setShowUpdate(true)
    })
    return () => {
      offUpdating()
      offUpdated()
    }
  }, [bridge])

  useEffect(() => {
    bridge.startWorker(WORKER_SPEC)
    const offOut = bridge.onWorkerStdout(WORKER_SPEC, (data) => {
      console.log('worker stdout', '[', WORKER_SPEC, ']:', decoder.decode(data))
    })
    const offErr = bridge.onWorkerStderr(WORKER_SPEC, (data) => {
      console.error('worker stderr', '[', WORKER_SPEC, ']:', decoder.decode(data))
    })
    const offIpc = bridge.onWorkerIPC(WORKER_SPEC, (data) => {
      console.log('worker ipc', '[', WORKER_SPEC, ']:', decoder.decode(data))
      bridge.writeWorkerIPC(WORKER_SPEC, 'Hello from renderer')
    })
    const offExit = bridge.onWorkerExit(WORKER_SPEC, (code) => {
      console.log('Worker exited with code', code)
      offOut()
      offErr()
      offIpc()
      offExit()
    })
    return () => {
      offOut()
      offErr()
      offIpc()
      offExit()
    }
  }, [bridge])

  async function onApplyUpdate() {
    setUpdating(true)
    try {
      await bridge.applyUpdate()
      await bridge.appAfterUpdate()
    } catch (err) {
      setTitle('Update failed: ' + err.message)
      setShowUpdate(false)
    }
  }

  return (
    <div className='flex min-h-svh flex-col items-center justify-center p-6'>
      <div className='flex w-full max-w-lg flex-col items-center text-center'>
        <h1 className='font-heading text-4xl font-semibold tracking-wide text-foreground md:text-5xl'>
          {title}
        </h1>
        {showUpdate ? (
          <Button className='mt-6' disabled={updating} onClick={onApplyUpdate}>
            {updating ? 'Updating…' : 'Apply update'}
          </Button>
        ) : null}
        <DevChat />
      </div>
    </div>
  )
}
