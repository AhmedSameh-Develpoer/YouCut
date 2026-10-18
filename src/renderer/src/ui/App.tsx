import { useEffect, useState } from 'react'
import { useEditor } from '../state/editor'
import { Editor } from './Editor'
import { useWorkspace } from '../state/workspace'
import type { ActivityEntry, BackupSettings, ProjectCategory } from '../../../shared/contracts'

const copy = {
  en: {
    workspace: 'Your workspace', subtitle: 'Pick up where you left off.', recent: 'Recent projects', sourceMissing: 'Source video missing · select it again to relink', projectMissing: 'Project file moved or unavailable · locate the .youcut file', openProject: 'Open project',
    empty: 'Your next good clip starts here.', emptyHelp: 'Choose a video from your computer to begin a project.',
    newProject: 'New project', importTitle: 'Bring in your source', importHelp: 'Paste a video link or choose a file from your computer.',
    chooseVideo: 'Choose video', choosing: 'Opening file picker…', supported: 'MP4, MOV, MKV, WebM, AVI and other FFmpeg-readable formats', back: 'Projects', switchToLight: 'Use light theme', switchToDark: 'Use dark theme',
    linkLabel: 'Video link', linkPlaceholder: 'Paste a YouTube, Twitch, TikTok or other video link', linkHelp: 'Link downloading is not connected yet; local video import works now.', next: 'Next',
    fileReady: 'Source selected', fileHelp: 'Source selected. Create a project to open it in the editor.',
    changeVideo: 'Choose another video', exportFolder: 'Choose export location', exportReady: 'Export location',
    noExport: 'Video processing is not connected yet.', app: 'Local video workspace', version: 'App shell', error: 'Something went wrong',
    linkSource: 'Video link', fileSource: 'Local file', workspaceNext: 'Continue to workspace', noLinkExport: 'Import the linked video before choosing an export location.',
  },
  ar: {
    workspace: 'مساحة العمل', subtitle: 'كمّل من المكان اللي وقفت عنده.', recent: 'المشاريع الأخيرة', sourceMissing: 'الفيديو الأصلي غير موجود · اختره مجددًا لإعادة ربط المشروع', projectMissing: 'ملف المشروع اتحرك أو مش متاح · حدد ملف .youcut', openProject: 'فتح مشروع',
    empty: 'مقطعك الجاي يبدأ من هنا.', emptyHelp: 'اختار فيديو من جهازك عشان تبدأ مشروع.',
    newProject: 'مشروع جديد', importTitle: 'أضف الفيديو', importHelp: 'الصق رابط الفيديو أو اختار ملف من جهازك.',
    chooseVideo: 'اختيار فيديو', choosing: 'جارٍ فتح نافذة الملفات…', supported: 'MP4 وMOV وMKV وWebM وAVI وصيغ أخرى قابلة للقراءة عبر FFmpeg', back: 'المشاريع', switchToLight: 'استخدم المظهر الفاتح', switchToDark: 'استخدم المظهر الداكن',
    linkLabel: 'رابط الفيديو', linkPlaceholder: 'الصق رابط YouTube أو Twitch أو TikTok أو غيره', linkHelp: 'تنزيل الفيديو من الرابط لسه غير مربوط؛ استيراد الملفات المحلية يعمل.', next: 'التالي',
    fileReady: 'تم اختيار المصدر', fileHelp: 'تم اختيار المصدر. أنشئ مشروعًا لفتحه في المحرر.',
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
  const { screen, language, source, importStatus, error, goTo, toggleLanguage, setSystemLanguage, pickVideo, cancelImport, setVideoLink, continueToWorkspace, clearSource, currentProjectId, currentProjectCategory, categorySaving, categoryError, updateProjectCategory, currentSettings, projects, projectsLoading, projectsError, projectOperation, loadRecentProjects, openProject, openProjectFile } = useWorkspace()
  const exportBusy = useEditor(state => state.exportChoosing || state.job?.status === 'running' || state.previewStarting || state.previewJob?.status === 'running')
  const t = copy[language]
  const [version, setVersion] = useState('')
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([])
  const [activityError, setActivityError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [backupSettings, setBackupSettings] = useState<BackupSettings|null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [videoLink, setVideoLinkInput] = useState('')
  const [category, setCategory] = useState<ProjectCategory>('general')
  const [theme, setTheme] = useState<'dark'|'light'>(() => { try { return localStorage.getItem('youcut-theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' } })
  const ar = language === 'ar'
  const busy = importStatus === 'choosing'
  useEffect(() => {
    const onError = (event: ErrorEvent) => { void window.youcut.recordUiError(event.message || 'Renderer error.') }
    const onRejection = (event: PromiseRejectionEvent) => { void window.youcut.recordUiError(event.reason instanceof Error ? event.reason.message : String(event.reason)) }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
  }, [])
  const categoryNames: Record<ProjectCategory,string> = ar?{general:'عام',gaming:'ألعاب',podcast:'بودكاست',interview:'مقابلة',reaction:'رد فعل',education:'تعليمي'}:{general:'General',gaming:'Gaming',podcast:'Podcast',interview:'Interview',reaction:'Reaction',education:'Educational'}
  const categoryTips: Record<ProjectCategory,string> = ar?{general:'سيبحث التحليل عن لحظات متنوعة بدون فلتر مسبق.',gaming:'نصيحة: اختر الشخصية أو اللاعب كهدف للكادر عند توفر التتبع.',podcast:'نصيحة: ركّز على المتحدث أو استخدم كادرًا يظهر الشخصين.',interview:'نصيحة: احتفظ بتبديل المتحدثين واضحًا واختر كادرًا يناسب الطرفين.',reaction:'نصيحة: احتفظ بالمحتوى الأساسي وأضف كاميرا الوجه عند الحاجة.',education:'نصيحة: ابحث عن الشرح والنقاط المهمة، مع إبقاء كل الأنواع متاحة.'}:{general:'Analysis will look for varied moments without a preset filter.',gaming:'Tip: choose the player or character as the framing target when tracking is available.',podcast:'Tip: focus on the active speaker or use a frame that shows both people.',interview:'Tip: keep speaker changes clear and choose a frame that fits both people.',reaction:'Tip: keep the source content visible and add face camera when useful.',education:'Tip: look for explanations and key points while keeping all moment types available.'}
  const statusText = projectOperation === 'creating' ? (ar ? 'اختار مكان حفظ ملف المشروع .youcut.' : 'Choose where to save the .youcut project file.') : busy ? (ar ? 'نافذة الملفات مفتوحة؛ اختار فيديو أو اقفل النافذة للرجوع.' : 'File picker is open. Choose a video or close the dialog.')
    : importStatus === 'unsupported' ? (ar ? 'صيغة الرابط صحيحة. تنزيل الروابط غير متاح بعد؛ لم يبدأ أي تحميل. اختار ملفًا محليًا للمتابعة.' : 'Valid link format. Link downloads are not available yet; no download is running. Choose a local file to continue.')
    : importStatus === 'ready' ? (ar ? 'تم اختيار الملف. اضغط التالي للمتابعة.' : 'File selected. Click Next to continue.')
    : error ? (ar ? (error === 'invalid-link' ? 'اكتب رابطًا كاملًا يبدأ بـ https:// أو اختار ملفًا.' : 'تعذر اختيار الملف أو انتهت المهلة. اقفل أي نافذة ملفات مفتوحة وأعد المحاولة.') : (error === 'invalid-link' ? 'Enter a complete https:// link or choose a file.' : 'File selection failed or timed out. Close any open dialog and retry.'))
    : (ar ? 'في انتظار اختيار فيديو. لا يوجد تحميل جارٍ.' : 'Waiting for a video. No download is running.')

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('youcut-theme', theme) } catch { /* Keep theme for this session if storage is unavailable. */ }
  }, [theme])

  useEffect(() => {
    void window.youcut.getAppInfo().then((info) => {
      setVersion(info.version)
      setSystemLanguage(info.language)
    }).catch(() => setVersion(''))
  }, [])

  useEffect(() => { void loadRecentProjects() }, [loadRecentProjects])

  return (
    <main className="app" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <button disabled={exportBusy} className="brand" onClick={() => { if(screen==='ready'){clearSource();void loadRecentProjects()}else goTo('projects') }} aria-label="YouCut home"><span className="brand-mark">Y</span><span>YouCut</span></button>
        <div className="topbar-spacer" />
        <span className="local-pill"><span className="local-dot" />{t.app}</span>
        <button className="language-button theme-button" aria-pressed={theme==='light'} onClick={()=>setTheme(value=>value==='dark'?'light':'dark')}>{theme==='dark'?'☼':'◐'} <span>{theme==='dark'?t.switchToLight:t.switchToDark}</span></button>
        <button className="language-button" onClick={toggleLanguage}>{language === 'en' ? 'العربية' : 'English'}</button>
      </header>

      <section className="content">
        {screen === 'projects' && (
          <div className="projects-page fade-in">
            <div className="page-heading"><div><p className="eyebrow">YOUCUT / PROJECTS</p><h1>{t.workspace}</h1><p className="subheading">{t.subtitle}</p></div><button className="button-primary" onClick={() => goTo('import')}><span className="plus">＋</span>{t.newProject}</button></div>
            <section className="recent-section"><div className="section-heading"><h2>{t.recent}</h2><span className="count-badge">{projects.length}</span><button className="button-secondary recent-open-button" disabled={projectOperation!=='idle'} onClick={()=>void openProjectFile()}>{projectOperation==='opening'&&<span className="spinner"/>}{t.openProject}</button></div>{projectsLoading&&<p className="link-help">{ar?'جارٍ تحميل المشاريع…':'Loading projects…'}</p>}{projectsError&&<p className="error-message" role="alert">{projectsError}</p>}{projects.length>0?<div className="recent-list">{projects.map(project=><button className="recent-project" key={project.projectId} disabled={projectOperation!=='idle'} onClick={()=>void(project.projectAvailable?openProject(project.projectId):openProjectFile(project.projectId))}><span className="recent-project-icon">▶</span><span className="recent-project-info"><strong>{project.name}</strong><small>{categoryNames[project.category]} · {project.sourceName}</small>{!project.projectAvailable&&<small className="missing-source">{t.projectMissing}</small>}{project.projectAvailable&&!project.sourceAvailable&&<small className="missing-source">{t.sourceMissing}</small>}</span><time dateTime={project.lastOpenedAt}>{new Intl.DateTimeFormat(language==='ar'?'ar-EG':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date(project.lastOpenedAt))}</time><span className="recent-open">{projectOperation==='opening'?(ar?'جارٍ الفتح…':'Opening…'):'↗'}</span></button>)}</div>:!projectsLoading&&<div className="empty-state"><div className="empty-art" aria-hidden="true"><span className="art-disc disc-one" /><span className="art-disc disc-two" /><span className="art-play">▶</span><span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✦</span></div><h3>{t.empty}</h3><p>{t.emptyHelp}</p><button className="button-secondary" onClick={() => goTo('import')}>{t.newProject}<span aria-hidden="true"> ↗</span></button></div>}</section>
          </div>
        )}

        {screen === 'import' && (
          <div className="import-page fade-in"><button className="back-button" onClick={() => goTo('projects')}>← <span>{t.back}</span></button><div className="import-card"><div className="import-icon">↥</div><p className="eyebrow">NEW PROJECT</p><h1>{t.importTitle}</h1><p className="subheading">{t.importHelp}</p><label className="field-label" htmlFor="project-category">{ar?'فئة المحتوى':'Content category'}</label><select id="project-category" className="category-select" value={category} onChange={event=>setCategory(event.target.value as ProjectCategory)}>{(['general','gaming','podcast','interview','reaction','education'] as ProjectCategory[]).map(value=><option key={value} value={value}>{categoryNames[value]}</option>)}</select><p className="link-help category-tip">{categoryTips[category]}</p><label className="field-label" htmlFor="video-link">{t.linkLabel}</label><input disabled={busy||projectOperation!=='idle'} aria-describedby="import-status" className="link-input" id="video-link" type="url" dir="ltr" value={videoLink} onChange={(event) => { setVideoLinkInput(event.target.value); setVideoLink(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter' && importStatus === 'ready') void continueToWorkspace(category) }} placeholder={t.linkPlaceholder} /><p className="link-help">{t.linkHelp}</p><div className="import-divider"><span>{ar ? 'أو' : 'OR'}</span></div><button className="button-secondary choose-button" onClick={() => void pickVideo()} disabled={busy||projectOperation!=='idle'} aria-busy={busy}><span aria-hidden="true" className={busy ? 'spinner' : ''}>{busy ? '' : '＋'}</span>{importStatus === 'choosing' ? t.choosing : t.chooseVideo}</button><p className="file-types">{t.supported}</p><p className="local-note"><span className="local-dot" />{t.app}</p>{source && <section className="source-card selected-source"><div className="source-thumb"><span>▶</span></div><div className="source-info"><strong>{source.name}</strong><small>{source.kind === 'file' ? t.fileSource : t.linkSource}</small><small className="path-text">{source.kind === 'file' ? source.path : source.url}</small></div></section>}<button className="button-primary next-button" onClick={() => void continueToWorkspace(category)} disabled={importStatus !== 'ready'||projectOperation!=='idle'} aria-busy={projectOperation==='creating'}>{projectOperation==='creating'&&<span className="spinner"/>}{projectOperation==='creating'?(ar?'جارٍ إنشاء المشروع…':'Creating project…'):(ar?'فتح المحرر':'Open editor')}<span aria-hidden="true"> →</span></button><div id="import-status" className="operation-status" role="status" aria-live="polite" aria-atomic="true">{(busy||projectOperation==='creating') && <span className="spinner" aria-hidden="true" />}<span>{statusText}</span></div>{busy && <button className="text-button" onClick={cancelImport}>{ar ? 'إلغاء الانتظار' : 'Cancel waiting'}</button>}{projectsError&&<p className="error-message" role="alert">{projectsError}</p>}</div></div>
        )}

        {screen === 'ready' && source?.kind === 'file' && currentProjectId && currentSettings && <Editor key={currentProjectId} source={source} language={language} projectId={currentProjectId} initialSettings={currentSettings} category={currentProjectCategory || 'general'} categorySaving={categorySaving} categoryError={categoryError} onCategoryChange={category => void updateProjectCategory(category)} onBack={() => { clearSource(); setVideoLinkInput(''); void loadRecentProjects() }} />}

      </section>

      {settingsOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!settingsBusy)setSettingsOpen(false)}}><section className="activity-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><p className="eyebrow">YOUCUT</p><h2 id="settings-title">{ar?'الإعدادات':'Settings'}</h2></div><button className="text-button" disabled={settingsBusy} onClick={()=>setSettingsOpen(false)} aria-label={ar?'إغلاق':'Close'}>✕</button></header><h3>{ar?'مجلد النسخ الاحتياطي':'Backup folder'}</h3><p className="link-help">{ar?'يحفظ YouCut نسختين سابقتين من ملفات المشاريع فقط، من دون نسخ الفيديو الأصلي أو الكاش.':'YouCut keeps two previous project-file snapshots. Source videos and cache are not copied.'}</p><div className="backup-location" dir="ltr">{backupSettings?.directory||'Loading…'}</div>{backupSettings&&<p className={backupSettings.available?'link-help':'error-message'} role="status">{!backupSettings.available?(ar?'المجلد غير متاح؛ سيستمر حفظ المشروع الأساسي بدون نسخة احتياطية.':'Folder unavailable. The main project will still be saved without a backup.'):(backupSettings.isDefault?(ar?'المجلد المحلي الافتراضي في Documents':'Default local folder under Documents'):(ar?'مجلد مخصص':'Custom folder'))}</p>}{settingsError&&<p className="error-message" role="alert">{settingsError}</p>}<footer><button className="button-secondary" disabled={settingsBusy} onClick={()=>{setSettingsBusy(true);setSettingsError('');void window.youcut.chooseBackupDirectory().then(value=>{if(value)setBackupSettings(value)}).catch(error=>setSettingsError(error instanceof Error?error.message:'Could not change backup folder.')).finally(()=>setSettingsBusy(false))}}>{settingsBusy&&<span className="spinner"/>}{ar?'تغيير المجلد':'Change folder'}</button></footer></section></div>}
      {activityOpen&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setActivityOpen(false)}}><section className="activity-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-title"><header><div><p className="eyebrow">LOCAL DIAGNOSTICS</p><h2 id="activity-title">{ar?'حالة التطبيق والنشاط':'App activity'}</h2></div><button className="text-button" onClick={()=>setActivityOpen(false)} aria-label={ar?'إغلاق':'Close'}>✕</button></header><p className="link-help">{ar?'السجل محفوظ محليًا فقط، ولا يتضمن ملفات الفيديو أو روابط المصدر.':'Logs are stored on this device only. Video files and source links are not included.'}</p>{activityError&&<p className="error-message" role="alert">{activityError}</p>}<div className="activity-list">{activityEntries.length?activityEntries.map((entry,index)=><article className={`activity-entry ${entry.level}`} key={`${entry.at}-${index}`}><time dir="ltr">{new Intl.DateTimeFormat(language==='ar'?'ar-EG':'en-US',{dateStyle:'short',timeStyle:'medium'}).format(new Date(entry.at))}</time><strong>{entry.event.replaceAll('-',' ')}</strong>{entry.operationId&&<small dir="ltr">{entry.operationId}</small>}{entry.details&&<p>{entry.details}</p>}</article>):<p className="link-help">{ar?'لا توجد أحداث مسجلة بعد.':'No activity has been recorded yet.'}</p>}</div><footer><button className="button-secondary" onClick={()=>{void window.youcut.getRecentActivity().then(setActivityEntries).catch(()=>setActivityError(ar?'تعذر تحميل السجل المحلي.':'Could not load local activity.'))}}>{ar?'تحديث':'Refresh'}</button><button className="button-primary" onClick={()=>{setActivityError('');void window.youcut.exportActivityReport().then(ok=>{if(!ok)return;setActivityError(ar?'تم حفظ تقرير التشخيص.':'Diagnostic report saved.')}).catch(error=>setActivityError(error instanceof Error?error.message:'Could not export diagnostic report.'))}}>{ar?'تصدير تقرير التشخيص':'Export diagnostic report'}</button></footer></section></div>}
      <footer className="statusbar"><span><span className="status-dot" />{t.app}</span><div className="status-actions"><button className="activity-button" onClick={()=>{setSettingsOpen(true);setSettingsError('');void window.youcut.getBackupSettings().then(setBackupSettings).catch(error=>setSettingsError(error instanceof Error?error.message:'Could not load settings.'))}}>{ar?'الإعدادات':'Settings'}</button><button className="activity-button" onClick={()=>{setActivityOpen(true);setActivityError('');void window.youcut.getRecentActivity().then(setActivityEntries).catch(()=>setActivityError(ar?'تعذر تحميل السجل المحلي.':'Could not load local activity.'))}}>{ar?'النشاط':'Activity'}</button></div><span>{version ? `v${version}` : t.version}</span></footer>
    </main>
  )
}
