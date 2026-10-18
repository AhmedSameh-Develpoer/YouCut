const fs = require('node:fs/promises')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

async function compile(source, destination) {
  const text = await fs.readFile(source, 'utf8')
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  await fs.writeFile(destination, output)
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const dist = path.join(root, 'dist')
  await fs.mkdir(dist, { recursive: true })
  const temp = await fs.mkdtemp(path.join(dist, '.youcut-recent-'))
  const userData = path.join(temp, 'user-data')
  const appData = path.join(temp, 'app-data')
  const projectsDirectory = path.join(temp, 'projects')
  const backupDirectory = path.join(temp, 'backups')
  await Promise.all([fs.mkdir(userData, { recursive: true }), fs.mkdir(appData, { recursive: true }), fs.mkdir(projectsDirectory, { recursive: true })])

  const electronStub = { app: { getPath: name => name === 'userData' ? userData : name === 'appData' ? appData : temp }, dialog: {} }
  const settingsPath = path.join(temp, 'app-settings.cjs')
  const activityPath = path.join(temp, 'activity-log.cjs')
  await fs.writeFile(settingsPath, `exports.getBackupDirectorySync = () => ${JSON.stringify(backupDirectory)}; exports.getIgnoredRecoveryTime = () => undefined;`)
  await fs.writeFile(activityPath, 'exports.recordActivity = () => {};')
  const settingsSource = await fs.readFile(path.join(root, 'src/main/app-settings.ts'), 'utf8')
  await fs.writeFile(path.join(temp, 'app-settings-test.cjs'), ts.transpileModule(settingsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
  const modulePath = path.join(temp, 'projects.cjs')
  await compile(path.join(root, 'src/main/projects.ts'), modulePath)

  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub
    if (parent?.filename === modulePath && request === './app-settings') return originalLoad.call(this, settingsPath, parent, isMain)
    if (parent?.filename === modulePath && request === './activity-log') return originalLoad.call(this, activityPath, parent, isMain)
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    let projects = require(modulePath)
    await projects.loadProjectRegistry()
    const sourcePath = path.join(root, 'package.json')
    const sourceInfo = await fs.stat(sourcePath)
    const projectPath = path.join(projectsDirectory, 'Sample.youcut')
    const created = await projects.createProject(projectPath, sourcePath, sourceInfo.size, sourceInfo.mtime.toISOString(), 'Sample', 'general')
    const firstList = await projects.listProjects()
    if (firstList.length !== 1 || firstList[0].projectId !== created.projectId) throw new Error('New project did not appear in Recent.')

    await new Promise(resolve => setTimeout(resolve, 5))
    const secondPath = path.join(projectsDirectory, 'Second.youcut')
    const second = await projects.createProject(secondPath, sourcePath, sourceInfo.size, sourceInfo.mtime.toISOString(), 'Second', 'general')
    await projects.readProject(created.projectId)
    const openedOrder = await projects.listProjects()
    if (openedOrder[0]?.projectId !== created.projectId || !openedOrder[0]?.lastOpenedAt || !openedOrder[0]?.projectAvailable) throw new Error('Opening a project did not move it to the top of Recent.')

    const movedPath = path.join(projectsDirectory, 'Moved.youcut')
    await fs.rename(secondPath, movedPath)
    const missing = (await projects.listProjects()).find(project => project.projectId === second.projectId)
    if (!missing || missing.projectAvailable) throw new Error('A moved project disappeared from Recent instead of being marked unavailable.')
    await projects.registerProjectFile(movedPath, second.projectId)
    const restored = (await projects.listProjects()).find(project => project.projectId === second.projectId)
    if (!restored?.projectAvailable) throw new Error('Reopening a moved project did not restore its Recent entry.')

    await fs.writeFile(path.join(userData, 'recent-projects.json'), JSON.stringify({ [created.projectId]: projectPath, [second.projectId]: movedPath }))
    delete require.cache[modulePath]
    projects = require(modulePath)
    await projects.loadProjectRegistry()
    const migrated = await projects.listProjects()
    if (migrated.length !== 2 || migrated.some(project => !project.name || !project.projectAvailable || Number.isNaN(Date.parse(project.lastOpenedAt)))) throw new Error('Legacy Recent records did not migrate with names and dates.')

    const updated = await projects.updateProjectCategory(created.projectId, 'education')
    delete require.cache[modulePath]
    projects = require(modulePath)
    await projects.loadProjectRegistry()
    const finalList = await projects.listProjects()
    const savedDocument = JSON.parse(await fs.readFile(projectPath, 'utf8'))
    if (updated.category !== 'education' || savedDocument.category !== 'education' || finalList.find(project => project.projectId === created.projectId)?.category !== 'education') throw new Error('Changed category was not persisted to the project and Recent.')
    const faceCam = { enabled: true, x: 0.12, y: 0.16, width: 0.3, height: 0.25, size: 0.35, placement: 'custom', positionX: 0.4, positionY: 0.55 }
    const keyframes = [{ time: 2, cropX: 0.1, cropY: 0.2, zoom: 1.2 }, { time: 8, cropX: 0.9, cropY: 0.8, zoom: 2.4 }]
    await projects.saveProject(created.projectId, { ...savedDocument.editor, faceCam, zoom: 1.1, keyframes })
    const cameraRoundTrip = await projects.readProject(created.projectId)
    if (JSON.stringify(cameraRoundTrip.project.editor.faceCam) !== JSON.stringify(faceCam)) throw new Error('Face camera settings did not persist through project save and reload.')
    if (JSON.stringify(cameraRoundTrip.project.editor.keyframes) !== JSON.stringify(keyframes) || cameraRoundTrip.project.editor.zoom !== 1.1) throw new Error('Framing keyframes and zoom did not persist through project save and reload.')
    let invalidKeyframesRejected = false
    try { await projects.saveProject(created.projectId, { ...cameraRoundTrip.project.editor, keyframes: [{ time: 3, cropX: 1.5, cropY: 0, zoom: 1 }] }) } catch { invalidKeyframesRejected = true }
    if (!invalidKeyframesRejected) throw new Error('Invalid framing keyframes were accepted.')
    const backups = await fs.readdir(path.join(backupDirectory, created.projectId))
    if (backups.length !== 2) throw new Error('Project edits did not retain the latest two healthy backup snapshots.')

    const legacy = await projects.createProject(path.join(projectsDirectory, 'Legacy.youcut'), sourcePath, sourceInfo.size, sourceInfo.mtime.toISOString(), 'Legacy', 'general')
    await fs.writeFile(path.join(userData, 'recent-projects.json'), JSON.stringify({ [created.projectId]: projectPath, [second.projectId]: movedPath }))
    await fs.mkdir(path.join(appData, 'Electron'), { recursive: true })
    await fs.writeFile(path.join(appData, 'Electron', 'recent-projects.json'), JSON.stringify({ [legacy.projectId]: path.join(projectsDirectory, 'Legacy.youcut') }))
    delete require.cache[modulePath]
    projects = require(modulePath)
    await projects.loadProjectRegistry()
    const afterRestart = await projects.listProjects()
    if (afterRestart.length !== 3 || !afterRestart.some(project => project.projectId === legacy.projectId && project.projectAvailable)) throw new Error('Projects saved under the previous Electron user-data folder were not migrated into Recent.')
    process.stdout.write(JSON.stringify({ recentSurvivesRestart: true, lastOpenedSort: true, missingProjectRetained: true, movedProjectRestored: true, legacyRecentMigration: true, previousUserDataMigration: true, faceCamRoundTrip: true, keyframePersistence: true, invalidKeyframeRejected: true, changedCategory: savedDocument.category, backupCount: backups.length }) + '\n')
  } finally {
    Module._load = originalLoad
    await fs.rm(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
