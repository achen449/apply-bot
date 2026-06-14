import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface SimilarCompany {
  name: string;
  website?: string;
  industry?: string;
  description?: string;
  similarityScore: number;
  reasoning?: string;
}

interface ApiResponse {
  reasoning: string;
  companies: SimilarCompany[];
}

export default function SimilarCompany() {
  const [companyName, setCompanyName] = useState('');
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [companies, setCompanies] = useState<SimilarCompany[]>([]);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setReasoning('');
    setCompanies([]);

    try {
      const response = await fetch('/api/similar-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyName,
          website,
          industry,
          description,
        }),
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      const data: ApiResponse = await response.json();
      setReasoning(data.reasoning);
      setCompanies(data.companies);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发生未知错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">相似公司查询</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>输入公司信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="companyName">公司名称 *</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCompanyName(e.target.value)}
                placeholder="例如：Tesla"
                required
              />
            </div>

            <div>
              <Label htmlFor="website">网站</Label>
              <Input
                id="website"
                value={website}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWebsite(e.target.value)}
                placeholder="例如：https://tesla.com"
              />
            </div>

            <div>
              <Label htmlFor="industry">行业</Label>
              <Input
                id="industry"
                value={industry}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIndustry(e.target.value)}
                placeholder="例如：电动汽车"
              />
            </div>

            <div>
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="例如：专注于电动汽车和可持续能源解决方案的公司"
                rows={4}
              />
            </div>

            <Button type="submit" disabled={loading || !companyName}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  分析中...
                </>
              ) : (
                '查找相似公司'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-6 border-red-500">
          <CardContent className="pt-6">
            <p className="text-red-500">{error}</p>
          </CardContent>
        </Card>
      )}

      {reasoning && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>AI 推理过程</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-gray-700">{reasoning}</p>
          </CardContent>
        </Card>
      )}

      {companies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>相似公司列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {companies.map((company, index) => (
                <div
                  key={index}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-semibold">{company.name}</h3>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">
                        {Math.round(company.similarityScore * 100)}%
                      </div>
                      <div className="text-sm text-gray-500">相似度</div>
                    </div>
                  </div>

                  {company.website && (
                    <div className="text-sm mb-2">
                      <span className="font-medium">网站：</span>
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {company.website}
                      </a>
                    </div>
                  )}

                  {company.industry && (
                    <div className="text-sm mb-2">
                      <span className="font-medium">行业：</span>
                      <span className="text-gray-700">{company.industry}</span>
                    </div>
                  )}

                  {company.description && (
                    <div className="text-sm mb-2">
                      <span className="font-medium">描述：</span>
                      <p className="text-gray-700 mt-1">{company.description}</p>
                    </div>
                  )}

                  {company.reasoning && (
                    <div className="text-sm mt-3 pt-3 border-t">
                      <span className="font-medium">相似原因：</span>
                      <p className="text-gray-600 mt-1">{company.reasoning}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
