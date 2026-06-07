import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Config from './pages/Config'
import Scheduler from './pages/Scheduler'
import Settings from './pages/Settings'
import Applications from './pages/Applications'
import KnowledgeBase from './pages/KnowledgeBase'
import Prompts from './pages/Prompts'
import Logs from './pages/Logs'
import Monitor from './pages/Monitor'
import LeadFinder from './pages/LeadFinder'
import GoogleMapsVerify from './pages/GoogleMapsVerify'
import GoogleMapsSearch from './pages/GoogleMapsSearch'
import AddressClassifier from './pages/AddressClassifier'
import SimilarCompanyFinder from './pages/SimilarCompanyFinder'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/config" element={<Config />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/lead-finder" element={<LeadFinder />} />
        <Route path="/google-maps-search" element={<GoogleMapsSearch />} />
        <Route path="/google-maps-verify" element={<GoogleMapsVerify />} />
        <Route path="/address-classifier" element={<AddressClassifier />} />
        <Route path="/similar-companies" element={<SimilarCompanyFinder />} />
        <Route path="/unknown-questions" element={<KnowledgeBase />} />
        <Route path="/prompts" element={<Prompts />} />
        <Route path="/logs" element={<Logs />} />
      </Routes>
    </Layout>
  )
}

export default App
