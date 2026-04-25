import characters from '../../data/characters/characters.json'

function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function pickThreeCharacters() {
  return shuffle(characters).slice(0, 3)
}
