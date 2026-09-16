// Client helpers for the lead-only transcription tool. Audio/video is turned
// into text by the transcribePost / transcribeUpload Cloud Functions (Google
// Cloud Speech-to-Text). Long sermons can take minutes, so the UI subscribes to
// a Firestore doc for the result rather than waiting on the callable's return -
// the function keeps running and writes the doc even if the call times out.
import { httpsCallable } from 'firebase/functions'
import { doc, addDoc, onSnapshot, deleteDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytesResumable, deleteObject } from 'firebase/storage'
import { functions, db, storage } from './firebase'

export interface TranscriptDoc { status?: 'processing' | 'done' | 'error'; text?: string; error?: string }

// Callable. The client-side timeout is generous, but the Firestore
// subscription is the source of truth for the finished transcript.
const callTranscribeUpload = httpsCallable<{ jobId: string; path: string }, { text: string }>(
  functions, 'transcribeUpload', { timeout: 540000 })

// ---- Read-tab upload tool ---------------------------------------------------
export function subscribeJob(jobId: string, cb: (t: TranscriptDoc | null) => void): () => void {
  return onSnapshot(doc(db, 'transcribeJobs', jobId),
    snap => cb(snap.exists() ? (snap.data() as TranscriptDoc) : null),
    () => cb(null))
}

// Upload a scratch file to the caller's transcribe-uploads space. Returns the
// storage path (the Cloud Function deletes it once transcribed).
export function uploadForTranscription(
  uid: string, file: File, onProgress: (pct: number) => void,
): Promise<string> {
  const path = `transcribe-uploads/${uid}/${Date.now()}-${file.name}`
  const task = uploadBytesResumable(ref(storage, path), file)
  return new Promise((resolve, reject) => {
    task.on('state_changed',
      s => onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      reject,
      () => resolve(path))
  })
}

// Create the job doc the UI subscribes to, then kick off transcription.
export async function startUploadTranscription(uid: string, path: string): Promise<string> {
  const jobRef = await addDoc(collection(db, 'transcribeJobs'), {
    ownerUid: uid, status: 'processing', createdAt: serverTimestamp(),
  })
  requestUploadTranscript(jobRef.id, path)
  return jobRef.id
}

async function requestUploadTranscript(jobId: string, path: string): Promise<void> {
  try { await callTranscribeUpload({ jobId, path }) } catch { /* subscription delivers it */ }
}

// Clean up a finished job doc (the media is already deleted server-side). If the
// upload failed before the function ran, also drop the orphaned storage object.
export async function clearJob(jobId: string, orphanPath?: string): Promise<void> {
  try { await deleteDoc(doc(db, 'transcribeJobs', jobId)) } catch { /* ignore */ }
  if (orphanPath) { try { await deleteObject(ref(storage, orphanPath)) } catch { /* already gone */ } }
}
