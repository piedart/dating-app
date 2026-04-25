import { useEffect, useState } from 'react'
import CreateAccount from '@/components/CreateAccount.jsx'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const WORKER_SPEC = '/workers/main.js'
const decoder = new TextDecoder('utf-8')

export default function App() {
  const bridge = window.bridge
  const [profile, setProfile] = useState(undefined)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(() => 'v' + bridge.pkg().version)
  const [showUpdate, setShowUpdate] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    bridge
      .accountGet()
      .then((p) => setProfile(p))
      .catch(() => setProfile(null))
  }, [bridge])

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
    if (!profile) return
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
  }, [bridge, profile])

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

  async function onSignOut() {
    await bridge.accountClear()
    setProfile(null)
    setEditing(false)
  }

  if (profile === undefined) {
    return (
      <div className='flex min-h-svh items-center justify-center p-6 text-muted-foreground'>
        Loading…
      </div>
    )
  }

  if (!profile || editing) {
    return (
      <CreateAccount
        initialProfile={editing ? profile : null}
        onComplete={(p) => {
          setProfile(p)
          setEditing(false)
        }}
        onCancel={editing ? () => setEditing(false) : undefined}
      />
    )
  }

  return (
    <div className='flex min-h-svh flex-col items-center justify-center p-6'>
      <div className='flex w-full max-w-lg flex-col items-stretch'>
        <header className='mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='space-y-3 text-left'>
            <div>
              <p className='font-heading text-lg font-semibold tracking-wide text-foreground'>
                {profile.displayName ?? '—'}
              </p>
              <p className='text-xs text-muted-foreground'>
                @{profile.username ?? '—'}
                {typeof profile.age === 'number' ? ` · ${profile.age}` : null}
                {profile.gender ? ` · ${profile.gender}` : null}
                {profile.city ? ` · ${profile.city}` : null}
              </p>
              {profile.pronouns ? (
                <p className='text-xs text-muted-foreground'>{profile.pronouns}</p>
              ) : null}
              {profile.bio ? (
                <p className='mt-1 max-w-md text-sm leading-relaxed text-foreground'>
                  {profile.bio}
                </p>
              ) : null}
            </div>
            <div className='space-y-3'>
              <p className='font-heading text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                Profile extras
              </p>
              {profile.doodlePng ? (
                <div>
                  <p className='mb-1 text-xs text-muted-foreground'>Doodle</p>
                  <img
                    src={profile.doodlePng}
                    alt=''
                    className='max-w-full rounded-md border border-border'
                  />
                </div>
              ) : null}
              {profile.birdSound ? (
                <div>
                  <p className='mb-1 text-xs text-muted-foreground'>Bird sound</p>
                  <audio controls className='h-9 w-full max-w-md' src={profile.birdSound} />
                </div>
              ) : null}
              <p className='text-sm leading-relaxed text-foreground'>
                <span className='text-muted-foreground'>Favourite car:</span>{' '}
                {profile.favouriteCar ?? '—'}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button type='button' variant='outline' size='sm' onClick={() => setEditing(true)}>
              Edit profile
            </Button>
            <Button type='button' variant='destructive' size='sm' onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </header>
        <Separator className='mb-6' />
        <div className='flex flex-col items-center text-center'>
          <h1 className='font-heading text-3xl font-semibold tracking-wide text-foreground md:text-4xl'>
            {title}
          </h1>
          {showUpdate ? (
            <Button className='mt-4' disabled={updating} onClick={onApplyUpdate}>
              {updating ? 'Updating…' : 'Apply update'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
