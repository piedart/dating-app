import { useCallback, useEffect, useState } from 'react'
import CharacterConversation from '@/components/CharacterConversation.jsx'
import CreateAccount from '@/components/CreateAccount.jsx'
import MatchChat from '@/components/MatchChat.jsx'
import MatchesScreen from '@/components/MatchesScreen.jsx'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { pickThreeCharacters } from '@/lib/pickCharacters.js'

const WORKER_SPEC = '/workers/main.js'
const decoder = new TextDecoder('utf-8')

export default function App() {
  const bridge = window.bridge
  const [profile, setProfile] = useState(undefined)
  const [editing, setEditing] = useState(false)
  const [screen, setScreen] = useState('home')
  const [conversationRoster, setConversationRoster] = useState(null)
  const [matchPeers, setMatchPeers] = useState([])
  const [blockedPublicIds, setBlockedPublicIds] = useState([])
  const [dmPeer, setDmPeer] = useState(null)
  const [showUpdate, setShowUpdate] = useState(false)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    bridge
      .accountGet()
      .then((p) => setProfile(p))
      .catch(() => setProfile(null))
  }, [bridge])

  useEffect(() => {
    const offUpdating = bridge.onPearEvent('updating', () => {})
    const offUpdated = bridge.onPearEvent('updated', () => {
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

  useEffect(() => {
    if (screen !== 'matches' || !profile) return
    void bridge.blocklistGet().then((r) => {
      setBlockedPublicIds(Array.isArray(r?.publicIds) ? r.publicIds : [])
    })
    bridge.matchmakingStart()
    const off = bridge.onMatchmakingPeers((payload) => {
      setMatchPeers(Array.isArray(payload.peers) ? payload.peers : [])
    })
    return () => {
      off()
      bridge.matchmakingStop()
      setDmPeer(null)
    }
  }, [screen, profile, bridge])

  async function onApplyUpdate() {
    setUpdating(true)
    try {
      await bridge.applyUpdate()
      await bridge.appAfterUpdate()
    } catch (err) {
      setShowUpdate(false)
      console.error('Update failed:', err)
    } finally {
      setUpdating(false)
    }
  }

  async function onSignOut() {
    await bridge.accountClear()
    setProfile(null)
    setEditing(false)
    setScreen('home')
    setConversationRoster(null)
    setMatchPeers([])
    setBlockedPublicIds([])
    setDmPeer(null)
  }

  function startConversation() {
    setConversationRoster(pickThreeCharacters())
    setScreen('conversation')
  }

  const openDm = useCallback(
    async (peer) => {
      const ok = await bridge.dmOpen(peer.publicId)
      if (ok) setDmPeer(peer)
    },
    [bridge]
  )

  const detachDmUi = useCallback(() => {
    setDmPeer(null)
  }, [])

  const refreshBlocklist = useCallback(async () => {
    const r = await bridge.blocklistGet()
    setBlockedPublicIds(Array.isArray(r?.publicIds) ? r.publicIds : [])
  }, [bridge])

  const blockPeer = useCallback(
    async (peer) => {
      await bridge.blocklistAdd(peer.publicId)
      await refreshBlocklist()
      setDmPeer((cur) => (cur?.publicId === peer.publicId ? null : cur))
    },
    [bridge, refreshBlocklist]
  )

  const unblockPeer = useCallback(
    async (publicId) => {
      await bridge.blocklistRemove(publicId)
      await refreshBlocklist()
    },
    [bridge, refreshBlocklist]
  )

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
          setConversationRoster(pickThreeCharacters())
          setScreen('conversation')
        }}
        onCancel={editing ? () => setEditing(false) : undefined}
      />
    )
  }

  if (screen === 'conversation' && conversationRoster?.length) {
    return (
      <CharacterConversation
        characters={conversationRoster}
        onBack={() => {
          setScreen('home')
          setConversationRoster(null)
        }}
        onComplete={() => {
          setScreen('matches')
          setConversationRoster(null)
        }}
      />
    )
  }

  if (screen === 'matches') {
    if (dmPeer) {
      return (
        <MatchChat peer={dmPeer} onClose={detachDmUi} onBlock={() => void blockPeer(dmPeer)} />
      )
    }
    return (
      <MatchesScreen
        peers={matchPeers}
        blockedPublicIds={blockedPublicIds}
        onBack={() => setScreen('home')}
        onChatWith={openDm}
        onBlock={(p) => void blockPeer(p)}
        onUnblock={(id) => void unblockPeer(id)}
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
        {showUpdate ? (
          <div className='mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm'>
            <p className='mb-2 text-foreground'>An update is ready to install.</p>
            <Button size='sm' disabled={updating} onClick={onApplyUpdate}>
              {updating ? 'Updating…' : 'Apply update'}
            </Button>
          </div>
        ) : null}
        <div className='flex flex-col gap-3'>
          <Button
            type='button'
            className='w-full sm:w-auto sm:self-start'
            onClick={startConversation}
          >
            Meet 3 people
          </Button>
          <p className='max-w-md text-xs text-muted-foreground'>
            Three random characters each ask one question, then you’ll see who else is online to
            chat with peer-to-peer.
          </p>
        </div>
      </div>
    </div>
  )
}
