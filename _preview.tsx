import { createRoot } from 'react-dom/client'
import { LanguageProvider } from './src/i18n'
import BibleQuiz from './src/BibleQuiz'
import './src/index.css'
const user: any = { uid: 'preview', displayName: 'Wendtoin', email: 'x', role: 'member', avatar: '' }
createRoot(document.getElementById('root')!).render(
  <LanguageProvider><BibleQuiz user={user} onClose={() => {}} /></LanguageProvider>
)
