import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Edit2, Save, X, Plus, Trash2, Star, StarOff, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

interface Prompt {
  id: string
  name: string
  content: string
  createdAt: string
  updatedAt: string
  isDefault: boolean
}

const API_BASE_URL = '/api'

export default function Prompts() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ name: string; content: string }>({ name: '', content: '' })
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [newPrompt, setNewPrompt] = useState<{ name: string; content: string }>({ name: '', content: '' })
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    fetchPrompts()
  }, [])

  const fetchPrompts = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`${API_BASE_URL}/prompts`)
      const data = await response.json()
      setPrompts(data.prompts || [])
    } catch (error) {
      console.error('Failed to load prompts:', error)
      setPrompts([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleStartEdit = (prompt: Prompt) => {
    setEditingId(prompt.id)
    setEditForm({
      name: prompt.name,
      content: prompt.content
    })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return

    const name = editForm.name.trim()
    const content = editForm.content.trim()

    if (!name || !content) {
      alert('Name and content are required')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/prompts/${editingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          content,
          isDefault: prompts.find(p => p.id === editingId)?.isDefault || false
        }),
      })

      if (response.ok) {
        await fetchPrompts()
        setEditingId(null)
        setEditForm({ name: '', content: '' })
      } else {
        throw new Error('Failed to update prompt')
      }
    } catch (error) {
      console.error('Failed to update prompt:', error)
      alert('Failed to update prompt. Please try again.')
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditForm({ name: '', content: '' })
  }

  const handleCreateNew = () => {
    setIsCreatingNew(true)
    setNewPrompt({ name: '', content: '' })
  }

  const handleSaveNew = async () => {
    const name = newPrompt.name.trim()
    const content = newPrompt.content.trim()

    if (!name || !content) {
      alert('Name and content are required')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          content,
          isDefault: false
        }),
      })

      if (response.ok) {
        await fetchPrompts()
        setIsCreatingNew(false)
        setNewPrompt({ name: '', content: '' })
      } else {
        throw new Error('Failed to create prompt')
      }
    } catch (error) {
      console.error('Failed to create prompt:', error)
      alert('Failed to create prompt. Please try again.')
    }
  }

  const handleCancelNew = () => {
    setIsCreatingNew(false)
    setNewPrompt({ name: '', content: '' })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this prompt?')) {
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/prompts/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await fetchPrompts()
      } else {
        throw new Error('Failed to delete prompt')
      }
    } catch (error) {
      console.error('Failed to delete prompt:', error)
      alert('Failed to delete prompt. Please try again.')
    }
  }

  const handleToggleDefault = async (id: string) => {
    const prompt = prompts.find(p => p.id === id)
    if (!prompt) return

    try {
      const response = await fetch(`${API_BASE_URL}/prompts/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: prompt.name,
          content: prompt.content,
          isDefault: !prompt.isDefault
        }),
      })

      if (response.ok) {
        await fetchPrompts()
      } else {
        throw new Error('Failed to update prompt')
      }
    } catch (error) {
      console.error('Failed to update prompt:', error)
      alert('Failed to update prompt. Please try again.')
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      alert('Failed to copy to clipboard')
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedPrompts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
          Prompts
        </h2>
        <Button onClick={handleCreateNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Prompt
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Loading prompts...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Create New Prompt Form */}
          {isCreatingNew && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20">
              <CardHeader>
                <CardTitle>Create New Prompt</CardTitle>
                <CardDescription>Enter the name and content for your new prompt</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={newPrompt.name}
                    onChange={(e) => setNewPrompt({ ...newPrompt, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter prompt name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Content
                  </label>
                  <textarea
                    value={newPrompt.content}
                    onChange={(e) => setNewPrompt({ ...newPrompt, content: e.target.value })}
                    rows={15}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="Enter prompt content (Markdown supported)"
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveNew} size="sm">
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                  <Button onClick={handleCancelNew} variant="outline" size="sm">
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Prompts List */}
          {prompts.length === 0 && !isCreatingNew ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500 dark:text-gray-400">
                No prompts found. Create your first prompt to get started.
              </CardContent>
            </Card>
          ) : (
            prompts.map((prompt) => (
              <Card key={prompt.id} className={prompt.isDefault ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-900/20' : ''}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {prompt.isDefault && (
                        <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                      )}
                      <CardTitle>{prompt.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => handleCopy(prompt.content, prompt.id)}
                        variant="ghost"
                        size="sm"
                        title="Copy prompt content"
                      >
                        {copiedId === prompt.id ? (
                          <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        onClick={() => handleToggleDefault(prompt.id)}
                        variant="ghost"
                        size="sm"
                        title={prompt.isDefault ? 'Remove default' : 'Set as default'}
                      >
                        {prompt.isDefault ? (
                          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                        ) : (
                          <StarOff className="h-4 w-4 text-gray-400" />
                        )}
                      </Button>
                      {editingId !== prompt.id && (
                        <Button
                          onClick={() => handleStartEdit(prompt)}
                          variant="ghost"
                          size="sm"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <CardDescription>
                    Created: {formatDate(prompt.createdAt)} | Updated: {formatDate(prompt.updatedAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {editingId === prompt.id ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Name
                        </label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Content
                        </label>
                        <textarea
                          value={editForm.content}
                          onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                          rows={15}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-stone-600 rounded-lg bg-white dark:bg-stone-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button onClick={handleSaveEdit} size="sm">
                            <Save className="h-4 w-4 mr-1" />
                            Save
                          </Button>
                          <Button onClick={handleCancelEdit} variant="outline" size="sm">
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                        </div>
                        <Button
                          onClick={() => handleDelete(prompt.id)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 w-fit"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className={`relative bg-gray-50 dark:bg-stone-900 p-6 rounded-lg border border-gray-200 dark:border-stone-700 overflow-hidden transition-all duration-300 ${
                        expandedPrompts.has(prompt.id) ? '' : 'max-h-96'
                      }`}>
                        <div className={`prose dark:prose-invert max-w-none 
                          prose-headings:text-gray-900 dark:prose-headings:text-gray-100 
                          prose-p:text-gray-700 dark:prose-p:text-gray-300 
                          prose-strong:text-gray-900 dark:prose-strong:text-gray-100
                          prose-code:text-blue-600 dark:prose-code:text-blue-400 
                          prose-code:bg-gray-100 dark:prose-code:bg-stone-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                          prose-pre:bg-gray-100 dark:prose-pre:bg-stone-800 prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-stone-700
                          prose-ul:text-gray-700 dark:prose-ul:text-gray-300
                          prose-ol:text-gray-700 dark:prose-ol:text-gray-300
                          prose-li:text-gray-700 dark:prose-li:text-gray-300
                          prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400
                          prose-blockquote:border-gray-300 dark:prose-blockquote:border-stone-600
                          prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg`}>
                          <ReactMarkdown
                            components={{
                              code: ({ className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || '')
                                return match ? (
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                ) : (
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                )
                              }
                            }}
                          >
                            {prompt.content}
                          </ReactMarkdown>
                        </div>
                        {!expandedPrompts.has(prompt.id) && (
                          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-gray-50 via-gray-50/80 to-transparent dark:from-stone-900 dark:via-stone-900/80 pointer-events-none rounded-b-lg"></div>
                        )}
                      </div>
                      <Button
                        onClick={() => toggleExpand(prompt.id)}
                        variant="ghost"
                        size="sm"
                        className="w-full"
                      >
                        {expandedPrompts.has(prompt.id) ? (
                          <>
                            <ChevronUp className="h-4 w-4 mr-1" />
                            Collapse
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 mr-1" />
                            Expand
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  )
}

