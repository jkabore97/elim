import { Component, type ReactNode, type ErrorInfo } from 'react'

// A crash anywhere in the tree used to unmount everything and leave a blank
// white page - no message, nothing to report, nothing to act on. This catches
// it and shows what actually went wrong, so a problem can be described instead
// of guessed at.
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; info: string }
> {
  state = { error: null as Error | null, info: '' }

  static getDerivedStateFromError(error: Error) {
    return { error, info: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info: info.componentStack || '' })
    console.error('ELIM crashed:', error, info)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-[#0f172a] text-slate-200 p-6 overflow-y-auto">
        <div className="max-w-lg mx-auto pt-10">
          <h1 className="text-xl font-bold text-white">Something went wrong</h1>
          <p className="text-sm text-slate-400 mt-2">
            Please send this screen to support so it can be fixed.
          </p>

          <div className="mt-5 rounded-2xl bg-red-500/10 border border-red-500/25 p-4">
            <p className="text-sm font-semibold text-red-300 break-words">
              {error.name}: {error.message}
            </p>
          </div>

          {error.stack && (
            <pre className="mt-4 text-[10px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words bg-black/30 rounded-xl p-3 max-h-52 overflow-y-auto">
              {error.stack.slice(0, 1200)}
            </pre>
          )}

          {info && (
            <pre className="mt-3 text-[10px] leading-relaxed text-slate-500 whitespace-pre-wrap break-words bg-black/30 rounded-xl p-3 max-h-40 overflow-y-auto">
              {info.slice(0, 800)}
            </pre>
          )}

          <button
            onClick={() => { this.setState({ error: null, info: '' }); window.location.reload() }}
            className="mt-6 w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition"
          >
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}
