import { useState } from 'react'
import { useF1Data } from '../domain/f1DataContext'

function DemoAction({ primary = false }: { primary?: boolean }): React.JSX.Element {
  const { demoConfigured } = useF1Data()
  const [message, setMessage] = useState<string | null>(null)

  const startDemo = (): void => {
    if (!demoConfigured) {
      setMessage('Demo video is not configured.')
      return
    }
    setMessage(null)
    window.api.startDemo()
  }

  return <div className={primary ? 'demo-action is-primary' : 'demo-action'}>
    <button onClick={startDemo} type="button">TRY DEMO</button>
    {message ? <span role="status">{message}</span> : null}
  </div>
}

export default DemoAction
