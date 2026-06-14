import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Save, RotateCcw } from 'lucide-react'

const API_BASE_URL = '/api'

const PROMPT_TYPES = [
  { value: 'lead-finder', label: 'Lead Finder 提示词' },
  { value: 'similar-company', label: 'Similar Company 提示词' },
  { value: 'osint', label: 'OSINT 背调提示词' }
]

export default function Prompts() {
  const [promptType, setPromptType] = useState('lead-finder')
  const [promptContent, setPromptContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadPrompt(promptType)
  }, [promptType])

  const loadPrompt = async (type: string) => {
    try {
      setIsLoading(true)
      const response = await fetch(`${API_BASE_URL}/prompts/${type}`)
      const data = await response.json()
      setPromptContent(data.prompt || '')
    } catch (error) {
      console.error('Failed to load prompt:', error)
      setPromptContent('')
    } finally {
      setIsLoading(false)
    }
  }

  const savePrompt = async () => {
    try {
      setIsSaving(true)
      const response = await fetch(`${API_BASE_URL}/prompts/${promptType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: promptContent })
      })

      if (response.ok) {
        alert('提示词保存成功')
      } else {
        throw new Error('Failed to save prompt')
      }
    } catch (error) {
      console.error('Failed to save prompt:', error)
      alert('保存失败，请重试')
    } finally {
      setIsSaving(false)
    }
  }

  const restoreDefault = async () => {
    if (!confirm('确定要恢复默认提示词吗？当前的自定义内容将被删除。')) {
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/prompts/${promptType}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await loadPrompt(promptType)
        alert('已恢复默认提示词')
      } else {
        throw new Error('Failed to restore default')
      }
    } catch (error) {
      console.error('Failed to restore default:', error)
      alert('恢复失败，请重试')
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          提示词管理
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          管理 Lead Finder、Similar Company、OSINT 背调的 AI 提示词
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>编辑提示词</CardTitle>
          <CardDescription>选择提示词类型，编辑内容后保存到 Gist</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              提示词类型
            </label>
            <select
              value={promptType}
              onChange={(e) => setPromptType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PROMPT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              提示词内容
            </label>
            {isLoading ? (
              <div className="w-full h-96 flex items-center justify-center border border-gray-300 dark:border-stone-600 rounded-lg bg-gray-50 dark:bg-stone-900">
                <p className="text-gray-500 dark:text-gray-400">加载中...</p>
              </div>
            ) : (
              <textarea
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
                rows={20}
                className="w-full px-3 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="输入提示词内容..."
              />
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={savePrompt} disabled={isSaving || isLoading}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? '保存中...' : '保存修改'}
            </Button>
            <Button onClick={restoreDefault} variant="outline" disabled={isLoading}>
              <RotateCcw className="h-4 w-4 mr-2" />
              恢复默认
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
