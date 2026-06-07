import { FormEvent, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2, MapPin, XCircle } from 'lucide-react'
import { verifyCompanyWithGoogleMaps, batchVerifyCompaniesWithGoogleMaps, type BatchVerificationResult, type GoogleMapsVerificationResult } from '@/lib/leadApi'

export default function GoogleMapsVerify() {
  const [companyName, setCompanyName] = useState('')
  const [address, setAddress] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationResult, setVerificationResult] = useState<GoogleMapsVerificationResult | null>(null)
  const [error, setError] = useState('')

  const [batchInput, setBatchInput] = useState('')
  const [isBatchVerifying, setIsBatchVerifying] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchVerificationResult[]>([])
  const [batchError, setBatchError] = useState('')

  async function handleSingleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setVerificationResult(null)
    setIsVerifying(true)

    try {
      const result = await verifyCompanyWithGoogleMaps(companyName, address)
      setVerificationResult(result)
    } catch (verifyError) {
      console.error(verifyError)
      setError(verifyError instanceof Error ? verifyError.message : 'Verification failed')
    } finally {
      setIsVerifying(false)
    }
  }

  async function handleBatchVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBatchError('')
    setBatchResults([])
    setIsBatchVerifying(true)

    try {
      const lines = batchInput.trim().split('\n').filter(Boolean)
      const companies = lines.map((line) => {
        const parts = line.split(',').map((part) => part.trim())
        return {
          name: parts[0] || '',
          address: parts[1] || ''
        }
      }).filter((company) => company.name && company.address)

      if (companies.length === 0) {
        setBatchError('No valid companies found. Use format: Company Name, Address (one per line)')
        return
      }

      const { results } = await batchVerifyCompaniesWithGoogleMaps(companies)
      setBatchResults(results)
    } catch (verifyError) {
      console.error(verifyError)
      setBatchError(verifyError instanceof Error ? verifyError.message : 'Batch verification failed')
    } finally {
      setIsBatchVerifying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Google Maps Verification</h2>
        <p className="mt-2 max-w-4xl text-sm text-gray-600 dark:text-gray-400">
          Verify company information using Google Maps. Single verification for quick checks, or batch CSV paste for multiple companies.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5 text-primary-600" />
              Single Verification
            </CardTitle>
            <CardDescription>
              Verify one company at a time. Google Maps will return phone, website, rating, and business status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSingleVerify}>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Company Name
                <input 
                  value={companyName} 
                  onChange={(event) => setCompanyName(event.target.value)} 
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" 
                  placeholder="e.g., Siemens Energy" 
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Address
                <input 
                  value={address} 
                  onChange={(event) => setAddress(event.target.value)} 
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white" 
                  placeholder="e.g., Berlin, Germany" 
                  required
                />
              </label>
              <Button type="submit" disabled={isVerifying} className="w-full">
                {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Verify Company
              </Button>
              {error ? <div className="text-sm text-red-600 dark:text-red-400">{error}</div> : null}
            </form>

            {verificationResult ? (
              <div className="mt-6 space-y-3">
                {verificationResult.verified ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/30 dark:bg-emerald-900/10">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="h-4 w-4" />
                      Verified on Google Maps
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-emerald-700 dark:text-emerald-300">
                      <div><strong>Name:</strong> {verificationResult.match?.name}</div>
                      <div><strong>Address:</strong> {verificationResult.match?.address}</div>
                      <div><strong>Phone:</strong> {verificationResult.match?.phone || 'N/A'}</div>
                      <div><strong>Website:</strong> {verificationResult.match?.website ? <a href={verificationResult.match.website} target="_blank" rel="noreferrer" className="underline">{verificationResult.match.website}</a> : 'N/A'}</div>
                      <div><strong>Rating:</strong> {verificationResult.match?.rating || 'N/A'}</div>
                      <div><strong>Status:</strong> {verificationResult.match?.businessStatus}</div>
                      <div><strong>Types:</strong> {(verificationResult.match?.types || []).join(', ')}</div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/30 dark:bg-red-900/10">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
                      <XCircle className="h-4 w-4" />
                      Not Found
                    </div>
                    <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                      {verificationResult.message || 'No matching company found on Google Maps'}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-gray-200 dark:border-stone-700 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MapPin className="h-5 w-5 text-primary-600" />
              Batch CSV Verification
            </CardTitle>
            <CardDescription>
              Paste CSV data or Excel-exported text. Format: Company Name, Address (one per line)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleBatchVerify}>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Company List (CSV format)
                <textarea 
                  value={batchInput} 
                  onChange={(event) => setBatchInput(event.target.value)} 
                  rows={8}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-stone-700 dark:bg-stone-900 dark:text-white font-mono" 
                  placeholder={'Siemens Energy, Berlin Germany\nABB E-mobility, Zurich Switzerland\nTesla Energy, Austin USA'}
                  required
                />
              </label>
              <Button type="submit" disabled={isBatchVerifying} className="w-full">
                {isBatchVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Verify All Companies
              </Button>
              {batchError ? <div className="text-sm text-red-600 dark:text-red-400">{batchError}</div> : null}
            </form>

            {batchResults.length > 0 ? (
              <div className="mt-6 space-y-3 max-h-[600px] overflow-y-auto">
                {batchResults.map((result, index) => (
                  <div key={index} className={`rounded-2xl border p-4 ${result.verified ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-900/10' : 'border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-900/10'}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {result.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                      <span className={result.verified ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200'}>
                        {result.input.name}
                      </span>
                    </div>
                    {result.verified && result.match ? (
                      <div className="mt-2 space-y-1 text-xs text-emerald-700 dark:text-emerald-300">
                        <div><strong>Address:</strong> {result.match.address}</div>
                        <div><strong>Phone:</strong> {result.match.phone || 'N/A'}</div>
                        <div><strong>Website:</strong> {result.match.website ? <a href={result.match.website} target="_blank" rel="noreferrer" className="underline">{result.match.website}</a> : 'N/A'}</div>
                        <div><strong>Rating:</strong> {result.match.rating || 'N/A'} | <strong>Status:</strong> {result.match.businessStatus}</div>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                        {result.message || result.error || 'Not found'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
