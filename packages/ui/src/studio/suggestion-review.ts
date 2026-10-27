import type { Platform } from './types'

type ReviewTarget = { projectId: string; platform: Platform; id: string }
let pending: ReviewTarget | null = null
const event = 'studio:suggestion-review'

// Keep the request until the destination article/platform has mounted.
export function requestSuggestionReview(target: ReviewTarget) {
  pending = target
  window.dispatchEvent(new Event(event))
}

export function watchSuggestionReview(projectId: string, platform: Platform, reveal: (id: string) => void) {
  const receive = () => {
    if (pending?.projectId !== projectId || pending.platform !== platform) return
    const id = pending.id
    pending = null
    reveal(id)
  }
  window.addEventListener(event, receive)
  receive()
  return () => window.removeEventListener(event, receive)
}
