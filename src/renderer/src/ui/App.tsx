import { useEffect, useState } from 'react'
import { useWorkspace } from '../state/workspace'

const copy = {
  en: {
    workspace: 'Your workspace', subtitle: 'Pick up where you left off.', recent: 'Recent projects',
    empty: 'Your next good clip starts here.', emptyHelp: 'Choose a video from your computer to begin a project.',
    newProject: 'New project', importTitle: 'Bring in your source', importHelp: 'Paste a video link or choose a file from your computer.',
    chooseVideo: 'Choose video', choosing: 'Opening file picker…', supported: 'MP4, MOV, MKV, WebM or AVI', back: 'Projects',
    linkLabel: 'Video link', linkPlaceholder: 'Paste a YouTube, Twitch, TikTok or other video link', linkHelp: 'Link downloading is not connected yet; local video import works now.', next: 'Next',
    fileReady: 'Source selected', fileHelp: 'Your source is ready. Choose a project category and continue to editing tools.',
    changeVideo: 'Choose another video', exportFolder: 'Choose export location', exportReady: 'Export location',
    noExport: 'Video processing is not connected yet.', app: 'Local video workspace', version: 'App shell', error: 'Something went wrong',
    linkSource: 'Video link', fileSource: 'Local file', workspaceNext: 'Continue to workspace', noLinkExport: 'Import the linked video before choosing an export location.',
  },
  ar: {
    workspace: 'مساحة العمل', subtitle: 'كمّل من المكان اللي وقفت عنده.', recent: 'المشاريع الأخيرة',
    empty: 'مقطعك الجاي يبدأ من هنا.', emptyHelp: 'اختار فيديو من جهازك عشان تبدأ مشروع.',
    newProject: 'مشروع جديد', importTitle: 'أضف الفيديو', importHelp: 'الصق رابط الفيديو أو اختار ملف من جهازك.',
    chooseVideo: 'اختيار فيديو', choosing: 'جارٍ فتح نافذة الملفات…', supported: 'MP4 أو MOV أو MKV أو WebM أو AVI', back: 'المشاريع',
    linkLabel: 'رابط الفيديو', linkPlaceholder: 'الصق رابط YouTube أو Twitch أو TikTok أو غيره', linkHelp: 'تنزيل الفيديو من الرابط لسه غير مربوط؛ استيراد الملفات المحلية يعمل.', next: 'التالي',
    fileReady: 'تم اختيار المصدر', fileHelp: 'المصدر جاهز. اختار فئة المشروع ثم انتقل لأدوات العمل.',
    changeVideo: 'اختيار فيديو آخر', exportFolder: 'اختيار مكان التصدير', exportReady: 'مكان التصدير',
    noExport: 'معالجة الفيديو لم تُربط بعد.', app: 'مساحة فيديو محلية', version: 'هيكل التطبيق', error: 'حصلت مشكلة',
    linkSource: 'رابط فيديو', fileSource: 'ملف محلي', workspaceNext: 'الدخول لمساحة العمل', noLinkExport: 'نزّل الفيديو المرتبط أولًا قبل اختيار مكان التصدير.',
  },
} as const

function formatBytes(bytes: number, language: 'en' | 'ar') {
  const units = language === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب'] : ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

export function App() {
  const { screen, language, source, importStatus, exportLocation, error, goTo, toggleLanguage, setSystemLanguage, pickVideo, setVideoLink, continueToWorkspace, chooseExportLocation, clearSource } = useWorkspace()
  const t = copy[language]
  const [version, setVersion] = useState('')
  const [videoLink, setVideoLinkInput] = useState('')

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  useEffect(() => {
    void window.youcut.getAppInfo().then((info) => {
      setVersion(info.version)
      setSystemLanguage(info.language)
    }).catch(() => setVersion(''))
  }, [])

  return (
    <main className="app" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <button className="brand" onClick={() => goTo('projects')} aria-label="YouCut home"><span className="brand-mark">Y</span><span>YouCut</span></button>
        <div className="topbar-spacer" />
        <span className="local-pill"><span className="local-dot" />{t.app}</span>
        <button className="language-button" onClick={toggleLanguage}>{language === 'en' ? 'العربية' : 'English'}</button>
      </header>

      <section className="content">
        {screen === 'projects' && (
          <div className="projects-page fade-in">
            <div className="page-heading"><div><p className="eyebrow">YOUCUT / PROJECTS</p><h1>{t.workspace}</h1><p className="subheading">{t.subtitle}</p></div><button className="button-primary" onClick={() => goTo('import')}><span className="plus">＋</span>{t.newProject}</button></div>
            <section className="recent-section"><div className="section-heading"><h2>{t.recent}</h2><span className="count-badge">0</span></div><div className="empty-state"><div className="empty-art" aria-hidden="true"><span className="art-disc disc-one" /><span className="art-disc disc-two" /><span className="art-play">▶</span><span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span></div><h3>{t.empty}</h3><p>{t.emptyHelp}</p><button className="button-secondary" onClick={() => goTo('import')}>{t.newProject}<span aria-hidden="true"> ↗</span></button></div></section>
          </div>
        )}

        {screen === 'import' && (
          <div className="import-page fade-in"><button className="back-button" onClick={() => goTo('projects')}>← <span>{t.back}</span></button><div className="import-card"><div className="import-icon">↥</div><p className="eyebrow">NEW PROJECT</p><h1>{t.importTitle}</h1><p className="subheading">{t.importHelp}</p><label className="field-label" htmlFor="video-link">{t.linkLabel}</label><input className="link-input" id="video-link" type="url" dir="ltr" value={videoLink} onChange={(event) => { setVideoLinkInput(event.target.value); setVideoLink(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter' && source) continueToWorkspace() }} placeholder={t.linkPlaceholder} /><p className="link-help">{t.linkHelp}</p><div className="import-divider"><span>OR</span></div><button className="button-secondary choose-button" onClick={() => void pickVideo()} disabled={importStatus === 'choosing'}><span>＋</span>{importStatus === 'choosing' ? t.choosing : t.chooseVideo}</button><p className="file-types">{t.supported}</p><p className="local-note"><span className="local-dot" />{t.app}</p>{source && <section className="source-card selected-source"><div className="source-thumb"><span>▶</span></div><div className="source-info"><strong>{source.name}</strong><small>{source.kind === 'file' ? t.fileSource : t.linkSource}</small><small className="path-text">{source.kind === 'file' ? source.path : source.url}</small></div></section>}<button className="button-primary next-button" onClick={continueToWorkspace} disabled={!source || importStatus === 'choosing'}>{t.next}<span aria-hidden="true"> →</span></button>{error && <p className="error-message" role="alert">{t.error}: {error}</p>}</div></div>
        )}

        {screen === 'ready' && source && (
          <div className="ready-page fade-in"><button className="back-button" onClick={() => goTo('import')}>← <span>{t.back}</span></button><div className="ready-heading"><div><p className="eyebrow">NEW PROJECT</p><h1>{t.fileReady}</h1><p className="subheading">{t.fileHelp}</p></div><span className="ready-check">✓</span></div><section className="source-card"><div className="source-thumb"><span>▶</span></div><div className="source-info"><strong title={source.name}>{source.name}</strong><small>{source.kind === 'file' ? formatBytes(source.sizeBytes, language) : t.linkSource}</small><small className="path-text" title={source.kind === 'file' ? source.path : source.url}>{source.kind === 'file' ? source.path : source.url}</small></div><button className="text-button" onClick={() => { clearSource(); setVideoLinkInput('') }}>{t.changeVideo}</button></section>{source.kind === 'link' && <p className="link-help">{t.noLinkExport}</p>}<div className="next-step-card"><div className="step-number">01</div><div><strong>{t.exportFolder}</strong><p>{exportLocation?.path ?? t.noExport}</p></div><button className="button-secondary" onClick={() => void chooseExportLocation()} disabled={source.kind === 'link'}>{exportLocation ? t.exportReady : t.exportFolder}</button></div>{error && <p className="error-message" role="alert">{t.error}: {error}</p>}</div>
        )}
      </section>

      <footer className="statusbar"><span><span className="status-dot" />{t.app}</span><span>{version ? `v${version}` : t.version}</span></footer>
    </main>
  )
}
