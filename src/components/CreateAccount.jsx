import { useState } from 'react'
import BirdSoundRecorder from '@/components/BirdSoundRecorder.jsx'
import DoodleCanvas from '@/components/DoodleCanvas.jsx'
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
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import SignupStepper from '@/components/SignupStepper.jsx'

const QUESTION_STEPS = [
  { id: 'doodle', label: 'Doodle' },
  { id: 'bird', label: 'Bird' },
  { id: 'car', label: 'Car' }
]

function requireTrimmed(value, label, max = 120) {
  const s = String(value ?? '')
    .trim()
    .slice(0, max)
  if (!s) {
    throw new Error(`${label} is required`)
  }
  return s
}

function validateDoodle(dataUrl) {
  const s = String(dataUrl ?? '').trim()
  if (!s.startsWith('data:image/png')) {
    throw new Error('Draw something on the canvas first')
  }
  if (s.length < 200) {
    throw new Error('Drawing looks empty — add a few strokes')
  }
}

function validateBird(dataUrl) {
  const s = String(dataUrl ?? '').trim()
  if (!s.startsWith('data:audio')) {
    throw new Error('Record a bird sound to continue')
  }
  if (s.length < 80) {
    throw new Error('Recording is too short')
  }
}

export default function CreateAccount({ initialProfile = null, onComplete, onCancel }) {
  const bridge = window.bridge
  const isEdit = Boolean(initialProfile?.publicId)
  const [phase, setPhase] = useState('profile')
  const [step, setStep] = useState(0)

  const [username, setUsername] = useState(initialProfile?.username ?? '')
  const [displayName, setDisplayName] = useState(initialProfile?.displayName ?? '')
  const [age, setAge] = useState(
    typeof initialProfile?.age === 'number' ? String(initialProfile.age) : ''
  )
  const [gender, setGender] = useState(initialProfile?.gender ?? '')
  const [city, setCity] = useState(initialProfile?.city ?? '')
  const [pronouns, setPronouns] = useState(initialProfile?.pronouns ?? '')
  const [bio, setBio] = useState(initialProfile?.bio ?? '')
  const [doodlePng, setDoodlePng] = useState(initialProfile?.doodlePng ?? '')
  const [birdSound, setBirdSound] = useState(initialProfile?.birdSound ?? '')
  const [favouriteCar, setFavouriteCar] = useState(initialProfile?.favouriteCar ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const lastQuestionStep = QUESTION_STEPS.length - 1

  function validateProfileStep() {
    const u = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,32}$/.test(u)) {
      throw new Error('Username must be 3–32 characters (letters, numbers, underscores)')
    }
    requireTrimmed(displayName, 'Display name', 80)
    const ageNum = Number(age)
    if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 120) {
      throw new Error('Enter a valid age between 18 and 120')
    }
    requireTrimmed(gender, 'Gender', 40)
  }

  function continueToQuestions() {
    setError('')
    try {
      validateProfileStep()
      setPhase('questions')
      setStep(0)
    } catch (err) {
      setError(err?.message || 'Check your profile')
    }
  }

  function goNextQuestion() {
    setError('')
    try {
      if (step === 0) validateDoodle(doodlePng)
      if (step === 1) validateBird(birdSound)
      if (step < lastQuestionStep) setStep((s) => s + 1)
    } catch (err) {
      setError(err?.message || 'Check this step')
    }
  }

  function goBack() {
    setError('')
    if (phase === 'questions' && step === 0) {
      setPhase('profile')
      return
    }
    if (phase === 'questions' && step > 0) {
      setStep((s) => s - 1)
    }
  }

  async function saveProfile() {
    setError('')
    setSaving(true)
    try {
      requireTrimmed(favouriteCar, 'Favourite car')
      validateDoodle(doodlePng)
      validateBird(birdSound)
      const saved = await bridge.accountSave({
        username,
        displayName,
        age,
        gender,
        city,
        pronouns,
        bio,
        doodlePng,
        birdSound,
        favouriteCar,
        publicId: initialProfile?.publicId,
        createdAt: initialProfile?.createdAt
      })
      onComplete(saved)
    } catch (err) {
      setError(err?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (phase === 'profile') {
      continueToQuestions()
      return
    }
    if (step < lastQuestionStep) {
      goNextQuestion()
      return
    }
    await saveProfile()
  }

  function onFormKeyDown(e) {
    if (e.key !== 'Enter') return
    if (e.target && 'tagName' in e.target && e.target.tagName === 'TEXTAREA') return
    e.preventDefault()
    if (phase === 'profile') {
      continueToQuestions()
      return
    }
    if (step < lastQuestionStep) goNextQuestion()
    else void saveProfile()
  }

  const questionMeta = [
    {
      title: 'Scribble something',
      description: 'Cursor, trackpad, or finger — keep it rough; that’s the point.'
    },
    {
      title: 'Bird sound',
      description: 'Record a few seconds. Field recordings welcome; impressions count.'
    },
    {
      title: 'Favourite car',
      description: 'Type the one you’d pick for a Sunday drive (or Monday commute).'
    }
  ][step]

  return (
    <div className='flex min-h-svh flex-col items-center justify-center p-6'>
      <Card className='w-full max-w-md'>
        <CardHeader className='space-y-4'>
          {phase === 'questions' ? (
            <>
              <SignupStepper current={step} steps={QUESTION_STEPS} />
              <Separator />
              <div>
                <CardTitle>{questionMeta.title}</CardTitle>
                <CardDescription>{questionMeta.description}</CardDescription>
              </div>
            </>
          ) : (
            <div>
              <CardTitle>{isEdit ? 'Edit profile' : 'Create profile'}</CardTitle>
              <CardDescription>
                Your details stay on this device. Next, a short stepper: doodle, bird clip,
                favourite car.
              </CardDescription>
            </div>
          )}
        </CardHeader>
        <Separator />
        <form onSubmit={handleSubmit} onKeyDown={onFormKeyDown}>
          <CardContent className='grid gap-5 pt-6'>
            {error ? (
              <p className='text-sm text-destructive' role='alert'>
                {error}
              </p>
            ) : null}

            {phase === 'profile' ? (
              <div className='grid gap-4'>
                <div className='grid gap-2'>
                  <Label htmlFor='username'>Username</Label>
                  <Input
                    id='username'
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete='username'
                    required
                    maxLength={32}
                    placeholder='lowercase_letters_123'
                    disabled={isEdit}
                    title='3–32 characters: a–z, 0–9, underscores'
                  />
                  {isEdit ? (
                    <p className='text-xs text-muted-foreground'>Username can’t be changed.</p>
                  ) : null}
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='displayName'>Display name</Label>
                  <Input
                    id='displayName'
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete='nickname'
                    required
                    maxLength={80}
                  />
                </div>
                <div className='grid grid-cols-2 gap-4'>
                  <div className='grid gap-2'>
                    <Label htmlFor='age'>Age</Label>
                    <Input
                      id='age'
                      type='number'
                      min={18}
                      max={120}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      required
                    />
                  </div>
                  <div className='grid gap-2'>
                    <Label htmlFor='gender'>Gender</Label>
                    <Input
                      id='gender'
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      required
                      maxLength={40}
                      placeholder='How you identify'
                    />
                  </div>
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='city'>City (optional)</Label>
                  <Input
                    id='city'
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    autoComplete='address-level2'
                    maxLength={80}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='pronouns'>Pronouns (optional)</Label>
                  <Input
                    id='pronouns'
                    value={pronouns}
                    onChange={(e) => setPronouns(e.target.value)}
                    maxLength={40}
                    placeholder='e.g. she/her'
                  />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='bio'>Bio (optional)</Label>
                  <Textarea
                    id='bio'
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className='min-h-[80px] resize-y'
                    placeholder='A short line about you…'
                  />
                </div>
              </div>
            ) : null}

            {phase === 'questions' && step === 0 ? (
              <DoodleCanvas value={doodlePng} onChange={setDoodlePng} />
            ) : null}

            {phase === 'questions' && step === 1 ? (
              <BirdSoundRecorder value={birdSound} onChange={setBirdSound} />
            ) : null}

            {phase === 'questions' && step === 2 ? (
              <div className='grid gap-2'>
                <Label htmlFor='favouriteCar'>Favourite car</Label>
                <Input
                  id='favouriteCar'
                  value={favouriteCar}
                  onChange={(e) => setFavouriteCar(e.target.value)}
                  autoComplete='off'
                  required
                  maxLength={120}
                  placeholder='Citroën Ami'
                />
              </div>
            ) : null}
          </CardContent>
          <CardFooter className='flex flex-wrap gap-2 border-t border-border pt-4'>
            {phase === 'questions' ? (
              <Button type='button' variant='outline' disabled={saving} onClick={goBack}>
                Back
              </Button>
            ) : null}
            {onCancel ? (
              <Button type='button' variant='outline' disabled={saving} onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            {phase === 'profile' ? (
              <Button type='submit' disabled={saving}>
                Continue to questions
              </Button>
            ) : step < lastQuestionStep ? (
              <Button type='button' disabled={saving} onClick={goNextQuestion}>
                Next
              </Button>
            ) : (
              <Button type='submit' disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Finish'}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
