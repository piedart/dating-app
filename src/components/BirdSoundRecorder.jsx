import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

function pickMimeType() {
  const MR = window.MediaRecorder
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const t of candidates) {
    if (typeof MR !== 'undefined' && MR.isTypeSupported(t)) {
      return t
    }
  }
  return ''
}

/**
 * @param {{ value: string; onChange: (dataUrl: string) => void }} props
 */
export default function BirdSoundRecorder({ value, onChange }) {
  const bridge = window.bridge
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  async function startRecording() {
    setError('')
    try {
      if (typeof bridge.requestMicrophone === 'function') {
        const mic = await bridge.requestMicrophone()
        if (mic && mic.ok === false) {
          if (typeof bridge.promptMicrophonePrivacy === 'function') {
            await bridge.promptMicrophonePrivacy()
          }
          setError(mic.message || 'Microphone is not available')
          return
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const options = mimeType ? { mimeType } : {}
      const mr = new window.MediaRecorder(stream, options)
      chunksRef.current = []
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        chunksRef.current = []
        const r = new window.FileReader()
        r.onload = () => {
          const url = typeof r.result === 'string' ? r.result : ''
          onChange(url)
        }
        r.readAsDataURL(blob)
        setRecording(false)
      }
      recorderRef.current = mr
      mr.start(100)
      setRecording(true)
    } catch (err) {
      setRecording(false)
      let msg = err?.message || 'Could not access the microphone'
      if (/denied|not allowed/i.test(msg) && typeof bridge.promptMicrophonePrivacy === 'function') {
        await bridge.promptMicrophonePrivacy()
        msg += ' After allowing access, quit and reopen the app, then try recording again.'
      }
      setError(msg)
    }
  }

  function stopRecording() {
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.stop()
    }
    recorderRef.current = null
  }

  function clearRecording() {
    onChange('')
  }

  return (
    <div className='grid gap-3'>
      <Label className='text-foreground'>
        Record a bird sound{' '}
        <span className='font-normal text-muted-foreground'>(or your best impression)</span>
      </Label>
      {error ? (
        <div className='grid gap-2'>
          <p className='text-sm text-destructive' role='alert'>
            {error}
          </p>
          {typeof bridge.openMicrophonePrivacy === 'function' &&
          (bridge.platform === 'darwin' || bridge.platform === 'win32') ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='w-fit'
              onClick={() => void bridge.openMicrophonePrivacy()}
            >
              Open microphone privacy settings…
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {!recording ? (
          <Button type='button' onClick={startRecording}>
            {value ? 'Re-record' : 'Start recording'}
          </Button>
        ) : (
          <Button type='button' variant='destructive' onClick={stopRecording}>
            Stop
          </Button>
        )}
        {value ? (
          <Button type='button' variant='outline' onClick={clearRecording}>
            Clear
          </Button>
        ) : null}
      </div>
      {value ? (
        <audio controls className='h-10 w-full max-w-md' src={value} preload='metadata' />
      ) : (
        <p className='text-xs text-muted-foreground'>No clip yet — record a few seconds.</p>
      )}
    </div>
  )
}
