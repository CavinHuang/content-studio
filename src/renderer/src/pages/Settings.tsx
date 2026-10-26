import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
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
  const { state, setState, project, navigate, notify, retrySave, clearAgentDrafts } = useStudio()
  const [tab, setTab] = useState('AI 服务')
  const [testing, setTesting] = useState<string | null>(null)
  const [key, setKey] = useState(''),
    [showKey, setShowKey] = useState(false)
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
      <section className="workspace-page settings-page">
        <PageTitle
          back={() => navigate(project.activeTab)}
          eyebrow="A WORKSPACE THAT FEELS LIKE YOU"
          title="找到你的创作节奏。"
          description="服务、偏好与积累，都在这里慢慢安顿。"
        />
        <TabsList className="settings-tabs" variant="line" aria-label="设置分类">
          {['AI 服务', '创作偏好', '数据与导出'].map((item) => (
            <TabsTrigger className={tab === item ? 'active' : ''} key={item} value={item}>
              {item}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="settings-content">
          {tab === 'AI 服务' && (
            <>
              <div className="inline-alert orange">
                <Sparkles size={16} />
                演示模式：连接测试仅更新状态显示，不请求模型服务。密钥只留在本次输入框，不会保存。
              </div>
              <div className="service-cards">
                {(
                  [
                    {
                      id: 'text',
                      title: '文字与思考',
                      description: '选题、写作、修改建议与平台适配',
                      icon: Sparkles,
                    },
                    {
                      id: 'image',
                      title: '图片与视觉',
                      description: '文章配图、封面与分镜素材',
                      icon: Image,
                    },
                    {
                      id: 'voice',
                      title: '配音与声音',
                      description: '口播、语音预览与字幕对齐',
                      icon: Mic,
                    },
                  ] as const
                ).map((service) => (
                  <Card className="service-card gap-3 p-3" key={service.id} role="article">
                    <div className="service-heading mb-0">
                      <span className="service-icon">
                        <service.icon size={22} />
                      </span>
                      <div>
                        <h3>{service.title}</h3>
                        <p>{service.description}</p>
                      </div>
                      <Badge tone={preferences.connection[service.id] ? 'green' : 'neutral'}>
                        {preferences.connection[service.id] ? '演示就绪' : '未启用'}
                      </Badge>
                    </div>
                    <div className="service-controls">
                      <Field label="默认服务">
                        <NativeSelect
                          value={preferences.services[service.id]}
                          onChange={(e) =>
                            patch({
                              services: {
                                ...preferences.services,
                                [service.id]: e.target.value,
                              },
                            })
                          }
                        >
                          <option>
                            {service.id === 'text'
                              ? '创作助手（Mock）'
                              : service.id === 'image'
                                ? '视觉助手（Mock）'
                                : '自然叙述（Mock）'}
                          </option>
                          <option>自定义服务（演示）</option>
                        </NativeSelect>
                      </Field>
                      <Button
                        className="button secondary"
                        disabled={!!testing}
                        onClick={() => {
                          setTesting(service.id)
                          setTimeout(() => {
                            patch({
                              connection: {
                                ...preferences.connection,
                                [service.id]: true,
                              },
                            })
                            setTesting(null)
                            notify('连接演示完成，未发送网络请求。')
                          }, 750)
                        }}
                        variant="outline"
                        size="default"
                      >
                        {testing === service.id ? '演示测试中…' : '测试连接'}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
              <details className="advanced-settings">
                <summary>自定义连接示意</summary>
                <div className="form-grid">
                  <Field label="服务地址（不保存）">
                    <Input placeholder="https://api.example.com/v1" />
                  </Field>
                  <Field label="模型名称（不保存）">
                    <Input placeholder="your-model" />
                  </Field>
                </div>
                <Field label="密钥（仅当前输入，不会保存或发送）">
                  <div className="secret-field">
                    <Input
                      autoComplete="off"
                      type={showKey ? 'text' : 'password'}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="输入用于查看遮挡效果的示例值"
                    />
                    <Button
                      className="icon-button"
                      aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      onClick={() => setShowKey(!showKey)}
                      variant="ghost"
                      size="icon"
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                </Field>
              </details>
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
                    value={preferences.tone}
                    onChange={(e) =>
                      patch({
                        tone: e.target.value,
                      })
                    }
                  />
                </Field>
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
                <p className="small-meta">偏好自动保存，仅为新创作提供默认建议，不改写已有内容。</p>
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
                  <Button className="button primary" onClick={backup} variant="default" size="default">
                    <ArrowDownToLine size={15} />
                    导出全部备份
                  </Button>
                  <Button
                    className="button secondary"
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
                  <label className="button secondary file-button">
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
                        className="text-button text-muted-foreground"
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
                        className="text-button text-muted-foreground"
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
                  <p className="muted">回收站是空的，所有积累都好好待着。</p>
                )}
              </div>
              <div className="settings-section">
                <h2>演示工作区</h2>
                <p>重新载入最初的示例会替换当前本机数据。建议先导出备份。</p>
                <Button
                  className="button secondary"
                  onClick={() => setReset(true)}
                  variant="outline"
                  size="default"
                >
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
                    className="button secondary"
                    onClick={() => {
                      backup()
                      setReset(false)
                    }}
                    variant="outline"
                    size="default"
                  >
                    导出备份并取消
                  </Button>
                  <Button
                    className="button secondary"
                    onClick={() => setReset(false)}
                    variant="outline"
                    size="default"
                  >
                    取消
                  </Button>
                  <Button
                    className="button danger"
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
                  <Button className="button secondary" onClick={backup} variant="outline" size="default">
                    备份当前工作区
                  </Button>
                  <Button
                    className="button primary"
                    onClick={() => {
                      try {
                        localStorage.setItem('content-studio.mock-workspace.v2', JSON.stringify(imported))
                        clearAgentDrafts()
                        setState({
                          ...imported,
                          projects: imported.projects.map((p) => ({
                            ...p,
                            creation: recoverCreation(p.creation),
                          })),
                          tasks: imported.tasks.map((t) =>
                            ['running', 'queued'].includes(t.state)
                              ? {
                                  ...t,
                                  state: 'stopped',
                                }
                              : t,
                          ),
                        })
                        setImported(null)
                        notify('备份已恢复；未完成的演示任务已停止。')
                      } catch {
                        setImportError('本机空间不足，无法载入此备份。')
                        setImported(null)
                      }
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
    s.schema === 2 &&
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
    Array.isArray(s.sources) &&
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
