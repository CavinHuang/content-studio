import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  Database,
  Eye,
  EyeOff,
  FileUp,
  HardDrive,
  Image,
  Mic,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Badge, CheckOption, download, Empty, Field, Modal, PageTitle, PlatformMark } from '../components/ui'
import { useStudio } from '../studio/store'
import { seedState } from '../studio/mock'
import { recoverCreation } from '../studio/creation'
import { PLATFORMS, type Platform, type StudioState } from '../studio/types'

export function SettingsPage() {
  const {
    state,
    setState,
    project,
    navigate,
    notify,
    retrySave,
    clearAgentDrafts,
    aiReady,
    saveAiConfig,
    testAiConnection,
    clearAiConfig,
    ttsReady,
    ttsConfig,
    saveTtsConfig,
    clearTtsConfig,
  } = useStudio()
  const [tab, setTab] = useState('AI 服务')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModelId, setAiModelId] = useState('')
  const [aiKey, setAiKey] = useState('')
  const [aiKeyTail, setAiKeyTail] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestMessage, setAiTestMessage] = useState('')
  useEffect(() => {
    void window.desktop?.aiConfigGet().then((view) => {
      if (view) {
        setAiBaseUrl(view.baseUrl)
        setAiModelId(view.modelId)
        setAiKeyTail(view.apiKeyTail)
      }
    })
  }, [])
  // 语音服务（P5）：字段随脱敏视图回填一次（key 只显尾号，不回显明文）。
  const [ttsBaseUrl, setTtsBaseUrl] = useState('')
  const [ttsModelId, setTtsModelId] = useState('')
  const [ttsVoice, setTtsVoice] = useState('')
  const [ttsKey, setTtsKey] = useState('')
  const [ttsKeyTail, setTtsKeyTail] = useState('')
  const [showTtsKey, setShowTtsKey] = useState(false)
  const [ttsSaving, setTtsSaving] = useState(false)
  const ttsPrefilled = useRef(false)
  useEffect(() => {
    if (!ttsConfig || ttsPrefilled.current) return
    ttsPrefilled.current = true
    setTtsBaseUrl(ttsConfig.baseUrl)
    setTtsModelId(ttsConfig.modelId)
    setTtsVoice(ttsConfig.voice)
    setTtsKeyTail(ttsConfig.apiKeyTail)
  }, [ttsConfig])
  const [reset, setReset] = useState(false)
  const [imported, setImported] = useState<StudioState | null>(null)
  const [importError, setImportError] = useState('')
  const preferences = state.preferences
  function patch(value: Partial<typeof preferences>) {
    setState((s) => ({
      ...s,
      preferences: {
        ...s.preferences,
        ...value,
      },
    }))
  }
  function backup() {
    download(
      `Content-Studio-备份-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          ...state,
          backupNote: '本机演示工作区备份，不包含密钥。',
        },
        null,
        2,
      ),
      'application/json',
    )
    notify('已导出包含内容、素材、版本和记录的本机备份。')
  }
  async function importBackup(file?: File) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setImportError('备份文件不能超过 8 MB。')
      return
    }
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!validBackup(parsed)) throw new Error('不是有效的 Content Studio v2 备份文件。')
      setImported(parsed)
      setImportError('')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '读取失败，请选择有效 JSON。')
    }
  }
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0" asChild>
      <section className="workspace-page">
        <PageTitle
          back={() => navigate(project.activeTab)}
          title="找到你的创作节奏。"
          description="服务、偏好与积累，都在这里慢慢安顿。"
        />
        <TabsList className="settings-tabs" variant="line" aria-label="设置分类">
          {['AI 服务', '创作偏好', '数据与导出'].map((item) => (
            <TabsTrigger key={item} value={item}>
              {item}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="settings-content">
          {tab === 'AI 服务' && (
            <>
              {!aiReady && (
                <div className="inline-alert orange">
                  <Sparkles size={16} />
                  未配置模型：对话、建议与生成仍为本地演示。填写下方的服务地址与密钥后即可启用真实模型。
                </div>
              )}
              {aiReady && (
                <div className="inline-alert green">
                  <Sparkles size={16} />
                  已启用真实模型：对话、修改建议、母稿与平台稿生成由所配置服务驱动（pi agent）；未采用前不会改动正文。
                </div>
              )}
              <Card className="service-card gap-3 p-3" role="article">
                <div className="service-heading mb-0">
                  <span className="service-icon">
                    <Sparkles size={22} />
                  </span>
                  <div>
                    <h3>模型服务</h3>
                    <p>OpenAI 兼容接口；对话、建议、母稿与平台稿生成共用此配置</p>
                  </div>
                  <Badge tone={aiReady ? 'green' : 'neutral'}>{aiReady ? '已配置' : '未配置'}</Badge>
                </div>
                <div className="form-grid">
                  <Field label="服务地址">
                    <Input
                      placeholder="https://api.example.com/v1"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                    />
                  </Field>
                  <Field label="模型 ID">
                    <Input
                      placeholder="your-model"
                      value={aiModelId}
                      onChange={(e) => setAiModelId(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="API Key（加密保存在本机，不会在界面回显）">
                  <div className="secret-field">
                    <Input
                      autoComplete="off"
                      type={showKey ? 'text' : 'password'}
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      placeholder={aiKeyTail ? `已保存，尾号 ${aiKeyTail}；留空则沿用` : 'sk-…'}
                    />
                    <Button
                      aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      onClick={() => setShowKey(!showKey)}
                      variant="ghost"
                      size="icon"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                </Field>
                <div className="service-controls">
                  <Button
                    disabled={aiSaving || !aiBaseUrl.trim() || !aiModelId.trim() || (!aiKey.trim() && !aiKeyTail)}
                    onClick={async () => {
                      setAiSaving(true)
                      const result = await saveAiConfig({
                        baseUrl: aiBaseUrl,
                        modelId: aiModelId,
                        apiKey: aiKey.trim() ? aiKey : '__KEEP__',
                      })
                      setAiSaving(false)
                      setAiKey('')
                      notify(result.message)
                    }}
                    size="default"
                  >
                    {aiSaving ? '保存中…' : '保存配置'}
                  </Button>
                  <Button
                    disabled={aiTesting || !aiBaseUrl.trim()}
                    onClick={async () => {
                      setAiTesting(true)
                      setAiTestMessage('')
                      const result = await testAiConnection(
                        aiBaseUrl,
                        aiKey.trim() || '__KEEP__',
                        aiModelId,
                      )
                      setAiTesting(false)
                      setAiTestMessage(result ? `${result.message}${result.latencyMs ? `（${result.latencyMs} 毫秒）` : ''}` : '浏览器预览不支持连接测试。')
                    }}
                    variant="outline"
                    size="default"
                  >
                    {aiTesting ? '测试中…' : '测试连接'}
                  </Button>
                  {aiReady && (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={async () => {
                        await clearAiConfig()
                        setAiKeyTail('')
                        setAiTestMessage('')
                        notify('已清除模型配置，回到本地演示模式。')
                      }}
                    >
                      清除配置
                    </Button>
                  )}
                </div>
                {aiTestMessage && <p className="service-note">{aiTestMessage}</p>}
              </Card>
              <Card className="service-card gap-3 p-3" role="article">
                <div className="service-heading mb-0">
                  <span className="service-icon">
                    <Mic size={22} />
                  </span>
                  <div>
                    <h3>语音服务</h3>
                    <p>OpenAI 兼容语音接口（audio/speech）；视频分镜配音用，可与模型服务同 provider</p>
                  </div>
                  <Badge tone={ttsReady ? 'green' : 'neutral'}>{ttsReady ? '已配置' : '未配置'}</Badge>
                </div>
                <div className="form-grid">
                  <Field label="服务地址">
                    <Input
                      placeholder="https://api.example.com/v1"
                      value={ttsBaseUrl}
                      onChange={(e) => setTtsBaseUrl(e.target.value)}
                    />
                  </Field>
                  <Field label="模型 ID">
                    <Input
                      placeholder="tts-model"
                      value={ttsModelId}
                      onChange={(e) => setTtsModelId(e.target.value)}
                    />
                  </Field>
                </div>
                {aiBaseUrl && ttsBaseUrl !== aiBaseUrl && (
                  <Button
                    className=" text-muted-foreground"
                    onClick={() => {
                      setTtsBaseUrl(aiBaseUrl)
                      notify('已沿用模型服务的地址；语音服务可与模型服务同 provider。')
                    }}
                    variant="ghost"
                    size="sm"
                  >
                    沿用模型服务地址（同 provider）
                  </Button>
                )}
                <div className="form-grid">
                  <Field label="音色">
                    <Input
                      placeholder="alloy"
                      value={ttsVoice}
                      onChange={(e) => setTtsVoice(e.target.value)}
                    />
                  </Field>
                  <Field label="API Key（加密保存在本机，不会在界面回显）">
                    <div className="secret-field">
                      <Input
                        autoComplete="off"
                        type={showTtsKey ? 'text' : 'password'}
                        value={ttsKey}
                        onChange={(e) => setTtsKey(e.target.value)}
                        placeholder={ttsKeyTail ? `已保存，尾号 ${ttsKeyTail}；留空则沿用` : 'sk-…'}
                      />
                      <Button
                        aria-label={showTtsKey ? '隐藏密钥' : '显示密钥'}
                        onClick={() => setShowTtsKey(!showTtsKey)}
                        variant="ghost"
                        size="icon"
                      >
                        {showTtsKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </Button>
                    </div>
                  </Field>
                </div>
                <div className="service-controls">
                  <Button
                    disabled={
                      ttsSaving ||
                      !ttsBaseUrl.trim() ||
                      !ttsModelId.trim() ||
                      !ttsVoice.trim() ||
                      (!ttsKey.trim() && !ttsKeyTail)
                    }
                    onClick={async () => {
                      setTtsSaving(true)
                      const result = await saveTtsConfig({
                        baseUrl: ttsBaseUrl,
                        modelId: ttsModelId,
                        voice: ttsVoice,
                        apiKey: ttsKey.trim() ? ttsKey : '__KEEP__',
                      })
                      setTtsSaving(false)
                      setTtsKey('')
                      notify(result.message)
                    }}
                    size="default"
                  >
                    {ttsSaving ? '保存中…' : '保存配置'}
                  </Button>
                  {ttsReady && (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={async () => {
                        await clearTtsConfig()
                        setTtsKeyTail('')
                        setTtsKey('')
                        setTtsBaseUrl('')
                        setTtsModelId('')
                        setTtsVoice('')
                        ttsPrefilled.current = false
                      }}
                    >
                      清除配置
                    </Button>
                  )}
                </div>
                <p className="service-note">
                  {ttsReady
                    ? '已启用语音服务：分镜「更新所选镜头配音」生成真实音频并按音频时长回填镜头。'
                    : '未配置语音服务：视频配音保持本地演示，不影响其他功能。'}
                </p>
              </Card>
              <div className="settings-section">
                <h2>其他服务</h2>
                <p>图片与视觉服务尚未接入；相关界面仍为本地演示，接入后将在此处配置。</p>
              </div>
            </>
          )}
          {tab === '创作偏好' && (
            <>
              <div className="settings-section">
                <h2>你常去的地方</h2>
                <p>常用平台用于创作建议，每次发布仍由你重新选择。</p>
                <div className="preference-platforms">
                  {PLATFORMS.map((item) => (
                    <div
                      key={item.id}
                      className={
                        preferences.platforms.includes(item.id)
                          ? 'border-[var(--brand-accent)]/40 bg-[var(--selected-platform)]'
                          : undefined
                      }
                    >
                      <PlatformMark platform={item.id} />
                      <CheckOption
                        checked={preferences.platforms.includes(item.id)}
                        onChange={(checked) =>
                          patch({
                            platforms: checked
                              ? [...preferences.platforms, item.id]
                              : preferences.platforms.filter((p) => p !== item.id),
                          })
                        }
                      >
                        {item.name}
                      </CheckOption>
                      {/* E6：抖音尚未接入工作台/任务体系，勾了也无法兑现，就地标注避免空许诺。 */}
                      {item.id === 'douyin' && (
                        <Badge className="ml-auto shrink-0" tone="neutral">
                          即将支持
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <h2>你喜欢的表达</h2>
                <div className="form-grid">
                  <Field label="默认语言">
                    <NativeSelect
                      value={preferences.language}
                      onChange={(e) =>
                        patch({
                          language: e.target.value,
                        })
                      }
                    >
                      <option>简体中文</option>
                      <option>繁體中文</option>
                      <option>English</option>
                    </NativeSelect>
                  </Field>
                  <Field label="视频默认比例">
                    <NativeSelect
                      value={preferences.ratio}
                      onChange={(e) =>
                        patch({
                          ratio: e.target.value as '9:16',
                        })
                      }
                    >
                      <option>9:16</option>
                      <option>16:9</option>
                      <option>1:1</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Field label="表达偏好">
                  <Textarea
                    rows={3}
                    className="max-md:resize-none"
                    value={preferences.tone}
                    onChange={(e) =>
                      patch({
                        tone: e.target.value,
                      })
                    }
                  />
                </Field>
                <p className="small-meta">偏好自动保存，仅为新创作提供默认建议，不改写已有内容。</p>
              </div>
              {/* E5：发送键行为与「表达」无关，拆出独立分组并写明作用域；
                  G7：触屏没有 Shift/Ctrl/Cmd，该桌面键盘偏好整组仅在 ≥768px 档出现
                  （与 use-mobile 的移动断点一致）。 */}
              <div className="settings-section hidden md:block">
                <h2>Agent 输入</h2>
                <p>仅作用于创作 Agent 对话框的发送方式。</p>
                <CheckOption
                  checked={preferences.enterToSend}
                  onChange={(value) =>
                    patch({
                      enterToSend: value,
                    })
                  }
                >
                  Enter 发送，Shift+Enter 换行（取消后使用 Ctrl/Cmd+Enter 发送）
                </CheckOption>
              </div>
            </>
          )}
          {tab === '数据与导出' && (
            <>
              <div className="storage-card">
                <HardDrive size={30} />
                <div>
                  <h3>你的积累，保存在这台设备</h3>
                  <p>浏览器 / Electron 本机存储 · 未连接云端同步</p>
                </div>
                <Badge tone="green">本地工作区</Badge>
              </div>
              <div className="data-statistics">
                <div>
                  <strong>{state.projects.filter((p) => !p.trashed).length}</strong>
                  <span>内容项目</span>
                </div>
                <div>
                  <strong>{state.materials.filter((m) => !m.trashed).length}</strong>
                  <span>素材</span>
                </div>
                <div>
                  <strong>
                    {state.projects.reduce(
                      (sum, p) => sum + Object.values(p.drafts).reduce((n, d) => n + d.versions.length, 0),
                      0,
                    )}
                  </strong>
                  <span>文稿版本</span>
                </div>
              </div>
              <div className="settings-section">
                <h2>带走一份安心</h2>
                <p>备份包含内容、平台版本、素材、视频配置、对话和发布记录，不包含密钥。</p>
                <div className="button-row">
                  <Button onClick={backup} variant="default" size="default">
                    <ArrowDownToLine size={15} />
                    导出全部备份
                  </Button>
                  <Button
                    onClick={() => {
                      download(
                        `${project.title || '未命名内容'}-项目-${new Date().toISOString().slice(0, 10)}.json`,
                        JSON.stringify(
                          {
                            mock: true,
                            project,
                            materials: state.materials.filter((m) => project.materialIds.includes(m.id)),
                          },
                          null,
                          2,
                        ),
                        'application/json',
                      )
                      notify('当前项目与引用素材已导出。项目文件与全部备份的格式分别使用。')
                    }}
                    variant="outline"
                    size="default"
                  >
                    导出当前项目
                  </Button>
                  {/* E1：与同排 outline 按钮同形态——label 原先无 flex 布局，
                      preflight 的 svg display:block 让图标纵堆在文字上方且无边框底色。 */}
                  <label className="file-button inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground">
                    <FileUp size={15} />
                    导入全部备份
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        void importBackup(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                {importError && (
                  <p className="form-error" role="alert">
                    {importError}
                  </p>
                )}
              </div>
              <div className="settings-section recycle-section">
                <div className="section-heading">
                  <h2>回收站</h2>
                  <Badge>
                    {state.materials.filter((m) => m.trashed).length +
                      state.projects.filter((p) => p.trashed).length}{' '}
                    项
                  </Badge>
                </div>
                {state.projects
                  .filter((p) => p.trashed)
                  .map((p) => (
                    <div className="recycle-row" key={p.id}>
                      <FileUp size={16} />
                      <span>
                        {p.title || '未命名内容'}
                        <small>内容项目</small>
                      </span>
                      <Button
                        className=" text-muted-foreground"
                        onClick={() => {
                          setState((s) => ({
                            ...s,
                            projects: s.projects.map((item) =>
                              item.id === p.id
                                ? {
                                    ...item,
                                    trashed: false,
                                  }
                                : item,
                            ),
                          }))
                          notify('内容项目与其平台稿、对话、版本均已恢复。')
                        }}
                        variant="ghost"
                        size="sm"
                      >
                        <RotateCcw size={14} />
                        恢复
                      </Button>
                    </div>
                  ))}
                {state.materials
                  .filter((m) => m.trashed)
                  .map((m) => (
                    <div className="recycle-row" key={m.id}>
                      <Database size={16} />
                      <span>
                        {m.title}
                        <small>原素材 · 保留项目关联</small>
                      </span>
                      <Button
                        className=" text-muted-foreground"
                        onClick={() => {
                          setState((s) => ({
                            ...s,
                            materials: s.materials.map((item) =>
                              item.id === m.id
                                ? {
                                    ...item,
                                    trashed: false,
                                  }
                                : item,
                            ),
                          }))
                          notify('素材与原项目关联已恢复。')
                        }}
                        variant="ghost"
                        size="sm"
                      >
                        <RotateCcw size={14} />
                        恢复
                      </Button>
                    </div>
                  ))}
                {!state.materials.some((m) => m.trashed) && !state.projects.some((p) => p.trashed) && (
                  // E3 空态两级规范：页面级（图标+标题+说明+CTA）之外，区块级保持单行文案，
                  // 此处仅补一枚 14px 内联图标作视觉锚点，不再升级为完整空态结构。
                  <p className="text-muted-foreground flex items-center gap-2" role="status">
                    <Trash2 size={14} aria-hidden="true" />
                    回收站是空的，所有积累都好好待着。
                  </p>
                )}
              </div>
              <div className="settings-section">
                <h2>演示工作区</h2>
                <p>重新载入最初的示例会替换当前本机数据。建议先导出备份。</p>
                <Button onClick={() => setReset(true)} variant="outline" size="default">
                  <RefreshCw size={15} />
                  重新载入示例
                </Button>
              </div>
            </>
          )}
          <div className="settings-footnote">
            <span>Content Studio 0.1.0</span>
            <span>为每一个认真表达的人</span>
          </div>
          {reset && (
            <Modal
              title="重新载入示例内容？"
              description="当前内容、对话、素材及发布记录将被演示数据替换。"
              onClose={() => setReset(false)}
              footer={
                <>
                  <Button
                    onClick={() => {
                      backup()
                      setReset(false)
                    }}
                    variant="outline"
                    size="default"
                  >
                    导出备份并取消
                  </Button>
                  <Button onClick={() => setReset(false)} variant="outline" size="default">
                    取消
                  </Button>
                  <Button
                    onClick={() => {
                      setState(seedState())
                      clearAgentDrafts()
                      setReset(false)
                      notify('已重新载入本地示例内容。')
                    }}
                    variant="destructive"
                    size="default"
                  >
                    确认替换为示例
                  </Button>
                </>
              }
            >
              未导出的本机编辑无法自动找回。你也可以取消，继续使用当前工作区。
            </Modal>
          )}
          {imported && (
            <Modal
              title="用备份恢复工作区？"
              description={`即将载入 ${imported.projects.length} 个内容项目和 ${imported.materials.length} 份素材。当前本机工作区会被替换。`}
              onClose={() => setImported(null)}
              footer={
                <>
                  <Button onClick={backup} variant="outline" size="default">
                    备份当前工作区
                  </Button>
                  <Button
                    onClick={() => {
                      clearAgentDrafts()
                      setState((current) => ({
                        ...imported,
                        schema: 3,
                        // 热点域（来源/话题聚合）权威在主进程；备份缺失时保留当前值
                        sources: imported.sources ?? current.sources,
                        topics: imported.topics ?? current.topics,
                        topicAngleSuggestions: imported.topicAngleSuggestions ?? {},
                        projects: imported.projects.map((p) => ({
                          ...p,
                          creation: recoverCreation(p.creation),
                        })),
                        // 任务历史不随备份恢复；creation 任务随文档保留并停止在途状态。
                        tasks: imported.tasks
                          .filter((t) => t.kind === 'creation')
                          .map((t) =>
                            ['running', 'queued'].includes(t.state)
                              ? {
                                  ...t,
                                  state: 'stopped',
                                }
                              : t,
                          ),
                      }))
                      setImported(null)
                      notify('备份已恢复；未完成的演示任务已停止。')
                    }}
                    variant="default"
                    size="default"
                  >
                    确认恢复备份
                  </Button>
                </>
              }
            >
              备份中的平台稿、版本和发布快照将一起恢复；不会执行其中的发布操作。
            </Modal>
          )}
        </TabsContent>
      </section>
    </Tabs>
  )
}
function validBackup(value: unknown): value is StudioState {
  if (!value || typeof value !== 'object') return false
  const s = value as StudioState
  return (
    ((s.schema as number) === 2 || s.schema === 3) &&
    Array.isArray(s.projects) &&
    s.projects.length > 0 &&
    s.projects.some((p) => !p.trashed) &&
    s.projects.every(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.title === 'string' &&
        p.brief &&
        Array.isArray(p.brief.outline) &&
        p.drafts &&
        Object.values(p.drafts).every(
          (d) =>
            d &&
            typeof d.body === 'string' &&
            typeof d.title === 'string' &&
            d.typography &&
            Array.isArray(d.versions),
        ) &&
        p.drafts.master &&
        Array.isArray(p.videos) &&
        p.videos.every((v) => Array.isArray(v.shots) && Array.isArray(v.versions)) &&
        Array.isArray(p.conversations) &&
        p.conversations.every((c) => Array.isArray(c.messages)) &&
        Array.isArray(p.materialIds) &&
        Array.isArray(p.batches),
    ) &&
    Array.isArray(s.materials) &&
    s.materials.every(
      (m) =>
        typeof m.title === 'string' &&
        typeof m.body === 'string' &&
        Array.isArray(m.tags) &&
        ['text', 'image', 'link', 'file'].includes(m.type),
    ) &&
    Array.isArray(s.discoveryConversations) &&
    s.discoveryConversations.length > 0 &&
    s.discoveryConversations.every((c) => Array.isArray(c.messages)) &&
    typeof s.activeDiscovery === 'string' &&
    // 热点域聚合（sources/topics）权威在主进程，桌面文档与备份可不带
    (s.sources === undefined || Array.isArray(s.sources)) &&
    Array.isArray(s.tasks) &&
    Array.isArray(s.bookmarks) &&
    !!s.preferences?.services &&
    !!s.preferences?.connection &&
    Array.isArray(s.preferences.platforms) &&
    !!s.hotspotFilters &&
    !!s.topicDrafts &&
    !!s.layout &&
    typeof s.selectedProject === 'string'
  )
}
